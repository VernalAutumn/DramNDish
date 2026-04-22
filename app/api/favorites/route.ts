import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

/**
 * GET /api/favorites
 * 현재 로그인 유저의 즐겨찾기 place_id 배열 반환.
 * 비로그인 시 빈 배열 반환 (에러 아님).
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
  if (!user) return NextResponse.json([])

  const { data, error } = await supabase
    .from('favorites')
    .select('place_id')
    .eq('user_id', user.id)

  if (error) return NextResponse.json([])
  return NextResponse.json(data.map((f) => f.place_id))
}
