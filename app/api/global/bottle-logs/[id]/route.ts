import { NextRequest, NextResponse } from 'next/server'
import { makeGlobalSSRClient, getGlobalUser } from '@/src/lib/global-server'

/**
 * DELETE /api/global/bottle-logs/[id]
 * 본인 구매 인증/보틀 기록 삭제 (§8.2-6 작성자 본인 삭제). RLS가 본인 행만 허용.
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

  const { error } = await client
    .from('bottle_logs')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    console.error('[global bottle-logs DELETE]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
