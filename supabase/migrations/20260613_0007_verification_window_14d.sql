-- ================================================================
-- dramndish Global — 관찰 검증 기간 30일 → 14일 (§8.4)
-- 실행: Supabase SQL Editor (0001~0006 적용 후)
-- 사용자 결정(2026-06-13): 휘발성 데이터라 14일이 더 안전.
-- ================================================================

create or replace view global.observations_with_status
with (security_invoker = true)
as
select
  o.*,
  case when (
    select count(distinct o2.user_id)
    from global.observations o2
    where o2.place_id = o.place_id
      and o2.product_id is not distinct from o.product_id
      and o2.obs_type = o.obs_type
      and case
            when o.value_bucket is not null then o2.value_bucket = o.value_bucket
            else o2.value_text is not distinct from o.value_text
          end
      and abs(o2.observed_at - o.observed_at) <= 14
  ) >= 2 then 'confirmed' else 'single' end as verification_status
from global.observations o;

grant select on global.observations_with_status to anon, authenticated;
