import { NextRequest, NextResponse } from 'next/server'
import { makeGlobalSSRClient, getGlobalUser } from '@/src/lib/global-server'

/**
 * POST /api/global/reports
 * body: { target_type: 'place'|'place_type'|'bottle_log'|'review', target_id: uuid, reason: string }
 *
 * global.reports — 로그인 유저만 신고(RLS reporter_id = auth.uid()). (§8.2-8)
 */
const VALID_TYPES = ['place', 'place_type', 'bottle_log', 'review']

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const target_type: string = (body.target_type ?? '').trim()
  const target_id: string = (body.target_id ?? '').trim()
  const reason: string = (body.reason ?? '').trim()

  if (!VALID_TYPES.includes(target_type)) {
    return NextResponse.json({ error: '신고 대상 유형이 올바르지 않습니다.' }, { status: 400 })
  }
  if (!target_id) {
    return NextResponse.json({ error: '신고 대상이 없습니다.' }, { status: 400 })
  }
  if (!reason || reason.length > 500) {
    return NextResponse.json({ error: '신고 사유를 1~500자로 입력해주세요.' }, { status: 400 })
  }

  const client = await makeGlobalSSRClient()
  const user = await getGlobalUser(client)
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const { error } = await client
    .from('reports')
    .insert({ target_type, target_id, reason, reporter_id: user.id })

  if (error) {
    console.error('[global reports POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 디스코드 웹훅 알림 (국내판과 동일 채널 재사용)
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [
            {
              title: `🚨 [해외] 신고 접수 — ${target_type}`,
              color: 0xbf3a21,
              fields: [
                { name: '대상 유형', value: target_type, inline: true },
                { name: '대상 ID', value: target_id, inline: true },
                { name: '사유', value: reason },
                { name: '신고자', value: user.id, inline: true },
              ],
              timestamp: new Date().toISOString(),
            },
          ],
        }),
      })
    } catch (e) {
      console.error('[global reports webhook]', e)
    }
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}
