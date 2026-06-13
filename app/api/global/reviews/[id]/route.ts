import { NextRequest, NextResponse } from 'next/server'
import { makeGlobalSSRClient, getGlobalUser } from '@/src/lib/global-server'

const BOTTLE_CONTEXT: Record<string, string> = {
  bar: 'bar_favorite',
  restaurant: 'restaurant_favorite',
  liquor_shop: 'shop_purchase',
  distillery: 'distillery_direct',
}

/**
 * PATCH /api/global/reviews/[id]
 * 본인 후기 전체 재편집 (§8.2-7). 별점·한줄평·사진·동반·비용·보틀 전부.
 * 연결된 bottle_log 는 지우고 다시 만든다(전체 교체 모델).
 */
export async function PATCH(
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

  // 소유·장소 유형 확인
  const { data: existing } = await client
    .from('reviews')
    .select('place_id, user_id')
    .eq('id', id)
    .maybeSingle()
  if (!existing) {
    return NextResponse.json({ error: '후기를 찾을 수 없습니다.' }, { status: 404 })
  }
  if (existing.user_id !== user.id) {
    return NextResponse.json({ error: '본인 후기만 수정할 수 있습니다.' }, { status: 403 })
  }
  const { data: place } = await client.from('places').select('type').eq('id', existing.place_id).single()
  const type: string = place?.type ?? ''

  const rating: string | null = body.rating ?? null
  const comment: string = (body.comment ?? '').trim()
  const visited_at: string = (body.visited_at ?? '').trim()
  const photoUrls: string[] = Array.isArray(body.photo_urls) ? body.photo_urls.slice(0, 5) : []
  const spendAmount = body.spend_amount != null && body.spend_amount !== '' ? Number(body.spend_amount) : null
  const spendCurrency: string | null = body.spend_currency ? String(body.spend_currency).trim() : null
  const companionType: string | null = body.companion_type ?? null
  const partySize =
    companionType === 'solo' ? 1 : body.party_size != null && body.party_size !== '' ? Number(body.party_size) : null
  const barSmoking = typeof body.bar_smoking === 'boolean' ? body.bar_smoking : null
  const barCover = typeof body.bar_cover_charge === 'boolean' ? body.bar_cover_charge : null
  const bottle = body.bottle as
    | { name?: string; product_id?: string; price?: number | string; currency?: string; photo_urls?: string[]; context?: string }
    | undefined

  if (!visited_at) return NextResponse.json({ error: '방문일을 입력해주세요.' }, { status: 400 })
  if (!rating || !['meh', 'fine', 'revisit'].includes(rating)) {
    return NextResponse.json({ error: '별점을 선택해주세요.' }, { status: 400 })
  }
  if (!comment) return NextResponse.json({ error: '한줄평을 입력해주세요.' }, { status: 400 })

  const { error: updErr } = await client
    .from('reviews')
    .update({
      visited_at,
      rating,
      comment,
      spend_amount: spendAmount,
      spend_currency: spendCurrency,
      photo_urls: photoUrls,
      companion_type: companionType,
      party_size: partySize,
      bar_smoking: type === 'bar' ? barSmoking : null,
      bar_cover_charge: type === 'bar' ? barCover : null,
    })
    .eq('id', id)
    .eq('user_id', user.id)
  if (updErr) {
    console.error('[global reviews PATCH] update', updErr)
    return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  // 연결 보틀 전체 교체
  await client.from('bottle_logs').delete().eq('review_id', id).eq('user_id', user.id)
  const hasBottle = bottle && (bottle.name?.trim() || bottle.product_id)
  if (hasBottle) {
    const photos: string[] = Array.isArray(bottle!.photo_urls) ? bottle!.photo_urls.slice(0, 5) : []
    let context = BOTTLE_CONTEXT[type] ?? 'shop_purchase'
    if (type === 'distillery' && bottle!.context && ['distillery_direct', 'distillery_tasting'].includes(bottle!.context)) {
      context = bottle!.context
    }
    await client.from('bottle_logs').insert({
      user_id: user.id,
      review_id: id,
      place_id: existing.place_id,
      product_id: bottle!.product_id || null,
      free_label: bottle!.product_id ? null : bottle!.name?.trim() || null,
      context,
      price: bottle!.price != null && bottle!.price !== '' ? Number(bottle!.price) : null,
      currency: bottle!.currency ? String(bottle!.currency).trim() : spendCurrency,
      photo_url: photos[0] ?? null,
      photo_urls: photos,
      logged_at: visited_at,
      visibility: 'public_minimal',
    })
  }

  return NextResponse.json({ ok: true })
}

/**
 * DELETE /api/global/reviews/[id]
 * 본인 후기 삭제 (§8.2-7). 파생 bottle_log 도 함께 삭제.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const client = await makeGlobalSSRClient()
  const user = await getGlobalUser(client)
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  // 파생 기록 먼저 (review FK가 on delete set null이라 순서 중요)
  const { error: logErr } = await client
    .from('bottle_logs')
    .delete()
    .eq('review_id', id)
    .eq('user_id', user.id)
  if (logErr) {
    console.error('[global reviews DELETE] logs', logErr)
    return NextResponse.json({ error: logErr.message }, { status: 500 })
  }

  const { error } = await client
    .from('reviews')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
  if (error) {
    console.error('[global reviews DELETE]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
