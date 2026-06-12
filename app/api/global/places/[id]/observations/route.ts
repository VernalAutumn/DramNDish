import { NextRequest, NextResponse } from 'next/server'
import { makeGlobalSSRClient, getGlobalUser } from '@/src/lib/global-server'

/**
 * POST /api/global/places/[id]/observations
 * body: { obs_type, value_bucket?, value_text?, note?, observed_at }
 *
 * global.observations — 휘발성 데이터(잔량·가격·재고·투어정보) 수집 (§8.4).
 * 로그인 필수. 검증 상태(미확정/확정)는 observations_with_status 뷰가 자동 계산.
 */
const VALID_OBS = ['cask_level', 'bottle_level', 'price', 'stock', 'tour_info']
const VALID_BUCKET = ['plenty', 'half', 'low', 'unknown']

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const obs_type: string = (body.obs_type ?? '').trim()
  const value_bucket: string | null = body.value_bucket ? String(body.value_bucket).trim() : null
  const value_text: string | null = body.value_text ? String(body.value_text).trim() : null
  const note: string | null = body.note ? String(body.note).trim() : null
  const observed_at: string = (body.observed_at ?? '').trim()

  if (!VALID_OBS.includes(obs_type)) {
    return NextResponse.json({ error: '관찰 유형이 올바르지 않습니다.' }, { status: 400 })
  }
  if (value_bucket && !VALID_BUCKET.includes(value_bucket)) {
    return NextResponse.json({ error: '잔량 값이 올바르지 않습니다.' }, { status: 400 })
  }
  // 잔량형(cask/bottle)은 버킷, 그 외는 자유값 — 둘 중 하나는 있어야 함
  if (!value_bucket && !value_text) {
    return NextResponse.json({ error: '관찰 값을 입력해주세요.' }, { status: 400 })
  }
  if (!observed_at) {
    return NextResponse.json({ error: '관찰일을 입력해주세요.' }, { status: 400 })
  }

  const client = await makeGlobalSSRClient()
  const user = await getGlobalUser(client)
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const { error } = await client.from('observations').insert({
    place_id: id,
    user_id: user.id,
    obs_type,
    value_bucket,
    value_text,
    note,
    observed_at,
  })

  if (error) {
    console.error('[global observations POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}
