-- ================================================================
-- 증류소 한정 보틀 (B4) — 증류소에서만 구할 수 있는 한정/핸드필 보틀
-- ----------------------------------------------------------------
-- 사진 + 제품명으로 가볍게 등록하고, 두 축으로 교차검증/평가한다:
--   availability(있어요/없어요) — 현재 재고 교차검증
--   worth(꼭사야해/굳이)         — 살 가치 평가
-- purchase_tips(공개 읽기 · 본인 작성/삭제) + review_votes(1인 1표 upsert) 패턴 차용.
-- 작성자(user_id)는 on delete set null — 탈퇴 시 익명화(보틀은 유지).
-- 반드시 RLS·GRANT 까지 함께 실행할 것(부록 C). 적용 절차: supabase/DRAMNDISH_README.md
-- ================================================================
create table if not exists global.distillery_bottles (
  id         uuid primary key default gen_random_uuid(),
  place_id   uuid not null references global.places (id) on delete cascade,
  user_id    uuid references global.users (id) on delete set null,
  name       text not null check (char_length(name) between 1 and 200),  -- 제품명 (자유 입력)
  photo_url  text,
  created_at timestamptz not null default now()
);
create index if not exists distillery_bottles_place_id_idx on global.distillery_bottles (place_id);

-- 한 보틀당 한 유저 1행. 두 축 각각 nullable — 한쪽만 투표 가능.
create table if not exists global.distillery_bottle_votes (
  bottle_id    uuid not null references global.distillery_bottles (id) on delete cascade,
  user_id      uuid not null references global.users (id) on delete cascade,
  availability text check (availability in ('in_stock', 'out_of_stock')),  -- 있어요 / 없어요
  worth        text check (worth in ('must_buy', 'meh')),                  -- 꼭사야해 / 굳이
  updated_at   timestamptz not null default now(),
  primary key (bottle_id, user_id)
);
create index if not exists distillery_bottle_votes_bottle_idx on global.distillery_bottle_votes (bottle_id);

alter table global.distillery_bottles      enable row level security;
alter table global.distillery_bottle_votes enable row level security;

grant select         on global.distillery_bottles to anon, authenticated;
grant insert, delete on global.distillery_bottles to authenticated;

grant select                 on global.distillery_bottle_votes to anon, authenticated;
grant insert, update, delete on global.distillery_bottle_votes to authenticated;

create policy "distillery_bottles_select_public" on global.distillery_bottles for select using (true);
create policy "distillery_bottles_insert_own"    on global.distillery_bottles for insert with check (user_id = auth.uid());
create policy "distillery_bottles_delete_own"    on global.distillery_bottles for delete using (user_id = auth.uid());

create policy "distillery_bottle_votes_select_public" on global.distillery_bottle_votes for select using (true);
create policy "distillery_bottle_votes_insert_own"    on global.distillery_bottle_votes for insert with check (user_id = auth.uid());
create policy "distillery_bottle_votes_update_own"    on global.distillery_bottle_votes for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "distillery_bottle_votes_delete_own"    on global.distillery_bottle_votes for delete using (user_id = auth.uid());
