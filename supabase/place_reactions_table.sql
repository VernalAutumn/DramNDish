-- ================================================================
-- place_reactions 테이블 생성
-- Supabase SQL Editor에서 실행하세요.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.place_reactions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  place_id      TEXT        NOT NULL,
  reaction_type TEXT        NOT NULL CHECK (reaction_type IN ('visit_again', 'no_visit')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT place_reactions_user_place_unique UNIQUE (user_id, place_id)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS place_reactions_place_id_idx ON public.place_reactions (place_id);
CREATE INDEX IF NOT EXISTS place_reactions_user_id_idx  ON public.place_reactions (user_id);

-- RLS 활성화
ALTER TABLE public.place_reactions ENABLE ROW LEVEL SECURITY;

-- 정책: 로그인 유저 본인만 INSERT/UPDATE/DELETE
CREATE POLICY "users can manage own reactions"
  ON public.place_reactions
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 정책: 집계 카운트 조회는 누구나 가능
CREATE POLICY "anyone can read reactions"
  ON public.place_reactions FOR SELECT
  USING (true);
