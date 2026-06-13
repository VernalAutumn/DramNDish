-- ================================================================
-- dramndish Global — 바 후기 부가 입력 (흡연·커버차지)
-- 실행: Supabase SQL Editor (0001~0004 적용 후)
-- 사용자 설계(2026-06-13): 바 후기 "자세히"에서 방문 시 확인한
--   흡연 가능 여부 / 커버차지 유무를 선택 입력 (방문자·비용과 동급).
-- ================================================================

alter table global.reviews
  add column if not exists bar_smoking boolean,        -- 방문 시 흡연 가능했는지
  add column if not exists bar_cover_charge boolean;   -- 방문 시 커버차지가 있었는지

-- 컬럼 추가는 기존 GRANT·RLS를 상속 — 추가 설정 불필요.
