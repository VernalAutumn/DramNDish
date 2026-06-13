import { NextRequest, NextResponse } from 'next/server'
import { makeGlobalSSRClient, getGlobalUser } from '@/src/lib/global-server'

/**
 * POST /api/global/places/[id]/reviews
 * 방문 후기 작성 (§8.3). 로그인 필수.
 *
 * 공통 필수: 별점(1~3성) + 한줄평. 그 외(메뉴·사진·가격·동반·비용)는 전부 선택.
 * 유형별 보틀 기록(있으면 bottle_logs 로 분리 기록, review_id 연결):
 *  - bar         → bar_favorite (좋았던 한 잔)
 *  - restaurant  → restaurant_favorite (좋았던 메뉴)
 *  - liquor_shop → shop_purchase (구매 인증)
 *  - distillery  → distillery_direct | distillery_tasting (구매 인증)
 * 보틀 기록은 후기에서도 보이고 상세의 구매 인증 섹션에서도 보인다 (public_minimal).
 *
 * 사진은 클라이언트가 Storage(global-photos)에 먼저 올리고 URL 배열을 보낸다.
 */
const BOTTLE_CONTEXT: Record<string, string> = {
  bar: 'bar_favorite',
  restaurant: 'restaurant_favorite',
  liquor_shop: 'shop_purchase',
  distillery: 'distillery_direct',
}

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
  const spendAmount = body.spend_amount != null && body.spend_amount !== '' ? Number(body.spend_amount) : null
  const spendCurrency: string | null = body.spend_currency ? String(body.spend_currency).trim() : null
  const companionType: string | null = body.companion_type ?? null
  const partySize =
    companionType === 'solo' ? 1 : body.party_size != null && body.party_size !== '' ? Number(body.party_size) : null
  const barSmoking = typeof body.bar_smoking === 'boolean' ? body.bar_smoking : null
  const barCover = typeof body.bar_cover_charge === 'boolean' ? body.bar_cover_charge : null

  // 보틀 기록 (좋았던 메뉴/한 잔 또는 구매 인증) — 전부 선택
  const bottle = body.bottle as
    | {
        name?: string
        product_id?: string
        price?: number | string
        currency?: string
        photo_urls?: string[]
        context?: string // 증류소: distillery_direct | distillery_tasting
      }
    | undefined

  // ── 공통 검증: 별점 + 한줄평만 필수 ──
  if (!visited_at) {
    return NextResponse.json({ error: '방문일을 입력해주세요.' }, { status: 400 })
  }
  if (!rating || !['meh', 'fine', 'revisit'].includes(rating)) {
    return NextResponse.json({ error: '별점을 선택해주세요.' }, { status: 400 })
  }
  if (!comment) {
    return NextResponse.json({ error: '한줄평을 입력해주세요.' }, { status: 400 })
  }
  if (companionType && !['solo', 'friends', 'couple', 'family'].includes(companionType)) {
    return NextResponse.json({ error: '방문자 타입이 올바르지 않습니다.' }, { status: 400 })
  }

  // ── reviews insert ──
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
      bar_smoking: type === 'bar' ? barSmoking : null,
      bar_cover_charge: type === 'bar' ? barCover : null,
    })
    .select('id')
    .single()

  if (reviewErr || !review) {
    console.error('[global reviews POST] review', reviewErr)
    return NextResponse.json({ error: reviewErr?.message ?? '후기 저장 실패' }, { status: 500 })
  }

  // ── 보틀 기록 (입력된 경우만) → bottle_logs ──
  const hasBottle = bottle && (bottle.name?.trim() || bottle.product_id)
  if (hasBottle) {
    const photos: string[] = Array.isArray(bottle!.photo_urls) ? bottle!.photo_urls.slice(0, 2) : []
    // 증류소는 폼에서 현장구매/시음 구분, 그 외는 유형 기본값
    let context = BOTTLE_CONTEXT[type] ?? 'shop_purchase'
    if (type === 'distillery' && bottle!.context && ['distillery_direct', 'distillery_tasting'].includes(bottle!.context)) {
      context = bottle!.context
    }
    const { error: logErr } = await client.from('bottle_logs').insert({
      user_id: user.id,
      review_id: review.id,
      place_id: id,
      product_id: bottle!.product_id || null,
      free_label: bottle!.product_id ? null : (bottle!.name?.trim() || null),
      context,
      price: bottle!.price != null && bottle!.price !== '' ? Number(bottle!.price) : null,
      currency: bottle!.currency ? String(bottle!.currency).trim() : spendCurrency,
      photo_url: photos[0] ?? null,
      photo_urls: photos,
      logged_at: visited_at,
      visibility: 'public_minimal',
    })
    if (logErr) {
      console.error('[global reviews POST] bottle_log', logErr)
      return NextResponse.json(
        { ok: true, reviewId: review.id, bottleSaved: false, warning: '후기는 저장됐지만 보틀 기록에 실패했습니다.' },
        { status: 201 }
      )
    }
  }

  return NextResponse.json({ ok: true, reviewId: review.id }, { status: 201 })
}
