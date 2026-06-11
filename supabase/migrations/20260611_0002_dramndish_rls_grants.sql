-- ================================================================
-- dramndish Global — Phase 1 스키마 (2/2: RLS 정책 + 명시적 GRANT)
-- 실행: 20260611_0001_dramndish_schema.sql 직후, Supabase SQL Editor
--
-- 부록 C (Supabase 2026-05-30 변경 — 필수):
--   신규 프로젝트는 테이블이 Data API에 자동 노출되지 않는다.
--   ① RLS 활성화 + 정책, ② 명시적 GRANT(anon/authenticated) 둘 다 필요.
--   GRANT 누락 시 supabase-js 쿼리가 조용히 빈 결과를 반환한다.
--
-- 추가로 대시보드 설정 필요(이 파일로는 불가):
--   Settings → API → "Exposed schemas" 에 `global` 추가.
--   클라이언트는 createClient(..., { db: { schema: 'global' } }) 로 접근.
--
-- 관리자(모더레이션) 작업은 service_role 키로 수행한다 — RLS·GRANT 우회.
-- ================================================================

-- ----------------------------------------------------------------
-- 스키마 사용권
-- ----------------------------------------------------------------
grant usage on schema global to anon, authenticated;

-- service_role: 커스텀 스키마에는 기본 권한이 없으므로 명시 부여.
-- (관리자 모더레이션·시드 보정용. BYPASSRLS라 정책은 무시되지만 GRANT는 필요)
grant usage on schema global to service_role;
grant all on all tables in schema global to service_role;

-- ----------------------------------------------------------------
-- RLS 활성화 (Phase 1 전 테이블)
-- ----------------------------------------------------------------
alter table global.users        enable row level security;
alter table global.places       enable row level security;
alter table global.products     enable row level security;
alter table global.reviews      enable row level security;
alter table global.bottle_logs  enable row level security;
alter table global.observations enable row level security;
alter table global.favorites    enable row level security;
alter table global.review_votes enable row level security;
alter table global.reports      enable row level security;
-- (itineraries / itinerary_stops 는 0001에서 RLS만 켜고 정책·GRANT 없음 = Phase 2까지 잠금)

-- ----------------------------------------------------------------
-- users — 프로필. 닉네임은 기여자 표시용으로 공개 읽기.
-- 본인 행만 생성/수정 (첫 로그인 시 앱에서 upsert).
-- TODO: taste_profile·membership 까지 공개 읽기에 포함됨.
--       Phase 2 시작 전 공개 컬럼 분리(뷰 또는 column-level grant) 검토.
-- ----------------------------------------------------------------
grant select         on global.users to anon, authenticated;
grant insert, update on global.users to authenticated;

create policy "users_select_public"
  on global.users for select
  using (true);

create policy "users_insert_self"
  on global.users for insert
  with check (id = auth.uid());

create policy "users_update_self"
  on global.users for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ----------------------------------------------------------------
-- places — 공개 읽기. 등록은 로그인 유저, 본인 명의(contributed_by)로만.
-- 수정·삭제는 Phase 1에선 관리자(service_role) 전용 — 일반 정책 없음.
-- (§6: distillery 큐레이션 항목은 자유 편집 금지)
-- ----------------------------------------------------------------
grant select on global.places to anon, authenticated;
grant insert on global.places to authenticated;

create policy "places_select_public"
  on global.places for select
  using (true);

create policy "places_insert_community"
  on global.places for insert
  with check (
    contributed_by = auth.uid()
    and source = 'community'
  );

-- ----------------------------------------------------------------
-- products — 공개 읽기. 등록은 로그인 유저(보틀 기록 중 신규 보틀 추가).
-- 수정·삭제(정제·병합)는 관리자(service_role) 전용.
-- ----------------------------------------------------------------
grant select on global.products to anon, authenticated;
grant insert on global.products to authenticated;

create policy "products_select_public"
  on global.products for select
  using (true);

create policy "products_insert_authenticated"
  on global.products for insert
  with check (auth.uid() is not null);

-- ----------------------------------------------------------------
-- reviews — 공개 읽기. 작성자 본인만 작성·수정·삭제 (§8.2-7·8).
-- ----------------------------------------------------------------
grant select                 on global.reviews to anon, authenticated;
grant insert, update, delete on global.reviews to authenticated;

create policy "reviews_select_public"
  on global.reviews for select
  using (true);

create policy "reviews_insert_own"
  on global.reviews for insert
  with check (user_id = auth.uid());

create policy "reviews_update_own"
  on global.reviews for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "reviews_delete_own"
  on global.reviews for delete
  using (user_id = auth.uid());

-- ----------------------------------------------------------------
-- bottle_logs — visibility 게이트:
--   public_minimal 행은 누구나(장소 상세의 구매 인증 §8.2-6), private 행은 본인만.
--   작성자 본인만 작성·수정·삭제.
-- ----------------------------------------------------------------
grant select                 on global.bottle_logs to anon, authenticated;
grant insert, update, delete on global.bottle_logs to authenticated;

create policy "bottle_logs_select_public_or_own"
  on global.bottle_logs for select
  using (visibility = 'public_minimal' or user_id = auth.uid());

create policy "bottle_logs_insert_own"
  on global.bottle_logs for insert
  with check (user_id = auth.uid());

create policy "bottle_logs_update_own"
  on global.bottle_logs for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "bottle_logs_delete_own"
  on global.bottle_logs for delete
  using (user_id = auth.uid());

-- ----------------------------------------------------------------
-- observations — 공개 읽기 (출처·관찰일 항상 노출 — §8.4).
-- 본인만 작성·삭제. 수정은 불허(새 관찰로 갱신하는 모델).
-- ----------------------------------------------------------------
grant select         on global.observations to anon, authenticated;
grant insert, delete on global.observations to authenticated;

create policy "observations_select_public"
  on global.observations for select
  using (true);

create policy "observations_insert_own"
  on global.observations for insert
  with check (user_id = auth.uid());

create policy "observations_delete_own"
  on global.observations for delete
  using (user_id = auth.uid());

-- 검증 상태 뷰 (security_invoker — 기반 테이블 RLS 적용됨)
grant select on global.observations_with_status to anon, authenticated;

-- ----------------------------------------------------------------
-- favorites — 전부 본인 한정.
-- ----------------------------------------------------------------
grant select, insert, delete on global.favorites to authenticated;

create policy "favorites_select_own"
  on global.favorites for select
  using (user_id = auth.uid());

create policy "favorites_insert_own"
  on global.favorites for insert
  with check (user_id = auth.uid());

create policy "favorites_delete_own"
  on global.favorites for delete
  using (user_id = auth.uid());

-- ----------------------------------------------------------------
-- review_votes — 집계(찬반 분포)는 공개 읽기. 1인 1표는 PK가 보장.
-- 본인 표만 생성/변경/철회.
-- ----------------------------------------------------------------
grant select                 on global.review_votes to anon, authenticated;
grant insert, update, delete on global.review_votes to authenticated;

create policy "review_votes_select_public"
  on global.review_votes for select
  using (true);

create policy "review_votes_insert_own"
  on global.review_votes for insert
  with check (user_id = auth.uid());

create policy "review_votes_update_own"
  on global.review_votes for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "review_votes_delete_own"
  on global.review_votes for delete
  using (user_id = auth.uid());

-- ----------------------------------------------------------------
-- reports — 로그인 유저만 신고 가능, 본인 신고 내역만 조회.
-- 접수 처리(status 변경)·대상 삭제는 관리자(service_role) 전용.
-- ----------------------------------------------------------------
grant select, insert on global.reports to authenticated;

create policy "reports_insert_own"
  on global.reports for insert
  with check (reporter_id = auth.uid());

create policy "reports_select_own"
  on global.reports for select
  using (reporter_id = auth.uid());

-- ================================================================
-- 참고: 이후 global 스키마에 새 테이블을 추가할 때마다
-- RLS 활성화 + 정책 + 명시적 GRANT 3종을 반드시 함께 작성할 것.
-- (default privileges 일괄 부여 대신 테이블별 최소권한 — 부록 C 권장)
-- ================================================================
