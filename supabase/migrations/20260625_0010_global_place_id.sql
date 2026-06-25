-- ================================================================
-- 글로벌 장소에 Google place_id 저장 (Embed 핀 정확도용)
-- ----------------------------------------------------------------
-- 등록 시 구글 자동완성에서 고른 장소의 place_id를 보관한다.
-- 용도: Embed 지도 핀을 q=place_id:... 로 정확히 표시 (이름 검색 오핀 방지).
--   (중복 판정은 원어 name_local 기준으로 이미 처리 — 여기선 핀 정확도 목적.)
-- 직접 입력 등록은 null로 남는다.
-- ================================================================
alter table global.places add column if not exists google_place_id text;
create index if not exists places_google_place_id_idx on global.places (google_place_id);
