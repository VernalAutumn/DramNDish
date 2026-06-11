-- ================================================================
-- dramndish Global — Phase 1 스키마 (1/2: 스키마·테이블·인덱스)
-- 실행: Supabase SQL Editor
-- 반드시 20260611_0002_dramndish_rls_grants.sql 을 "함께" 실행할 것.
--   (RLS·GRANT 없이는 Data API에서 접근 불가 — 부록 C)
-- 스펙: dramndish-global-spec.md §5(데이터 모델)·§6(attributes)·§7(표기 규칙)
--
-- 국내판(tastamp)과 같은 Supabase 프로젝트를 공유하므로
-- public이 아닌 별도 `global` 스키마에 생성한다. (places·reports 이름 충돌 회피)
-- auth.users 는 국내판과 공유된다.
-- ================================================================

create schema if not exists global;

-- ----------------------------------------------------------------
-- users — Supabase auth 확장 프로필
-- 프로필 생성은 auth.users 트리거가 아니라 첫 로그인 시 앱에서 upsert.
-- (트리거를 쓰면 국내판 가입자에게도 dramndish 프로필이 생기므로)
-- ----------------------------------------------------------------
create table global.users (
  id            uuid primary key references auth.users (id) on delete cascade,
  nickname      text,
  membership    text not null default 'free'
                  check (membership in ('free', 'plus')),      -- Phase 2에서 사용 (게이팅 플래그만)
  taste_profile jsonb not null default '{}'::jsonb,            -- Phase 2 리캡/취향매칭용
  created_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------
-- places — 핵심 엔티티
-- ----------------------------------------------------------------
create table global.places (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,                               -- 표시명 (한국어/통용)
  name_local      text,                                        -- 현지어 원문 (예: リカーマウンテン)
  type            text not null
                    check (type in ('liquor_shop', 'bar', 'restaurant', 'distillery')),
  subkind         text
                    check (subkind in ('distillery', 'ib_shop')),
  country         text not null,                               -- 'JP' | 'TW' | 'UK' | 'US' ...
  region          text,                                        -- JP/TW=도시, UK=위스키 지역 (§6 스코틀랜드 region 규칙)
  address         text,
  lat             double precision,
  lng             double precision,
  source          text not null default 'community'
                    check (source in ('seed', 'community')),
  contributed_by  uuid references global.users (id) on delete set null,
  google_maps_url text,                                        -- 딥링크 기본값
  official_url    text,                                        -- 공식 사이트/예약대행 (SNS 금지)
  attributes      jsonb not null default '{}'::jsonb,          -- 유형별 속성 §6. 없는 값은 키 자체를 넣지 않는다.
  created_at      timestamptz not null default now(),
  constraint places_subkind_only_for_distillery
    check (subkind is null or type = 'distillery')
);

create index places_country_idx        on global.places (country);
create index places_country_region_idx on global.places (country, region);
create index places_type_idx           on global.places (type);
create index places_contributed_by_idx on global.places (contributed_by);

-- ----------------------------------------------------------------
-- products — 위스키 보틀 (리뷰·리캡에서 참조)
-- ----------------------------------------------------------------
create table global.products (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null
                   check (kind in ('official', 'independent')),
  brand          text,                                         -- official 전용
  bottler        text,                                         -- independent 전용 ('GM' | 'SV' | ...)
  distillery     text,
  name_ko        text,
  name_en        text,
  series         text,
  label_freetext text,                                         -- 정형화 불가 IB 라벨 자유 입력
  cask_type      text
                   check (cask_type in ('sherry', 'bourbon', 'mizunara', 'wine', 'other')),
  country        text,
  age            int,
  category       text
                   check (category in ('single_malt', 'blended_malt', 'blended',
                                       'grain', 'bourbon', 'rye', 'other')),
  aliases        text[] not null default '{}',                 -- 검색 전용. 표시에 절대 사용 금지 (§7)
  display_name   text not null,                                -- 생성 규칙 §7 (아래 트리거가 자동 채움)
  created_at     timestamptz not null default now()
);

create index products_aliases_gin_idx on global.products using gin (aliases);
create index products_kind_idx        on global.products (kind);

-- §7 display_name 생성 규칙
--   official:    [브랜드] 제품명 | 시리즈
--   independent: [보틀러] 증류소 | 시리즈/라벨
create or replace function global.product_display_name(p global.products)
returns text
language sql
immutable
as $$
  select case
    when p.kind = 'official' then
      coalesce('[' || p.brand || '] ', '')
        || coalesce(p.name_ko, p.name_en, '')
        || coalesce(' | ' || p.series, '')
    else
      coalesce('[' || p.bottler || '] ', '')
        || coalesce(p.distillery, '')
        || coalesce(' | ' || coalesce(p.series, p.label_freetext), '')
  end
$$;

create or replace function global.set_product_display_name()
returns trigger
language plpgsql
as $$
begin
  if new.display_name is null or btrim(new.display_name) = '' then
    new.display_name := global.product_display_name(new);
  end if;
  return new;
end;
$$;

create trigger trg_products_display_name
  before insert or update on global.products
  for each row execute function global.set_product_display_name();

-- ----------------------------------------------------------------
-- reviews — 장소 방문 후기
-- ----------------------------------------------------------------
create table global.reviews (
  id             uuid primary key default gen_random_uuid(),
  place_id       uuid not null references global.places (id) on delete cascade,
  user_id        uuid not null references global.users (id) on delete cascade,
  visited_at     date not null,                                -- 사용자 입력 (사진 메타데이터 의존 X — §3)
  rating         text
                   check (rating in ('revisit', 'fine', 'meh')),
  spend_amount   numeric,
  spend_currency text,
  comment        text,
  photo_urls     text[] not null default '{}',                 -- 매장 전경·분위기. 보틀 사진은 bottle_logs에.
  created_at     timestamptz not null default now()
);

create index reviews_place_id_idx on global.reviews (place_id);
create index reviews_user_id_idx  on global.reviews (user_id);

-- ----------------------------------------------------------------
-- bottle_logs — 마신/산 보틀 기록 (리캡 데이터 소스)
-- ----------------------------------------------------------------
create table global.bottle_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references global.users (id) on delete cascade,
  review_id     uuid references global.reviews (id) on delete set null,
  place_id      uuid references global.places (id) on delete set null,
  product_id    uuid references global.products (id) on delete set null,
  free_label    text,                                          -- product 매칭 실패 시 (강제 매핑 금지 — §7)
  context       text not null
                  check (context in ('shop_purchase', 'distillery_direct',
                                     'distillery_tasting', 'bar_favorite')),
  price         numeric,
  currency      text,
  fx_to_krw     numeric,                                       -- 입력 당시 환율 스냅샷. 미상이면 null
  photo_url     text,
  simple_rating text
                  check (simple_rating in ('want_to_buy', 'decent', 'meh')),
  visibility    text not null default 'private'
                  check (visibility in ('public_minimal', 'private')),
  logged_at     date not null,
  created_at    timestamptz not null default now()
);

create index bottle_logs_user_id_idx    on global.bottle_logs (user_id);
create index bottle_logs_place_id_idx   on global.bottle_logs (place_id);
create index bottle_logs_review_id_idx  on global.bottle_logs (review_id);
create index bottle_logs_product_id_idx on global.bottle_logs (product_id);

-- ----------------------------------------------------------------
-- observations — 검증 대상 휘발성 데이터 (카더라)
-- ----------------------------------------------------------------
create table global.observations (
  id           uuid primary key default gen_random_uuid(),
  place_id     uuid not null references global.places (id) on delete cascade,
  product_id   uuid references global.products (id) on delete cascade,
  user_id      uuid not null references global.users (id) on delete cascade,
  obs_type     text not null
                 check (obs_type in ('cask_level', 'bottle_level', 'price', 'stock', 'tour_info')),
  value_bucket text
                 check (value_bucket in ('plenty', 'half', 'low', 'unknown')),
  value_text   text,
  note         text,
  observed_at  date not null,
  created_at   timestamptz not null default now()
);

create index observations_place_type_idx  on global.observations (place_id, obs_type);
create index observations_product_id_idx  on global.observations (product_id);
create index observations_user_id_idx     on global.observations (user_id);
create index observations_observed_at_idx on global.observations (observed_at);

-- §8.4 검증 상태: 같은 (place, product, obs_type)에 서로 다른 user 2건+ 일치 → confirmed.
-- "일치" = value_bucket 동일(버킷형) / value_text 동일(자유값형).
-- TODO(스펙 미정): "일정 기간"이 미정 — 일단 30일로 가정. 확정되면 아래 30 수정.
create or replace view global.observations_with_status
with (security_invoker = true)
as
select
  o.*,
  case when (
    select count(distinct o2.user_id)
    from global.observations o2
    where o2.place_id = o.place_id
      and o2.product_id is not distinct from o.product_id
      and o2.obs_type = o.obs_type
      and case
            when o.value_bucket is not null then o2.value_bucket = o.value_bucket
            else o2.value_text is not distinct from o.value_text
          end
      and abs(o2.observed_at - o.observed_at) <= 30
  ) >= 2 then 'confirmed' else 'single' end as verification_status
from global.observations o;

-- ----------------------------------------------------------------
-- favorites — 즐겨찾기 (일정의 씨앗)
-- ----------------------------------------------------------------
create table global.favorites (
  user_id    uuid not null references global.users (id) on delete cascade,
  place_id   uuid not null references global.places (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);

create index favorites_place_id_idx on global.favorites (place_id);

-- ----------------------------------------------------------------
-- review_votes — 한줄평 유용/비유용 투표 (1인 1표)
-- ----------------------------------------------------------------
create table global.review_votes (
  review_id  uuid not null references global.reviews (id) on delete cascade,
  user_id    uuid not null references global.users (id) on delete cascade,
  vote       text not null
               check (vote in ('helpful', 'not_helpful')),
  created_at timestamptz not null default now(),
  primary key (review_id, user_id)
);

-- ----------------------------------------------------------------
-- reports — 신고 / 모더레이션
-- 관리자 처리는 service_role(대시보드/서버)로 수행 — RLS 우회.
-- TODO(스펙 미정): 비회원 신고 허용 여부 미정 — 일단 로그인 필수(reporter_id not null).
-- ----------------------------------------------------------------
create table global.reports (
  id          uuid primary key default gen_random_uuid(),
  target_type text not null
                check (target_type in ('place', 'place_type', 'bottle_log', 'review')),
  target_id   uuid not null,
  reporter_id uuid not null references global.users (id) on delete cascade,
  reason      text not null check (char_length(reason) between 1 and 500),
  status      text not null default 'open'
                check (status in ('open', 'resolved', 'dismissed')),
  created_at  timestamptz not null default now()
);

create index reports_status_idx on global.reports (status);
create index reports_target_idx on global.reports (target_type, target_id);

-- ----------------------------------------------------------------
-- Phase 2 예비 — 스키마만 두고 구현하지 않는다 (§5).
-- GRANT·정책을 부여하지 않으므로 Data API에서 접근 불가 상태로 잠궈 둔다.
-- ----------------------------------------------------------------
create table global.itineraries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references global.users (id) on delete cascade,
  title      text not null,
  country    text,
  region     text,
  created_at timestamptz not null default now()
);

create table global.itinerary_stops (
  id           uuid primary key default gen_random_uuid(),
  itinerary_id uuid not null references global.itineraries (id) on delete cascade,
  place_id     uuid not null references global.places (id) on delete cascade,
  order_index  int not null,
  notes        text
);

alter table global.itineraries     enable row level security;
alter table global.itinerary_stops enable row level security;
