import { NextRequest, NextResponse } from 'next/server'
import { makeGlobalSSRClient, getGlobalUser } from '@/src/lib/global-server'

/**
 * 증류소 한정 보틀 추천/비추 (B4) — 한 보틀당 한 유저 1표(PK).
 *  POST   /api/global/bottles/[id]/vote  body: { vote: 'up' | 'down' }
 *  DELETE /api/global/bottles/[id]/vote                          (내 표 철회)
 *
 *  up = 추천 👍 / down = 비추 👎
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { vote } = await req.json().catch(() => ({}))

  if (!['up', 'down'].includes(vote)) {
    return NextResponse.json({ error: '투표 값이 올바르지 않습니다.' }, { status: 400 })
  }

  const client = await makeGlobalSSRClient()
  const user = await getGlobalUser(client)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const { error } = await client
    .from('distillery_bottle_votes')
    .upsert(
      { bottle_id: id, user_id: user.id, vote, updated_at: new Date().toISOString() },
      { onConflict: 'bottle_id,user_id' }
    )

  if (error) {
    console.error('[bottle vote POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, vote })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const client = await makeGlobalSSRClient()
  const user = await getGlobalUser(client)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const { error } = await client
    .from('distillery_bottle_votes')
    .delete()
    .eq('bottle_id', id)
    .eq('user_id', user.id)

  if (error) {
    console.error('[bottle vote DELETE]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, vote: null })
}
