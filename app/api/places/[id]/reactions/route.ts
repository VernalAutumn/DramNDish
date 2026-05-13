import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

function makeSupabase(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        },
      },
    },
  )
}

/**
 * GET /api/places/:id/reactions
 * 응답: { visit_again: number, no_visit: number, my_reaction: 'visit_again' | 'no_visit' | null }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const cookieStore = await cookies()
  const supabase = makeSupabase(cookieStore)

  const { data: { user } } = await supabase.auth.getUser()

  // 집계 카운트
  const { data: rows } = await supabase
    .from('place_reactions')
    .select('reaction_type')
    .eq('place_id', id)

  const counts = { visit_again: 0, no_visit: 0 }
  for (const row of rows ?? []) {
    if (row.reaction_type === 'visit_again') counts.visit_again++
    else if (row.reaction_type === 'no_visit')  counts.no_visit++
  }

  // 내 반응
  let my_reaction: 'visit_again' | 'no_visit' | null = null
  if (user) {
    const { data: mine } = await supabase
      .from('place_reactions')
      .select('reaction_type')
      .eq('place_id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    my_reaction = (mine?.reaction_type as typeof my_reaction) ?? null
  }

  return NextResponse.json({ ...counts, my_reaction })
}

/**
 * POST /api/places/:id/reactions
 * body: { reaction_type: 'visit_again' | 'no_visit' | null }
 *   - null → 기존 리액션 취소
 *   - 같은 타입 재전송 → 취소 (토글)
 *   - 다른 타입 전송 → 변경
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const cookieStore = await cookies()
  const supabase = makeSupabase(cookieStore)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const { reaction_type } = await req.json() as { reaction_type: 'visit_again' | 'no_visit' | null }

  // 기존 리액션 조회
  const { data: existing } = await supabase
    .from('place_reactions')
    .select('id, reaction_type')
    .eq('place_id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  // null 이거나 같은 타입 → 취소(삭제)
  if (reaction_type === null || existing?.reaction_type === reaction_type) {
    if (existing) {
      const { error } = await supabase
        .from('place_reactions')
        .delete()
        .eq('id', existing.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ my_reaction: null })
  }

  // upsert (신규 or 변경)
  const { error } = await supabase
    .from('place_reactions')
    .upsert(
      { user_id: user.id, place_id: id, reaction_type },
      { onConflict: 'user_id,place_id' },
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ my_reaction: reaction_type })
}
