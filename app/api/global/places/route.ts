import { NextRequest, NextResponse } from 'next/server'
import { createDramndishClient } from '@/src/lib/supabase'
import { makeGlobalSSRClient, getGlobalUser } from '@/src/lib/global-server'

/**
 * GET /api/global/places?country=JP&type=liquor_shop
 * dramndish Global(해외) 장소 목록 — /global 탐색 화면에서 사용.
 *
 * global 스키마가 아직 DB에 적용/노출되지 않은 상태(마이그레이션 미실행,
 * Exposed schemas 미설정)는 503 not_ready로 구분해 내려준다 —
 * 클라이언트가 "준비 안 됨"을 일시 오류와 구분해 정직하게 표시하기 위함 (§9).
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const country = searchParams.get('country')
    const type = searchParams.get('type')

    const supabase = createDramndishClient()
    let query = supabase
      .from('places')
      .select(
        'id, name, name_local, type, subkind, country, region, address, lat, lng, source, google_maps_url, official_url, attributes, created_at, contributor:users!places_contributed_by_fkey(nickname)'
      )
      .order('created_at', { ascending: true })

    if (country) query = query.eq('country', country)
    if (type) query = query.eq('type', type)

    const { data, error } = await query

    if (error) {
      // PGRST106: 스키마가 Data API에 노출되지 않음 / 42P01: 테이블 없음(마이그레이션 미적용)
      if (error.code === 'PGRST106' || error.code === '42P01') {
        return NextResponse.json(
          { error: 'not_ready', detail: error.message },
          { status: 503 }
        )
      }
      console.error('[api/global/places] supabase error:', error)
      return NextResponse.json({ error: 'server_error' }, { status: 500 })
    }

    return NextResponse.json({ places: data ?? [] })
  } catch (e) {
    console.error('[api/global/places] error:', e)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}

/**
 * POST /api/global/places — 커뮤니티 장소 등록 (§8.6, 로그인 필수)
 * 필수 = 사실 최소치(이름·유형·국가). 태그·후기 등은 등록 후 선택 (§8.6).
 * TODO(§8.6): 구글 Places 검색(세션 토큰) ingest — API 키 연동 후.
 *   현재는 수동 입력. 좌표(lat/lng)는 Places 연동 시 자동 적재 예정.
 */
const PLACE_TYPES = ['liquor_shop', 'bar', 'restaurant', 'distillery']
const COUNTRY_RE = /^[A-Z]{2}$/

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const name: string = (body.name ?? '').trim()
  const nameLocal: string | null = body.name_local ? String(body.name_local).trim() : null
  const type: string = (body.type ?? '').trim()
  const subkind: string | null = body.subkind ? String(body.subkind).trim() : null
  const country: string = (body.country ?? '').trim().toUpperCase()
  const region: string | null = body.region ? String(body.region).trim() : null
  const address: string | null = body.address ? String(body.address).trim() : null
  const googleMapsUrl: string | null = body.google_maps_url ? String(body.google_maps_url).trim() : null
  const officialUrl: string | null = body.official_url ? String(body.official_url).trim() : null

  if (!name) return NextResponse.json({ error: '장소 이름을 입력해주세요.' }, { status: 400 })
  if (!PLACE_TYPES.includes(type)) {
    return NextResponse.json({ error: '장소 유형을 선택해주세요.' }, { status: 400 })
  }
  if (!COUNTRY_RE.test(country)) {
    return NextResponse.json({ error: '국가를 선택해주세요.' }, { status: 400 })
  }
  if (subkind && (type !== 'distillery' || !['distillery', 'ib_shop'].includes(subkind))) {
    return NextResponse.json({ error: '증류소 구분이 올바르지 않습니다.' }, { status: 400 })
  }

  const client = await makeGlobalSSRClient()
  const user = await getGlobalUser(client)
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  // 중복 가드: 같은 국가에 같은 이름이 이미 있으면 등록 대신 안내
  const { data: dup } = await client
    .from('places')
    .select('id, name, address')
    .eq('country', country)
    .ilike('name', name)
    .maybeSingle()
  if (dup) {
    return NextResponse.json(
      { error: 'duplicate', message: '같은 이름의 장소가 이미 등록되어 있습니다.', existingId: dup.id },
      { status: 409 }
    )
  }

  const { data: created, error } = await client
    .from('places')
    .insert({
      name,
      name_local: nameLocal,
      type,
      subkind: type === 'distillery' ? subkind : null,
      country,
      region,
      address,
      google_maps_url: googleMapsUrl,
      official_url: officialUrl,
      source: 'community',
      contributed_by: user.id,
    })
    .select('id')
    .single()

  if (error || !created) {
    console.error('[api/global/places POST]', error)
    return NextResponse.json({ error: error?.message ?? '등록 실패' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, id: created.id }, { status: 201 })
}
