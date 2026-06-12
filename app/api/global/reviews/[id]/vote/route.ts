import { NextRequest, NextResponse } from 'next/server'
import { makeGlobalSSRClient, getGlobalUser } from '@/src/lib/global-server'

/**
 * POST   /api/global/reviews/[id]/vote  body: { vote: 'helpful' | 'not_helpful' }
 * DELETE /api/global/reviews/[id]/vote                              (내 표 철회)
 *
 * review_votes — 한줄평 유용/비유용 (좋아요 대신, 구글 리뷰식). 1인 1표(PK).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { vote } = await req.json().catch(() => ({}))

  if (!['helpful', 'not_helpful'].includes(vote)) {
    return NextResponse.json({ error: '투표 값이 올바르지 않습니다.' }, { status: 400 })
  }

  const client = await makeGlobalSSRClient()
  const user = await getGlobalUser(client)
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const { error } = await client
    .from('review_votes')
    .upsert({ review_id: id, user_id: user.id, vote }, { onConflict: 'review_id,user_id' })

  if (error) {
    console.error('[global review vote POST]', error)
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
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const { error } = await client
    .from('review_votes')
    .delete()
    .eq('review_id', id)
    .eq('user_id', user.id)

  if (error) {
    console.error('[global review vote DELETE]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, vote: null })
}
