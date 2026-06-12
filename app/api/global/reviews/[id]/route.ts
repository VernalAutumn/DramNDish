import { NextRequest, NextResponse } from 'next/server'
import { makeGlobalSSRClient, getGlobalUser } from '@/src/lib/global-server'

/**
 * DELETE /api/global/reviews/[id]
 * 본인 후기 삭제 (§8.2-7 작성자 본인). 후기에서 파생된 "좋았던 메뉴/한 잔"
 * bottle_log 도 함께 삭제한다 (FK는 set null이라 명시적으로 지워야 고아가 안 남음).
 * TODO: 본인 수정(§8.2-7)은 후속 — 현재는 삭제 후 재작성으로 갈음.
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
