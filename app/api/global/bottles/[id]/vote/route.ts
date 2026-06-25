import { NextRequest, NextResponse } from 'next/server'
import { makeGlobalSSRClient, getGlobalUser } from '@/src/lib/global-server'

/**
 * 증류소 한정 보틀 투표 (B4) — 한 보틀당 한 유저 1행(PK), 두 축 각각 1표.
 *  POST   /api/global/bottles/[id]/vote  body: { axis: 'availability'|'worth', value }
 *  DELETE /api/global/bottles/[id]/vote?axis=availability|worth        (해당 축 철회)
 *
 *  availability: 'in_stock'(있어요) | 'out_of_stock'(없어요)
 *  worth:        'must_buy'(꼭사야해) | 'meh'(굳이)
 *
 * upsert는 보낸 컬럼만 갱신하므로 반대 축 투표는 보존된다.
 */
const AXIS_VALUES: Record<string, string[]> = {
  availability: ['in_stock', 'out_of_stock'],
  worth: ['must_buy', 'meh'],
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { axis, value } = await req.json().catch(() => ({}))

  if (!AXIS_VALUES[axis] || !AXIS_VALUES[axis].includes(value)) {
    return NextResponse.json({ error: '투표 값이 올바르지 않습니다.' }, { status: 400 })
  }

  const client = await makeGlobalSSRClient()
  const user = await getGlobalUser(client)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const { error } = await client
    .from('distillery_bottle_votes')
    .upsert(
      { bottle_id: id, user_id: user.id, [axis]: value, updated_at: new Date().toISOString() },
      { onConflict: 'bottle_id,user_id' }
    )

  if (error) {
    console.error('[bottle vote POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, axis, value })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const axis = req.nextUrl.searchParams.get('axis')?.trim() ?? ''
  if (!AXIS_VALUES[axis]) {
    return NextResponse.json({ error: '철회할 축이 올바르지 않습니다.' }, { status: 400 })
  }

  const client = await makeGlobalSSRClient()
  const user = await getGlobalUser(client)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  // 해당 축만 null 로 — 반대 축 투표는 유지. (행 정리는 굳이 하지 않음: null은 집계 제외)
  const { error } = await client
    .from('distillery_bottle_votes')
    .update({ [axis]: null, updated_at: new Date().toISOString() })
    .eq('bottle_id', id)
    .eq('user_id', user.id)

  if (error) {
    console.error('[bottle vote DELETE]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, axis, value: null })
}
