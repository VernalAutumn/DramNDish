import { NextRequest, NextResponse } from 'next/server'
import { makeGlobalSSRClient, getGlobalUser } from '@/src/lib/global-server'

/**
 * POST /api/global/places/[id]/bottle-logs
 * 구매 인증 (§8.2-6) — 리쿼샵·증류소에서 보틀명+가격(+사진) 기록.
 * body: { label, product_id?, price?, currency?, context, photo_urls?, logged_at }
 *  - liquor_shop → shop_purchase
 *  - distillery  → distillery_direct(현장 구매) | distillery_tasting(시음)
 * visibility=public_minimal 로 장소 상세에 공개. 작성자 본인 삭제 가능.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const label: string = (body.label ?? '').trim()
  const productId: string | null = body.product_id || null
  const context: string = (body.context ?? '').trim()
  const loggedAt: string = (body.logged_at ?? '').trim()
  const photoUrls: string[] = Array.isArray(body.photo_urls) ? body.photo_urls.slice(0, 2) : []

  if (!label && !productId) {
    return NextResponse.json({ error: '보틀명을 입력해주세요.' }, { status: 400 })
  }
  if (!loggedAt) {
    return NextResponse.json({ error: '날짜를 입력해주세요.' }, { status: 400 })
  }

  const client = await makeGlobalSSRClient()
  const user = await getGlobalUser(client)
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  // 장소 유형으로 context 검증
  const { data: place, error: placeErr } = await client
    .from('places')
    .select('type')
    .eq('id', id)
    .single()
  if (placeErr || !place) {
    return NextResponse.json({ error: '장소를 찾을 수 없습니다.' }, { status: 404 })
  }
  const allowed =
    place.type === 'liquor_shop'
      ? ['shop_purchase']
      : place.type === 'distillery'
        ? ['distillery_direct', 'distillery_tasting']
        : []
  if (!allowed.includes(context)) {
    return NextResponse.json({ error: '이 장소 유형에 맞지 않는 기록입니다.' }, { status: 400 })
  }

  const { error } = await client.from('bottle_logs').insert({
    user_id: user.id,
    place_id: id,
    product_id: productId,
    free_label: productId ? null : label, // 제품 매칭 시 표시는 display_name (§7)
    context,
    price: body.price != null && body.price !== '' ? Number(body.price) : null,
    currency: body.currency ? String(body.currency).trim() : null,
    photo_url: photoUrls[0] ?? null, // 하위호환
    photo_urls: photoUrls,
    logged_at: loggedAt,
    visibility: 'public_minimal',
  })

  if (error) {
    console.error('[global bottle-logs POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true }, { status: 201 })
}
