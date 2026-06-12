-- ================================================================
-- dramndish Global — 사진 Storage 버킷 + 정책
-- 실행: Supabase SQL Editor
--
-- 버킷은 테이블이 아니라 "파일 저장소"다. 후기·구매인증 사진(바이너리)을
-- 이 버킷에 올리고, 돌려받은 공개 URL만 reviews.photo_urls /
-- bottle_logs.photo_urls(텍스트)에 저장한다.
--
-- 경로 규약: global/{auth.uid()}/{파일명}
--   → 정책이 첫 폴더(global) + 본인 uid 폴더만 쓰기 허용 (소유자 추적·격리).
-- ================================================================

-- 공개 읽기 버킷 (사진은 누구나 열람 — §10 무료 열람)
insert into storage.buckets (id, name, public)
values ('global-photos', 'global-photos', true)
on conflict (id) do nothing;

-- 읽기: 공개
drop policy if exists "global_photos_public_read" on storage.objects;
create policy "global_photos_public_read"
  on storage.objects for select
  using (bucket_id = 'global-photos');

-- 업로드: 로그인 유저가 자기 uid 폴더 아래에만 (global/{uid}/...)
drop policy if exists "global_photos_insert_own" on storage.objects;
create policy "global_photos_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'global-photos'
    and (storage.foldername(name))[1] = 'global'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- 삭제: 본인이 올린 파일만
drop policy if exists "global_photos_delete_own" on storage.objects;
create policy "global_photos_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'global-photos'
    and (storage.foldername(name))[1] = 'global'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
