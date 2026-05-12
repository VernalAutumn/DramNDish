-- ================================================================
-- reports 테이블 생성
-- Supabase SQL Editor에서 실행하세요.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.reports (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id        UUID        REFERENCES auth.users(id) ON DELETE SET NULL,  -- null 허용: 비회원 신고
  reported_item_id   TEXT        NOT NULL,                                       -- 코멘트/사진 UUID
  item_type          TEXT        NOT NULL CHECK (item_type IN ('comment', 'photo', 'place')),
  reason             TEXT        NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS reports_reported_item_id_idx ON public.reports (reported_item_id);
CREATE INDEX IF NOT EXISTS reports_reporter_id_idx      ON public.reports (reporter_id);

-- RLS 활성화
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- 정책: 누구나 INSERT 가능 (비회원 신고 허용)
CREATE POLICY "anyone can insert reports"
  ON public.reports FOR INSERT
  WITH CHECK (true);

-- 정책: 본인 신고 내역 조회 가능
CREATE POLICY "reporters can view own reports"
  ON public.reports FOR SELECT
  USING (reporter_id = auth.uid());

-- 관리자 전용 전체 조회는 Supabase Dashboard에서 service_role 키로 접근하세요.
