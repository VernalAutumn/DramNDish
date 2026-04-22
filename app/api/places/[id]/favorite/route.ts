import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/places/:id/favorite
 * body: { action: 'add' | 'remove' }
 *
 * 1. 로그인 체크 → 401
 * 2. favorites 테이블 insert / delete
 * 3. places.favorites_count 증감
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { action } = await req.json()

  const cookieStore = await cookies()
  const supabase = createServerClient(
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

  // ── 인증 확인 ────────────────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  // ── favorites 테이블 insert / delete ─────────────────────────────────────
  if (action === 'add') {
    const { error } = await supabase
      .from('favorites')
      .upsert(
        { user_id: user.id, place_id: id },
        { onConflict: 'user_id,place_id' },   // 중복 방지
      )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await supabase
      .from('favorites')
      .delete()
      .eq('user_id', user.id)
      .eq('place_id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── places.favorites_count 업데이트 ──────────────────────────────────────
  const { data: place } = await supabase
    .from('places')
    .select('favorites_count')
    .eq('id', id)
    .single()

  const newCount = Math.max(0, (place?.favorites_count ?? 0) + (action === 'add' ? 1 : -1))

  await supabase
    .from('places')
    .update({ favorites_count: newCount })
    .eq('id', id)

  return NextResponse.json({ favorites_count: newCount })
}
