-- ================================================================
-- 산토리 야마자키 증류소 — 투어 프로그램 3종 + 예약 안내(추첨제)
-- ----------------------------------------------------------------
-- 데이터 입력(1회성). global.places.attributes 에 병합(||)하여
-- 기존 access·booking_url·booking_required 는 보존한다.
-- Supabase SQL Editor에서 실행. (id로 단일 행만 갱신)
-- ================================================================
update global.places
set attributes = attributes || jsonb_build_object(
  'exclusive_md',
    '예약은 추첨제로 운영됩니다. 방문하려는 달의 두 달 전, 그 달 초에 추첨 신청을 받습니다(예: 8월 방문은 6월 초 신청). 당첨된 분만 예약할 수 있고, 미당첨자는 이후 재배정 기간에 다시 신청해 예약할 수 있습니다.',
  'tour_programs', jsonb_build_array(
    jsonb_build_object(
      'name', '박물관 투어',
      'type', '무료',
      'includes', jsonb_build_array('기념품 샵', '내부 바 이용')
    ),
    jsonb_build_object(
      'name', '모노즈쿠리 투어 & 테이스팅',
      'price', '¥3,000',
      'booking_required', true,
      'includes', jsonb_build_array('내부 관람', '테이스팅', '기념품', '야마자키 DR(디스틸러스 리저브) 구매권')
    ),
    jsonb_build_object(
      'name', '모노즈쿠리 투어 & 테이스팅 — 프레스티지',
      'price', '¥10,000',
      'booking_required', true,
      'includes', jsonb_build_array('내부 관람', '테이스팅', '기념품', '야마자키 12년 구매권')
    )
  )
)
where id = '8accab1d-eda4-41eb-ad40-01c288831e53';
