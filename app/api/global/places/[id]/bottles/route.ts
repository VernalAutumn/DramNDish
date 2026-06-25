import { NextRequest, NextResponse } from 'next/server'
import { makeGlobalSSRClient, getGlobalUser } from '@/src/lib/global-server'

/**
 * 증류소 한정 보틀 (B4) — 사진+제품명 등록 + 있어요/없어요·꼭사야해/굳이 교차검증.
 *  GET    /api/global/places/[id]/bottles            목록 + 집계 + 내 투표 (공개)
 *  POST   /api/global/places/[id]/bottles            등록 (로그인)  body: { name, photo_url? }
 *  DELETE /api/global/places/[id]/bottles?bottleId=  본인 보틀 삭제 (로그인)
 *
 * 테이블 미적용(마이그레이션 0012 미실행) 시 GET은 notReady 빈 목록으로 내려
 * 상세 화면이 깨지지 않게 한다 (§9 무반응 금지).
 */
interface VoteRow {
  bottle_id: string
  user_id: string
  availability: 'in_stock' | 'out_of_stock' | null
  worth: 'must_buy' | 'meh' | null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  // 공개 읽기지만, 로그인 유저면 myVote를 채우기 위해 SSR(쿠키) 클라이언트 사용.
  const client = await makeGlobalSSRClient()
  const {
    data: { user },
  } = await client.auth.getUser()

  const { data: bottles, error } = await client
    .from('distillery_bottles')
    .select('id, name, photo_url, user_id, created_at, user:users!distillery_bottles_user_id_fkey(nickname)')
    .eq('place_id', id)
    .order('created_at', { ascending: false })

  if (error) {
    // 테이블/스키마 미적용(마이그레이션 0012 미실행): 42P01(relation 없음) /
    // PGRST106(스키마 미노출) / PGRST205(스키마 캐시에 테이블 없음) → 준비 안 됨.
    if (error.code === '42P01' || error.code === 'PGRST106' || error.code === 'PGRST205') {
      return NextResponse.json({ bottles: [], notReady: true })
    }
    console.error('[bottles GET]', error.code, error.message, error.details)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }

  const ids = (bottles ?? []).map((b) => b.id)
  let votes: VoteRow[] = []
  if (ids.length > 0) {
    const { data: voteRows } = await client
      .from('distillery_bottle_votes')
      .select('bottle_id, user_id, availability, worth')
      .in('bottle_id', ids)
    votes = (voteRows ?? []) as VoteRow[]
  }

  const result = (bottles ?? []).map((b) => {
    const mine = votes.find((v) => v.bottle_id === b.id && v.user_id === user?.id)
    const counts = { in_stock: 0, out_of_stock: 0, must_buy: 0, meh: 0 }
    for (const v of votes) {
      if (v.bottle_id !== b.id) continue
      if (v.availability) counts[v.availability]++
      if (v.worth) counts[v.worth]++
    }
    const u = Array.isArray(b.user) ? b.user[0] : b.user
    return {
      id: b.id,
      name: b.name,
      photo_url: b.photo_url,
      user_id: b.user_id,
      created_at: b.created_at,
      nickname: u?.nickname ?? null,
      counts,
      myVote: { availability: mine?.availability ?? null, worth: mine?.worth ?? null },
    }
  })

  return NextResponse.json({ bottles: result })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const name: string = (body.name ?? '').trim()
  const photo_url: string | null = body.photo_url ? String(body.photo_url).trim() : null

  if (!name) return NextResponse.json({ error: '제품명을 입력해주세요.' }, { status: 400 })
  if (name.length > 200) {
    return NextResponse.json({ error: '제품명은 200자 이내로 입력해주세요.' }, { status: 400 })
  }

  const client = await makeGlobalSSRClient()
  const user = await getGlobalUser(client)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const { data, error } = await client
    .from('distillery_bottles')
    .insert({ place_id: id, user_id: user.id, name, photo_url })
    .select('id, name, photo_url, user_id, created_at')
    .single()

  if (error || !data) {
    console.error('[bottles POST]', error)
    return NextResponse.json({ error: '등록에 실패했습니다.' }, { status: 500 })
  }
  return NextResponse.json({ bottle: data }, { status: 201 })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await params // place id는 RLS·bottleId로 충분
  const bottleId = req.nextUrl.searchParams.get('bottleId')?.trim()
  if (!bottleId) return NextResponse.json({ error: 'bottleId가 필요합니다.' }, { status: 400 })

  const client = await makeGlobalSSRClient()
  const user = await getGlobalUser(client)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  // RLS(distillery_bottles_delete_own)가 본인 보틀만 허용.
  const { error } = await client.from('distillery_bottles').delete().eq('id', bottleId)
  if (error) {
    console.error('[bottles DELETE]', error)
    return NextResponse.json({ error: '삭제에 실패했습니다.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
