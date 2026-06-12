-- ================================================================
-- dramndish Global — 후기 상세 입력을 위한 스키마 확장
-- 실행: Supabase SQL Editor (0001·0002 적용 후)
-- 결정(2026-06-13, 사용자 승인): 새 테이블 없이 reviews 컬럼 추가 +
--   "좋았던 메뉴/한 잔"은 기존 bottle_logs 재사용 (§8.5·§11 recap 소스).
-- ================================================================

-- ── reviews: 방문 맥락 (선택 입력) ──────────────────────────────
-- §8.3 사용자 설계: 함께 방문한 방문자 타입 + 인원
alter table global.reviews
  add column if not exists companion_type text
    check (companion_type in ('solo', 'friends', 'couple', 'family')),
  add column if not exists party_size int
    check (party_size is null or party_size >= 1);

-- ── bottle_logs: 식당 "좋았던 메뉴" 수용 + 사진 1~2장 ────────────
-- context에 restaurant_favorite 추가 (식당 메뉴 = 보틀이 아니지만 동일 구조로
-- 기록해 "내 기록 모아보기"§8.5에 함께 흐르게 함. recap은 위스키만 필터).
alter table global.bottle_logs drop constraint if exists bottle_logs_context_check;
alter table global.bottle_logs
  add constraint bottle_logs_context_check
  check (context in (
    'shop_purchase', 'distillery_direct', 'distillery_tasting',
    'bar_favorite', 'restaurant_favorite'
  ));

-- 사진 1~2장 (기존 photo_url 단수는 하위호환으로 남겨두고 신규 코드는 배열 사용)
alter table global.bottle_logs
  add column if not exists photo_urls text[] not null default '{}';

-- 컬럼 추가는 기존 테이블 GRANT를 상속하므로 추가 GRANT 불필요.
-- RLS 정책도 행 단위라 컬럼 추가의 영향 없음.
