-- ================================================================
-- dramndish Global — 관찰(observations) 30일 자동 삭제 (§8.4 휘발성 데이터)
-- 실행: Supabase SQL Editor (0001~0014 적용 후)
-- 사용자 결정(2026-06-29): 관찰은 휘발성이라 observed_at 기준 30일 경과 시 자동 삭제.
--
-- 기준 컬럼: observed_at (관찰일). 검증 기간(14일, 0007)과 별개 — 검증 기간은
--           confirmed/single 판정 윈도우이고, 여기 30일은 보존 수명이다.
--
-- ⚠ pg_cron 확장이 필요하다. Supabase 대시보드 Database → Extensions 에서
--    pg_cron 을 켜거나, 아래 create extension 이 권한 부족으로 실패하면
--    대시보드에서 활성화 후 이 파일의 함수·스케줄 부분만 다시 실행한다.
--    (조회 단의 30일 컷오프 필터는 앱 코드에 별도로 있으므로, cron 미적용이어도
--     30일 넘은 관찰은 화면에 노출되지 않는다 — cron 은 저장소 정리용.)
-- ================================================================

create extension if not exists pg_cron;

-- 30일(관찰일 기준) 경과 관찰 삭제. security definer 로 RLS 우회(소유자=postgres).
create or replace function global.purge_stale_observations()
returns integer
language plpgsql
security definer
set search_path = global, pg_temp
as $$
declare
  deleted integer;
begin
  delete from global.observations
  where observed_at < current_date - 30;
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

-- 재실행 안전: 기존 동일 이름 잡 제거 후 재등록.
do $$
begin
  perform cron.unschedule('purge-stale-global-observations');
exception when others then
  null;  -- 잡이 없으면 무시
end;
$$;

-- 매일 18:00 UTC (= 한국 03:00) 실행.
select cron.schedule(
  'purge-stale-global-observations',
  '0 18 * * *',
  $$ select global.purge_stale_observations(); $$
);
