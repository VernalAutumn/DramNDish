import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

/**
 * GET /api/user/activity
 * 현재 로그인 유저의 최근 코멘트 + 사진 목록 (장소명 포함).
 * [{ id, type, content?, url?, created_at, place_id, place_name }]
 *
 * user_id 컬럼 기준으로 조회한다 (nickname 기준 아님).
 */
export async function GET() {
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

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const [commentsRes, photosRes] = await Promise.all([
    supabase
      .from('comments')
      .select('id, content, created_at, place_id, places(name)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('place_photos')
      .select('id, url, created_at, place_id, places(name)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  const comments = (commentsRes.data ?? []).map((row) => ({
    id:         row.id,
    type:       'comment' as const,
    content:    row.content as string,
    url:        undefined,
    created_at: row.created_at as string,
    place_id:   row.place_id as string,
    place_name: (row.places as unknown as { name: string } | null)?.name ?? '',
  }))

  const photos = (photosRes.data ?? []).map((row) => ({
    id:         row.id,
    type:       'photo' as const,
    content:    undefined,
    url:        row.url as string,
    created_at: row.created_at as string,
    place_id:   row.place_id as string,
    place_name: (row.places as unknown as { name: string } | null)?.name ?? '',
  }))

  // 최신순 병합 (최대 80개)
  const merged = [...comments, ...photos]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 80)

  return NextResponse.json(merged)
}
