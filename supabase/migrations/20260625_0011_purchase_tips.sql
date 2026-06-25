-- ================================================================
-- 구매팁(방명록) — 증류소 정보란의 짧은 한줄평
-- ----------------------------------------------------------------
-- 개개인이 가볍게 적는 구매 관련 한줄 메모. ex) "X가 더 맛있다", "이건 굳이".
-- place_tags 패턴(공개 읽기 · 본인 작성/삭제)을 따른다.
-- 작성자(user_id)는 on delete set null — 탈퇴 시 익명화(내용 유지).
-- ================================================================
create table if not exists global.purchase_tips (
  id         uuid primary key default gen_random_uuid(),
  place_id   uuid not null references global.places (id) on delete cascade,
  user_id    uuid references global.users (id) on delete set null,
  body       text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);
create index if not exists purchase_tips_place_id_idx on global.purchase_tips (place_id);

alter table global.purchase_tips enable row level security;

grant select         on global.purchase_tips to anon, authenticated;
grant insert, delete on global.purchase_tips to authenticated;

create policy "purchase_tips_select_public" on global.purchase_tips for select using (true);
create policy "purchase_tips_insert_own"    on global.purchase_tips for insert with check (user_id = auth.uid());
create policy "purchase_tips_delete_own"    on global.purchase_tips for delete using (user_id = auth.uid());
