-- ================================================================
-- dramndish Global — 장소 태그 (§8.2-5)
-- 실행: Supabase SQL Editor (0001~0007 적용 후)
-- 국내판 tags 참고하되 글로벌은 로그인 필수 → 1인 1표 투표 방식.
--   place_tags  : 태그 정의 (장소당 라벨 유일)
--   tag_votes   : 투표 (1인 1표, count는 votes 수)
-- 부록 C: RLS + 명시적 GRANT 함께.
-- ================================================================

create table global.place_tags (
  id         uuid primary key default gen_random_uuid(),
  place_id   uuid not null references global.places (id) on delete cascade,
  label      text not null check (char_length(label) between 1 and 30),
  created_by uuid references global.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (place_id, label)
);

create table global.tag_votes (
  tag_id     uuid not null references global.place_tags (id) on delete cascade,
  user_id    uuid not null references global.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tag_id, user_id)
);

create index place_tags_place_id_idx on global.place_tags (place_id);
create index tag_votes_tag_id_idx     on global.tag_votes (tag_id);

alter table global.place_tags enable row level security;
alter table global.tag_votes  enable row level security;

-- GRANT (부록 C)
grant select         on global.place_tags to anon, authenticated;
grant insert         on global.place_tags to authenticated;
grant select         on global.tag_votes  to anon, authenticated;
grant insert, delete on global.tag_votes  to authenticated;

-- place_tags: 공개 읽기, 로그인 유저가 본인 명의로 생성
create policy "place_tags_select_public"
  on global.place_tags for select using (true);
create policy "place_tags_insert_own"
  on global.place_tags for insert with check (created_by = auth.uid());

-- tag_votes: 집계 공개 읽기, 본인 표만 생성·철회 (1인 1표는 PK)
create policy "tag_votes_select_public"
  on global.tag_votes for select using (true);
create policy "tag_votes_insert_own"
  on global.tag_votes for insert with check (user_id = auth.uid());
create policy "tag_votes_delete_own"
  on global.tag_votes for delete using (user_id = auth.uid());
