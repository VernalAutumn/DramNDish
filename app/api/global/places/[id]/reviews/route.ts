import { NextRequest, NextResponse } from 'next/server'
import { makeGlobalSSRClient, getGlobalUser } from '@/src/lib/global-server'

/**
 * POST /api/global/places/[id]/reviews
 * 방문 후기 작성 (§8.3). 로그인 필수.
 *
 * 유형별 입력 (사용자 설계):
 *  - liquor_shop / distillery : 국내판처럼 코멘트만 (rating 선택)
 *  - restaurant / bar         : 상세 폼
 *      · rating 필수 (meh=아쉬움 / fine=무난 / revisit=최고)
 *      · comment 필수
 *      · rating ∈ {fine,revisit} → "가장 좋았던 메뉴/한 잔" 필수
 *        (이름 필수 + 사진 1~2장 필수) → bottle_logs 로 분리 기록
 *      · rating = meh → 사진 선택
 *      · 방문자 타입·인원·지출 = 선택
 *
 * 사진은 클라이언트가 Storage(global-photos)에 먼저 올리고 URL 배열을 보낸다.
 */
const COMMENT_ONLY = ['liquor_shop', 'distillery']
const DETAILED = ['restaurant', 'bar']

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const client = await makeGlobalSSRClient()
  const user = await getGlobalUser(client)
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  // 장소 유형 확인 (입력 검증 분기)
  const { data: place, error: placeErr } = await client
    .from('places')
    .select('type')
    .eq('id', id)
    .single()
  if (placeErr || !place) {
    return NextResponse.json({ error: '장소를 찾을 수 없습니다.' }, { status: 404 })
  }
  const type: string = place.type

  const rating: string | null = body.rating ?? null
  const comment: string = (body.comment ?? '').trim()
  const visited_at: string = (body.visited_at ?? '').trim()
  const photoUrls: string[] = Array.isArray(body.photo_urls) ? body.photo_urls.slice(0, 2) : []
  const spendAmount = body.spend_amount != null ? Number(body.spend_amount) : null
  const spendCurrency: string | null = body.spend_currency ? String(body.spend_currency).trim() : null
  const companionType: string | null = body.companion_type ?? null
  const partySize = body.party_size != null ? Number(body.party_size) : null
  const favorite = body.favorite as
    | { name?: string; price?: number; currency?: string; photo_urls?: string[] }
    | undefined

  // ── 공통 검증 ──────────────────────────────────────────────
  if (!visited_at) {
    return NextResponse.json({ error: '방문일을 입력해주세요.' }, { status: 400 })
  }
  if (rating && !['meh', 'fine', 'revisit'].includes(rating)) {
    return NextResponse.json({ error: '평가 값이 올바르지 않습니다.' }, { status: 400 })
  }
  if (companionType && !['solo', 'friends', 'couple', 'family'].includes(companionType)) {
    return NextResponse.json({ error: '방문자 타입이 올바르지 않습니다.' }, { status: 400 })
  }

  // ── 유형별 검증 ────────────────────────────────────────────
  if (DETAILED.includes(type)) {
    if (!rating) {
      return NextResponse.json({ error: '별점을 선택해주세요.' }, { status: 400 })
    }
    if (!comment) {
      return NextResponse.json({ error: '코멘트를 입력해주세요.' }, { status: 400 })
    }
    if (rating === 'fine' || rating === 'revisit') {
      if (!favorite?.name?.trim()) {
        return NextResponse.json({ error: '가장 좋았던 메뉴 이름을 입력해주세요.' }, { status: 400 })
      }
      if (!Array.isArray(favorite.photo_urls) || favorite.photo_urls.length === 0) {
        return NextResponse.json({ error: '가장 좋았던 메뉴 사진을 1장 이상 올려주세요.' }, { status: 400 })
      }
    }
  } else if (COMMENT_ONLY.includes(type)) {
    if (!comment) {
      return NextResponse.json({ error: '코멘트를 입력해주세요.' }, { status: 400 })
    }
  }

  // ── reviews insert ─────────────────────────────────────────
  const { data: review, error: reviewErr } = await client
    .from('reviews')
    .insert({
      place_id: id,
      user_id: user.id,
      visited_at,
      rating,
      comment: comment || null,
      spend_amount: spendAmount,
      spend_currency: spendCurrency,
      photo_urls: photoUrls,
      companion_type: companionType,
      party_size: partySize,
    })
    .select('id')
    .single()

  if (reviewErr || !review) {
    console.error('[global reviews POST] review', reviewErr)
    return NextResponse.json({ error: reviewErr?.message ?? '후기 저장 실패' }, { status: 500 })
  }

  // ── 좋았던 메뉴/한 잔 → bottle_logs (식당/바, 입력된 경우) ──
  if (DETAILED.includes(type) && favorite?.name?.trim()) {
    const favPhotos: string[] = Array.isArray(favorite.photo_urls)
      ? favorite.photo_urls.slice(0, 2)
      : []
    const context = type === 'bar' ? 'bar_favorite' : 'restaurant_favorite'
    const { error: logErr } = await client.from('bottle_logs').insert({
      user_id: user.id,
      review_id: review.id,
      place_id: id,
      free_label: favorite.name.trim(),
      context,
      price: favorite.price != null ? Number(favorite.price) : null,
      currency: favorite.currency ? String(favorite.currency).trim() : spendCurrency,
      photo_url: favPhotos[0] ?? null, // 하위호환
      photo_urls: favPhotos,
      logged_at: visited_at,
      visibility: 'public_minimal', // 장소 상세에 노출 (§8.2-6)
    })
    if (logErr) {
      // 후기는 이미 저장됨 — 메뉴 기록만 실패. 숨기지 않고 부분 성공 알림.
      console.error('[global reviews POST] bottle_log', logErr)
      return NextResponse.json(
        { ok: true, reviewId: review.id, favoriteSaved: false, warning: '후기는 저장됐지만 메뉴 기록에 실패했습니다.' },
        { status: 201 }
      )
    }
  }

  return NextResponse.json({ ok: true, reviewId: review.id }, { status: 201 })
}
