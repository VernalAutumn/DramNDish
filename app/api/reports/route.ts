import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { supabase as anonClient } from '@/src/lib/supabase'

/**
 * POST /api/reports
 * body: { reported_item_id: string, item_type: 'comment' | 'photo', reason: string }
 *
 * 비회원도 신고 가능 (reporter_id = null).
 * 로그인 유저는 SSR 쿠키에서 user_id를 자동으로 읽어 저장.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))

  const reported_item_id: string = (body.reported_item_id ?? '').trim()
  const item_type: string        = (body.item_type ?? '').trim()
  const reason: string           = (body.reason ?? '').trim()

  // ── 입력 검증 ─────────────────────────────────────────────────────────────
  if (!reported_item_id) {
    return NextResponse.json({ error: '신고 대상 ID가 없습니다.' }, { status: 400 })
  }
  if (!['comment', 'photo'].includes(item_type)) {
    return NextResponse.json({ error: 'item_type은 comment 또는 photo여야 합니다.' }, { status: 400 })
  }
  if (!reason || reason.length > 500) {
    return NextResponse.json({ error: '신고 사유를 1~500자 이내로 입력해주세요.' }, { status: 400 })
  }

  // ── 로그인 유저면 reporter_id 첨부 ───────────────────────────────────────
  const cookieStore = await cookies()
  const ssrClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(list) { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) },
      },
    },
  )
  const { data: { user } } = await ssrClient.auth.getUser()

  // ── INSERT ────────────────────────────────────────────────────────────────
  const { error } = await anonClient
    .from('reports')
    .insert({
      reported_item_id,
      item_type,
      reason,
      ...(user ? { reporter_id: user.id } : {}),
    })

  if (error) {
    console.error('[reports POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}
