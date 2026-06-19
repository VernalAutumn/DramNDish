-- ================================================================
-- 회원 탈퇴(익명화) 지원 마이그레이션
-- ----------------------------------------------------------------
-- 정책(유저 결정): 탈퇴 시 공동체 데이터는 '탈퇴한 사용자'로 익명화(내용 유지),
--                 개인 데이터(즐겨찾기·투표·신고)는 삭제, 인증 계정은 영구 삭제.
--
-- 이 마이그레이션은 익명화가 가능하도록 공동체 테이블의 작성자 컬럼을
--   (1) nullable 로 만들고
--   (2) (글로벌) FK on delete 규칙을 cascade → set null 로 바꾼다.
-- 그래야 /api/account DELETE 라우트가 user_id 를 null 로 비워 익명화할 수 있고,
-- 계정(auth.users) 삭제 시 cascade 로 콘텐츠가 함께 지워지지 않는다.
--
-- ⚠ 적용 전 백업 권장. 적용은 Supabase SQL Editor 또는 CLI 로 직접.
-- ================================================================

-- ---------- 국내(public) : 공동체 작성자 컬럼 nullable ----------
-- (FK 제약명이 환경마다 다를 수 있어 여기서는 NOT NULL 만 해제한다.
--  라우트가 service-role 로 user_id 를 명시적으로 null 처리하므로,
--  FK on delete 규칙이 cascade 라도 익명화가 먼저 끊어 안전하다.)
alter table public.comments      alter column user_id      drop not null;
alter table public.place_photos  alter column user_id      drop not null;
alter table public.places        alter column submitted_by drop not null;
-- 참고: public.tags 는 이 DB에 작성자 컬럼(added_by)이 없어 익명화 대상 아님.

-- ---------- 글로벌(global) : nullable + FK on delete set null ----------
-- reviews
alter table global.reviews      alter column user_id drop not null;
alter table global.reviews      drop constraint if exists reviews_user_id_fkey;
alter table global.reviews      add  constraint reviews_user_id_fkey
  foreign key (user_id) references global.users (id) on delete set null;

-- bottle_logs
alter table global.bottle_logs  alter column user_id drop not null;
alter table global.bottle_logs  drop constraint if exists bottle_logs_user_id_fkey;
alter table global.bottle_logs  add  constraint bottle_logs_user_id_fkey
  foreign key (user_id) references global.users (id) on delete set null;

-- observations
alter table global.observations alter column user_id drop not null;
alter table global.observations drop constraint if exists observations_user_id_fkey;
alter table global.observations add  constraint observations_user_id_fkey
  foreign key (user_id) references global.users (id) on delete set null;

-- photos
alter table global.photos       alter column user_id drop not null;
alter table global.photos       drop constraint if exists photos_user_id_fkey;
alter table global.photos       add  constraint photos_user_id_fkey
  foreign key (user_id) references global.users (id) on delete set null;

-- place_tags.created_by 는 최초 정의부터 on delete set null 이라 그대로 둔다.

-- ---------- 참고: 익명 콘텐츠 표시 ----------
-- 국내는 nickname/contributor_nickname(비정규화 텍스트)을 '탈퇴한 사용자'로 세팅하므로
--   조회 join 변경 없이 그대로 표시된다.
-- 글로벌은 user_id 가 null 이 되므로, 후기/사진 조회가 users 와 inner join 이면
--   익명 행이 사라진다 → left join + null 시 '탈퇴한 사용자' 폴백 처리 필요.
