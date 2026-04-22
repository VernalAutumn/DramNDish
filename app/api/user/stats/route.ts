import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

/**
 * GET /api/user/stats
 * 현재 로그인 유저의 코멘트·사진 수 반환.
 * { comments: number, photos: number }
 *
 * user_id 컬럼 기준으로 카운트한다 (nickname 기준 아님).
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

  const [commentsResult, photosResult] = await Promise.all([
    supabase
      .from('comments')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
    supabase
      .from('place_photos')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
  ])

  return NextResponse.json({
    comments: commentsResult.count ?? 0,
    photos:   photosResult.count  ?? 0,
  })
}
