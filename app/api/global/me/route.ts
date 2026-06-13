import { NextResponse } from 'next/server'
import { makeGlobalSSRClient } from '@/src/lib/global-server'

/**
 * GET /api/global/me — 내 기록 모아보기 (§8.5)
 * bottle_logs(보틀·잔 사진) + reviews(매장·분위기 사진·코멘트)를 user_id로 union.
 * 본인 조회이므로 private 행도 RLS가 허용한다.
 */
export async function GET() {
  const client = await makeGlobalSSRClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) {
    return NextResponse.json({ authenticated: false })
  }

  const [placesRes, reviewsRes, logsRes] = await Promise.all([
    client
      .from('places')
      .select('id, name, type, country, region, created_at')
      .eq('contributed_by', user.id)
      .order('created_at', { ascending: false }),
    client
      .from('reviews')
      .select(
        'id, rating, comment, visited_at, photo_urls, created_at, place:places(id, name, type)'
      )
      .eq('user_id', user.id)
      .order('visited_at', { ascending: false }),
    client
      .from('bottle_logs')
      .select(
        'id, free_label, context, price, currency, photo_url, photo_urls, logged_at, visibility, product:products(display_name), place:places(id, name, type)'
      )
      .eq('user_id', user.id)
      .order('logged_at', { ascending: false }),
  ])

  if (placesRes.error) console.error('[global me] places', placesRes.error)
  if (reviewsRes.error) console.error('[global me] reviews', reviewsRes.error)
  if (logsRes.error) console.error('[global me] logs', logsRes.error)

  return NextResponse.json({
    authenticated: true,
    places: placesRes.data ?? [],
    placesFailed: !!placesRes.error,
    reviews: reviewsRes.data ?? [],
    reviewsFailed: !!reviewsRes.error,
    bottleLogs: logsRes.data ?? [],
    bottleLogsFailed: !!logsRes.error,
  })
}
