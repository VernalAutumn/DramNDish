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
  if (!['comment', 'photo', 'place'].includes(item_type)) {
    return NextResponse.json({ error: 'item_type은 comment, photo, place 중 하나여야 합니다.' }, { status: 400 })
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

  // ── 디스코드 웹훅 알림 ─────────────────────────────────────────────────────
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL
  let webhookStatus: string = webhookUrl ? 'pending' : 'no_url'

  if (webhookUrl) {
    try {
      const typeLabel: Record<string, string> = { place: '장소', comment: '댓글', photo: '사진' }
      const typeColor: Record<string, number> = { place: 0xFF4444, comment: 0xFF8C00, photo: 0xFFD700 }
      const webhookRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: `🚨 신고 접수 — ${typeLabel[item_type] ?? item_type}`,
            color: typeColor[item_type] ?? 0xBF3A21,
            fields: [
              { name: '신고 유형', value: typeLabel[item_type] ?? item_type, inline: true },
              { name: '대상 ID',   value: reported_item_id,                  inline: true },
              { name: '신고 사유', value: reason },
              { name: '신고자',    value: user?.id ?? '익명',                  inline: true },
            ],
            timestamp: new Date().toISOString(),
          }],
        }),
      })
      webhookStatus = webhookRes.ok ? 'ok' : `http_${webhookRes.status}`
      if (!webhookRes.ok) {
        const body = await webhookRes.text()
        console.error('[discord webhook] failed', webhookRes.status, body)
      }
    } catch (e) {
      webhookStatus = 'fetch_error'
      console.error('[discord webhook] exception', e)
    }
  }

  return NextResponse.json({ ok: true, webhookStatus }, { status: 201 })
}
