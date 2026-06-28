-- ================================================================
-- 증류소 한정 보틀 투표 단순화 (B4 후속)
-- ----------------------------------------------------------------
-- 두 축(availability 있어요/없어요 · worth 꼭사야해/굳이)이 길고 지저분 →
-- 단일 추천/비추(👍/👎) 한 표로 단순화.
-- 0012 직후라 데이터 없음 → 안전하게 컬럼 교체.
-- 한 보틀당 한 유저 1행(PK), 철회는 행 삭제.
-- ================================================================
alter table global.distillery_bottle_votes drop column if exists availability;
alter table global.distillery_bottle_votes drop column if exists worth;

alter table global.distillery_bottle_votes
  add column if not exists vote text check (vote in ('up', 'down'));

-- 혹시 남은 행이 있으면 기본값 부여 후 NOT NULL (데이터 없을 것이나 안전)
update global.distillery_bottle_votes set vote = 'up' where vote is null;
alter table global.distillery_bottle_votes alter column vote set not null;
