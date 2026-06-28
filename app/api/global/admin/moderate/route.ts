import { NextRequest, NextResponse } from 'next/server'
import { makeGlobalSSRClient } from '@/src/lib/global-server'
import { createAdminGlobalClient, createAdminClient } from '@/src/lib/supabase-admin'
import { isAdminEmail } from '@/src/lib/admin'

/**
 * DELETE /api/global/admin/moderate?type=...&id=...
 *
 * 관리자 모더레이션 — 작성자가 아니어도 콘텐츠를 삭제한다(RLS 우회, service-role).
 * 보안: 인증된 유저의 email이 관리자 허용목록(NEXT_PUBLIC_ADMIN_EMAILS)일 때만 통과.
 *
 * type → (스키마, 테이블) 매핑. 글로벌은 createAdminGlobalClient, 국내(public)는 createAdminClient.
 */
const GLOBAL_TABLE: Record<string, string> = {
  review: 'reviews',
  observation: 'observations',
  tag: 'place_tags',
  photo: 'photos',
  bottle_log: 'bottle_logs',
  bottle: 'distillery_bottles',
  tip: 'purchase_tips',
}

const PUBLIC_TABLE: Record<string, string> = {
  comment: 'comments',
  photo_kr: 'place_photos',
  tag_kr: 'tags',
}

export async function DELETE(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type')?.trim() ?? ''
  const id = req.nextUrl.searchParams.get('id')?.trim() ?? ''
  if (!type || !id) {
    return NextResponse.json({ error: 'type과 id가 필요합니다.' }, { status: 400 })
  }

  // ── 관리자 인증 (서버 재검증) ──────────────────────────────────────────
  const ssr = await makeGlobalSSRClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!isAdminEmail(user.email)) {
    return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
  }

  const globalTable = GLOBAL_TABLE[type]
  const publicTable = PUBLIC_TABLE[type]
  if (!globalTable && !publicTable) {
    return NextResponse.json({ error: '알 수 없는 대상 유형입니다.' }, { status: 400 })
  }

  let admin
  try {
    admin = globalTable ? createAdminGlobalClient() : createAdminClient()
  } catch {
    return NextResponse.json(
      { error: '서버에 SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' },
      { status: 503 }
    )
  }

  const { error } = await admin.from(globalTable ?? publicTable).delete().eq('id', id)
  if (error) {
    console.error('[admin moderate DELETE]', type, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
