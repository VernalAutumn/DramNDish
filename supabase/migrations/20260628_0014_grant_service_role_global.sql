-- ================================================================
-- global 스키마 → service_role 권한 부여
-- ----------------------------------------------------------------
-- global 스키마를 수동 생성하며 anon·authenticated 에게만 GRANT 했던 탓에,
-- service_role(관리자 모더레이션 삭제 · 회원 탈퇴의 글로벌 익명화)이
-- "permission denied for table ..." 로 막혔다. service_role 에 전체 권한 부여.
--   - 관리자 모더레이션: /api/global/admin/moderate (place_tags 등 삭제)
--   - 회원 탈퇴: /api/account (reviews·bottle_logs·observations·photos 등 익명화/삭제)
-- service_role 은 RLS 를 우회하지만, 테이블 GRANT 자체는 별도로 필요하다.
-- Supabase SQL Editor에서 실행.
-- ================================================================
grant usage on schema global to service_role;

grant all privileges on all tables    in schema global to service_role;
grant all privileges on all sequences in schema global to service_role;

-- 이후 생성되는 객체에도 자동 부여
alter default privileges in schema global grant all on tables    to service_role;
alter default privileges in schema global grant all on sequences to service_role;
