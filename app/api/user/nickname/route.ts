import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

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
 * PATCH /api/user/nickname
 *
 * 로그인 유저의 닉네임을 변경합니다.
 * 1. Supabase Auth user_metadata.app_nickname 업데이트
 * 2. comments 테이블 cascade update (user_id 기준)
 * 3. place_photos 테이블 cascade update (user_id 기준)
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const raw: string = (body.nickname ?? '').trim()

  if (!raw) {
    return NextResponse.json({ error: '닉네임을 입력해 주세요.' }, { status: 400 })
  }
  if (raw.length > 20) {
    return NextResponse.json({ error: '닉네임은 20자 이내로 입력해 주세요.' }, { status: 400 })
  }

  const ssrClient = await makeSSRClient()

  // ── 인증 확인 ───────────────────────────────────────────────────────────
  const { data: { user }, error: userError } = await ssrClient.auth.getUser()
  if (userError || !user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  // ── 1. Auth 메타데이터 업데이트 ─────────────────────────────────────────
  const { error: authError } = await ssrClient.auth.updateUser({
    data: { app_nickname: raw },
  })
  if (authError) {
    console.error('[nickname PATCH] auth updateUser error:', authError)
    return NextResponse.json({ error: '닉네임 저장 중 오류가 발생했습니다.' }, { status: 500 })
  }

  // ── 2. comments 캐스케이드 업데이트 ────────────────────────────────────
  const { error: commentErr } = await ssrClient
    .from('comments')
    .update({ nickname: raw })
    .eq('user_id', user.id)

  if (commentErr) {
    // RLS 제한 등으로 실패해도 auth 업데이트는 이미 완료되었으므로 경고만 기록
    console.warn('[nickname PATCH] comments cascade warn:', commentErr.message)
  }

  // ── 3. place_photos 캐스케이드 업데이트 ────────────────────────────────
  const { error: photoErr } = await ssrClient
    .from('place_photos')
    .update({ nickname: raw })
    .eq('user_id', user.id)

  if (photoErr) {
    console.warn('[nickname PATCH] place_photos cascade warn:', photoErr.message)
  }

  return NextResponse.json({ nickname: raw })
}
