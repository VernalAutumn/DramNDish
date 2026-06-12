import { NextResponse } from 'next/server'
import { makeGlobalSSRClient } from '@/src/lib/global-server'

/**
 * GET /api/global/favorites → { authenticated, placeIds: string[] }
 * 내 즐겨찾기 장소 id 목록 (최근 추가순). 탐색 패널의 즐겨찾기 탭에서 사용.
 */
export async function GET() {
  const client = await makeGlobalSSRClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) {
    return NextResponse.json({ authenticated: false, placeIds: [] })
  }

  const { data, error } = await client
    .from('favorites')
    .select('place_id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[global favorites GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    authenticated: true,
    placeIds: (data ?? []).map((d) => d.place_id),
  })
}
