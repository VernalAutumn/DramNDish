import { NextRequest, NextResponse } from 'next/server'
import { createDramndishClient } from '@/src/lib/supabase'
import { makeGlobalSSRClient, getGlobalUser } from '@/src/lib/global-server'

/**
 * GET  /api/global/places/[id]/tags → 태그 목록(투표수 + 내 투표 여부)
 * POST /api/global/places/[id]/tags body: { label } → 태그 토글 투표
 *   - 없는 라벨이면 태그 생성 + 내 1표
 *   - 있으면 내 표 토글(추가/철회)
 * 1인 1표(§8.2-5). 로그인 필수(생성·투표).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createDramndishClient()

  const { data, error } = await supabase
    .from('place_tags')
    .select('id, label, votes:tag_votes(user_id)')
    .eq('place_id', id)

  if (error) {
    if (error.code === 'PGRST106' || error.code === '42P01') {
      return NextResponse.json({ tags: [], notReady: true })
    }
    console.error('[global tags GET]', error)
    return NextResponse.json({ tags: [] })
  }

  // 현재 유저(있으면)
  let myId: string | null = null
  try {
    const ssr = await makeGlobalSSRClient()
    const {
      data: { user },
    } = await ssr.auth.getUser()
    myId = user?.id ?? null
  } catch {
    /* 비로그인 */
  }

  const tags = (data ?? [])
    .map((t) => ({
      id: t.id,
      label: t.label,
      count: (t.votes as { user_id: string }[]).length,
      mine: myId ? (t.votes as { user_id: string }[]).some((v) => v.user_id === myId) : false,
    }))
    .sort((a, b) => b.count - a.count)

  return NextResponse.json({ tags })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const label: string = (body.label ?? '').trim()

  if (!label || label.length > 30) {
    return NextResponse.json({ error: '태그는 1~30자로 입력해주세요.' }, { status: 400 })
  }

  const client = await makeGlobalSSRClient()
  const user = await getGlobalUser(client)
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  // 기존 태그 찾기 (장소당 라벨 유일)
  let { data: tag } = await client
    .from('place_tags')
    .select('id')
    .eq('place_id', id)
    .eq('label', label)
    .maybeSingle()

  // 없으면 생성 (생성자 1표 포함)
  if (!tag) {
    const { data: created, error: insErr } = await client
      .from('place_tags')
      .insert({ place_id: id, label, created_by: user.id })
      .select('id')
      .single()
    if (insErr || !created) {
      console.error('[global tags POST] insert', insErr)
      return NextResponse.json({ error: insErr?.message ?? '태그 생성 실패' }, { status: 500 })
    }
    tag = created
    await client.from('tag_votes').insert({ tag_id: tag.id, user_id: user.id })
    return NextResponse.json({ id: tag.id, label, voted: true })
  }

  // 있으면 내 표 토글
  const { data: existingVote } = await client
    .from('tag_votes')
    .select('tag_id')
    .eq('tag_id', tag.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (existingVote) {
    await client.from('tag_votes').delete().eq('tag_id', tag.id).eq('user_id', user.id)
    return NextResponse.json({ id: tag.id, label, voted: false })
  }
  const { error: voteErr } = await client.from('tag_votes').insert({ tag_id: tag.id, user_id: user.id })
  if (voteErr && voteErr.code !== '23505') {
    console.error('[global tags POST] vote', voteErr)
    return NextResponse.json({ error: voteErr.message }, { status: 500 })
  }
  return NextResponse.json({ id: tag.id, label, voted: true })
}
