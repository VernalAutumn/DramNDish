-- ================================================================
-- dramndish Global — Phase 1 샘플 시드
-- 실행: 마이그레이션 2종 적용 후, Supabase SQL Editor (postgres 권한 — RLS 우회)
--
-- 부록 A 시딩 원칙:
--   - 수기 시드만. 외부 스크래핑 금지.
--   - 공개적으로 정당화되는 랜드마크만 (개인 발견형 바는 커뮤니티에 맡김).
--   - 없는 값은 attributes에 키를 넣지 않는다 (빈 문자열/0으로 위장 금지 — §6).
--
-- TODO: 좌표는 공개 주소 기반 근사값 — 서비스 전 구글 Places ingest로 재검증 권장.
-- TODO: 증류소 투어 프로그램·현장 상품(§6 관리자 큐레이션 항목)은 공개 정보
--       직접 조사 후 채울 것. 여기선 확실한 사실만 넣었다.
--
-- 멱등성: 재실행해도 중복되지 않도록 시드 행을 먼저 비운다.
--   source='seed'만 지운다 → 커뮤니티 등록 데이터는 보존.
--   (시드 장소에 달린 리뷰/관찰은 FK cascade로 함께 삭제됨 — 시드 단계라 무방)
-- ================================================================

delete from global.places where source = 'seed';
delete from global.products
  where display_name in (
    '[닛카] 프롬 더 배럴',
    '[산토리] 야마자키 | 12년',
    '[블랑톤] 스트레이트 프롬 더 배럴',
    '[GM] 글렌리벳 | CC 디스커버리'
  );

-- ----------------------------------------------------------------
-- places
-- ----------------------------------------------------------------
insert into global.places
  (name, name_local, type, subkind, country, region, address, lat, lng,
   source, google_maps_url, official_url, attributes)
values
  -- 런던 — 랜드마크 리쿼샵
  ('더 위스키 익스체인지 코벤트가든', 'The Whisky Exchange Covent Garden',
   'liquor_shop', null, 'UK', '런던',
   '2 Bedford Street, Covent Garden, London WC2E 9HH', 51.5113, -0.1240,
   'seed',
   'https://www.google.com/maps/search/?api=1&query=The+Whisky+Exchange+Covent+Garden',
   'https://www.thewhiskyexchange.com',
   '{}'::jsonb),

  ('밀로이즈 오브 소호', 'Milroy''s of Soho',
   'liquor_shop', null, 'UK', '런던',
   '3 Greek Street, Soho, London W1D 4NX', 51.5139, -0.1305,
   'seed',
   'https://www.google.com/maps/search/?api=1&query=Milroy''s+of+Soho',
   'https://milroys.co.uk',
   '{}'::jsonb),

  -- 독립병입 직영점 (subkind=ib_shop — §5 places.subkind)
  -- TODO(region 규칙 §6): UK region은 위스키 지역 태그 기준. 에든버러 시내 매장이라
  --   통용 표기가 애매함 — 일단 '로우랜드'. 큐레이션 확정 시 조정.
  ('카덴헤드 위스키샵 에든버러', 'Cadenhead''s Whisky Shop Edinburgh',
   'distillery', 'ib_shop', 'UK', '로우랜드',
   '172 Canongate, Edinburgh EH8 8BN', 55.9508, -3.1762,
   'seed',
   'https://www.google.com/maps/search/?api=1&query=Cadenhead''s+Whisky+Shop+Edinburgh',
   'https://www.cadenhead.scot',
   '{}'::jsonb),

  ('고든 앤 맥페일 엘긴 스토어', 'Gordon & MacPhail South Street Elgin',
   'distillery', 'ib_shop', 'UK', '스페이사이드',
   '58-60 South Street, Elgin IV30 1JY', 57.6478, -3.3146,
   'seed',
   'https://www.google.com/maps/search/?api=1&query=Gordon+and+MacPhail+Elgin',
   'https://www.gordonandmacphail.com',
   '{}'::jsonb),

  -- 증류소 (subkind=distillery)
  ('산토리 야마자키 증류소', 'サントリー山崎蒸溜所',
   'distillery', 'distillery', 'JP', '오사카',
   '5-2-1 Yamazaki, Shimamoto, Mishima District, Osaka 618-0001', 34.8924, 135.6743,
   'seed',
   'https://www.google.com/maps/search/?api=1&query=Suntory+Yamazaki+Distillery',
   'https://www.suntory.co.jp/factory/yamazaki/',
   '{
     "booking_required": true,
     "booking_url": "https://www.suntory.co.jp/factory/yamazaki/",
     "access": "JR 야마자키역 또는 한큐 오야마자키역에서 도보 약 10분"
   }'::jsonb);

-- ----------------------------------------------------------------
-- products — §7 표기 규칙 예시 그대로.
-- display_name은 트리거가 §7 규칙으로 자동 생성.
-- aliases는 통용 약칭만, 검색 전용 (§7).
-- ----------------------------------------------------------------
insert into global.products
  (kind, brand, bottler, distillery, name_ko, name_en, series, label_freetext,
   cask_type, country, age, category, aliases, display_name)
values
  ('official', '닛카', null, null,
   '프롬 더 배럴', 'Nikka From the Barrel', null, null,
   null, 'JP', null, 'blended',
   array['닛프배', 'from the barrel'], ''),        -- → [닛카] 프롬 더 배럴

  ('official', '산토리', null, '야마자키',
   '야마자키', 'Yamazaki', '12년', null,
   null, 'JP', 12, 'single_malt',
   array['야마'], ''),                              -- → [산토리] 야마자키 | 12년

  ('official', '블랑톤', null, null,
   '스트레이트 프롬 더 배럴', 'Blanton''s Straight From The Barrel', null, null,
   null, 'US', null, 'bourbon',
   array['SFTB'], ''),                              -- → [블랑톤] 스트레이트 프롬 더 배럴

  ('independent', null, 'GM', '글렌리벳',
   null, null, 'CC 디스커버리', null,
   null, 'UK', null, 'single_malt',
   array[]::text[], '');                            -- → [GM] 글렌리벳 | CC 디스커버리

-- reviews / bottle_logs / observations 는 시드하지 않는다 —
-- 실제 유저 행위 데이터를 가짜로 채우는 것은 데이터 정직성 원칙(§1) 위반.
