-- ================================================================
-- dramndish Global — 사진 (설명과 함께 올리는 독립 사진)
-- 실행: Supabase SQL Editor (0001~0005 적용 후)
-- 사용자 설계(2026-06-13): 후기·구매인증과 별개로 "사진 + 간단한 설명"을
--   장소에 올릴 수 있는 사진 탭. user 중심 (§8.5).
--
-- 부록 C(2026-05-30): 테이블 생성 시 RLS + 명시적 GRANT를 함께 부여한다.
-- ================================================================

create table global.photos (
  id         uuid primary key default gen_random_uuid(),
  place_id   uuid not null references global.places (id) on delete cascade,
  user_id    uuid not null references global.users (id) on delete cascade,
  url        text not null,
  caption    text,                         -- 간단한 설명 (선택)
  created_at timestamptz not null default now()
);

create index photos_place_id_idx on global.photos (place_id);
create index photos_user_id_idx  on global.photos (user_id);

alter table global.photos enable row level security;

-- GRANT (Data API 노출 — 부록 C)
grant select         on global.photos to anon, authenticated;
grant insert, delete on global.photos to authenticated;

-- 공개 읽기 (§10 무료 열람)
create policy "photos_select_public"
  on global.photos for select
  using (true);

-- 본인만 작성·삭제 (§8.2 작성자 본인)
create policy "photos_insert_own"
  on global.photos for insert
  with check (user_id = auth.uid());

create policy "photos_delete_own"
  on global.photos for delete
  using (user_id = auth.uid());
