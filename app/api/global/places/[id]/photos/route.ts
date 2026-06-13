import { NextRequest, NextResponse } from 'next/server'
import { makeGlobalSSRClient, getGlobalUser } from '@/src/lib/global-server'

/**
 * POST /api/global/places/[id]/photos
 * body: { url: string, caption?: string }
 * 설명과 함께 사진 한 장 등록 (§8.5 사진 탭). 로그인 필수.
 * 사진은 클라이언트가 Storage(global-photos)에 먼저 올리고 URL을 보낸다.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const url: string = (body.url ?? '').trim()
  const caption: string | null = body.caption ? String(body.caption).trim().slice(0, 200) : null

  if (!url) {
    return NextResponse.json({ error: '사진이 필요합니다.' }, { status: 400 })
  }

  const client = await makeGlobalSSRClient()
  const user = await getGlobalUser(client)
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const { error } = await client
    .from('photos')
    .insert({ place_id: id, user_id: user.id, url, caption })

  if (error) {
    console.error('[global photos POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true }, { status: 201 })
}
