import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createAdminClient, createAdminGlobalClient } from '@/src/lib/supabase-admin'

const ANON_NAME = '탈퇴한 사용자'

async function makeSSRClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(list) {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        },
      },
    },
  )
}

/**
 * DELETE /api/account
 *
 * 로그인 본인 계정을 영구 삭제한다. (되돌릴 수 없음 — UI에서 의지 재확인 후 호출)
 *
 * 데이터 정책 (유저 결정: 익명화):
 *  - 공동체 데이터(장소·후기·댓글·태그·사진)는 내용 유지, 작성자만 '탈퇴한 사용자'로 익명화.
 *  - 개인 데이터(즐겨찾기·반응/투표·신고)는 삭제.
 *  - 인증 계정(auth.users)은 service-role로 영구 삭제.
 *
 * ⚠ 선행 조건:
 *  - env SUPABASE_SERVICE_ROLE_KEY
 *  - 마이그레이션 20260619_0009_account_deletion.sql 적용
 *    (공동체 테이블 user 컬럼 nullable + 글로벌 FK on delete set null)
 *  미적용 시 일부 익명화 UPDATE가 실패하지만, 본 라우트는 best-effort로 진행하고
 *  실패 항목을 warnings로 반환한다 (계정 삭제 자체는 시도).
 */
export async function DELETE() {
  const ssr = await makeSSRClient()

  // ── 인증 확인 (본인만) ────────────────────────────────────────────────
  const { data: { user }, error: userErr } = await ssr.auth.getUser()
  if (userErr || !user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }
  const uid = user.id

  let admin, adminG
  try {
    admin = createAdminClient()
    adminG = createAdminGlobalClient()
  } catch {
    return NextResponse.json(
      { error: '서버에 SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않아 탈퇴를 처리할 수 없습니다.' },
      { status: 503 },
    )
  }

  const warnings: string[] = []
  const warn = (label: string, e: { message: string } | null) => {
    if (e) warnings.push(`${label}: ${e.message}`)
  }

  // ── 국내(public): 공동체 데이터 익명화 ─────────────────────────────────
  warn('comments', (await admin.from('comments')
    .update({ nickname: ANON_NAME, user_id: null }).eq('user_id', uid)).error)
  warn('place_photos', (await admin.from('place_photos')
    .update({ nickname: ANON_NAME, user_id: null }).eq('user_id', uid)).error)
  warn('places', (await admin.from('places')
    .update({ contributor_nickname: ANON_NAME, submitted_by: null }).eq('submitted_by', uid)).error)
  // public.tags 는 작성자 컬럼이 없어 익명화 대상 아님.

  // ── 국내(public): 개인 데이터 삭제 ─────────────────────────────────────
  warn('favorites', (await admin.from('favorites').delete().eq('user_id', uid)).error)
  warn('place_reactions', (await admin.from('place_reactions').delete().eq('user_id', uid)).error)
  warn('reports', (await admin.from('reports').delete().eq('reporter_id', uid)).error)

  // ── 글로벌(global): 공동체 데이터 익명화 (user_id → null) ───────────────
  //    place_tags.created_by 는 스키마상 on delete set null 이라 계정 삭제 시 자동 익명화.
  warn('global.reviews', (await adminG.from('reviews')
    .update({ user_id: null }).eq('user_id', uid)).error)
  warn('global.bottle_logs', (await adminG.from('bottle_logs')
    .update({ user_id: null }).eq('user_id', uid)).error)
  warn('global.observations', (await adminG.from('observations')
    .update({ user_id: null }).eq('user_id', uid)).error)
  warn('global.photos', (await adminG.from('photos')
    .update({ user_id: null }).eq('user_id', uid)).error)

  // ── 글로벌(global): 개인 데이터 삭제 ───────────────────────────────────
  warn('global.favorites', (await adminG.from('favorites').delete().eq('user_id', uid)).error)
  warn('global.review_votes', (await adminG.from('review_votes').delete().eq('user_id', uid)).error)
  warn('global.tag_votes', (await adminG.from('tag_votes').delete().eq('user_id', uid)).error)
  warn('global.reports', (await adminG.from('reports').delete().eq('reporter_id', uid)).error)
  warn('global.itineraries', (await adminG.from('itineraries').delete().eq('user_id', uid)).error)

  // ── 인증 계정 영구 삭제 (마지막) ───────────────────────────────────────
  //    global.users 행은 auth.users on delete cascade 로 함께 삭제된다.
  //    위에서 공동체 콘텐츠를 미리 익명화(null)했으므로 cascade로 사라지지 않는다.
  const { error: delErr } = await admin.auth.admin.deleteUser(uid)
  if (delErr) {
    console.error('[account DELETE] auth deleteUser error:', delErr, 'warnings:', warnings)
    return NextResponse.json(
      { error: '계정 삭제 중 오류가 발생했습니다.', detail: delErr.message, warnings },
      { status: 500 },
    )
  }

  if (warnings.length) {
    console.warn('[account DELETE] 익명화/삭제 경고 (계정은 삭제됨):', warnings)
  }
  return NextResponse.json({ ok: true, warnings })
}
