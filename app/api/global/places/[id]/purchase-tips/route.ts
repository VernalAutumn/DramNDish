import { NextRequest, NextResponse } from 'next/server'
import { createDramndishClient } from '@/src/lib/supabase'
import { makeGlobalSSRClient, getGlobalUser } from '@/src/lib/global-server'

/**
 * 구매팁(방명록) — 장소 정보란의 짧은 한줄평.
 *  GET    /api/global/places/[id]/purchase-tips         목록 (공개)
 *  POST   /api/global/places/[id]/purchase-tips         작성 (로그인)  body: { body }
 *  DELETE /api/global/places/[id]/purchase-tips?tipId=  본인 글 삭제 (로그인)
 *
 * 테이블 미적용(마이그레이션 0011 미실행) 시 GET은 빈 목록(notReady)으로 내려
 * 상세 화면 전체가 깨지지 않게 한다 (§9 무반응 금지).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createDramndishClient()
  const { data, error } = await supabase
    .from('purchase_tips')
    .select('id, body, created_at, user_id, user:users!purchase_tips_user_id_fkey(nickname)')
    .eq('place_id', id)
    .order('created_at', { ascending: false })

  if (error) {
    // 42P01: 테이블 없음 / PGRST106: 스키마 미노출 → 준비 안 됨으로 구분
    if (error.code === '42P01' || error.code === 'PGRST106') {
      return NextResponse.json({ tips: [], notReady: true })
    }
    console.error('[purchase-tips GET]', error)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
  return NextResponse.json({ tips: data ?? [] })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const text: string = (body.body ?? '').trim()

  if (!text) return NextResponse.json({ error: '내용을 입력해주세요.' }, { status: 400 })
  if (text.length > 300) {
    return NextResponse.json({ error: '300자 이내로 입력해주세요.' }, { status: 400 })
  }

  const client = await makeGlobalSSRClient()
  const user = await getGlobalUser(client)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const { data, error } = await client
    .from('purchase_tips')
    .insert({ place_id: id, user_id: user.id, body: text })
    .select('id, body, created_at, user_id')
    .single()

  if (error || !data) {
    console.error('[purchase-tips POST]', error)
    return NextResponse.json({ error: '등록에 실패했습니다.' }, { status: 500 })
  }
  return NextResponse.json({ tip: data }, { status: 201 })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await params // place id는 RLS·tipId로 충분
  const tipId = req.nextUrl.searchParams.get('tipId')?.trim()
  if (!tipId) return NextResponse.json({ error: 'tipId가 필요합니다.' }, { status: 400 })

  const client = await makeGlobalSSRClient()
  const user = await getGlobalUser(client)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  // RLS(purchase_tips_delete_own)가 본인 글만 허용 — id로만 삭제 시도.
  const { error } = await client.from('purchase_tips').delete().eq('id', tipId)
  if (error) {
    console.error('[purchase-tips DELETE]', error)
    return NextResponse.json({ error: '삭제에 실패했습니다.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
