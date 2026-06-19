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
 * 구글 Places(New) 검색으로 선택 시 lat/lng·주소·지도링크가 함께 들어와 적재된다.
 * 직접 입력도 계속 허용(좌표 없이 등록 가능).
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
  // 좌표: 구글 검색으로 선택한 경우 함께 들어온다. 숫자로 검증하고, 아니면 null.
  const lat: number | null = Number.isFinite(body.lat) ? Number(body.lat) : null
  const lng: number | null = Number.isFinite(body.lng) ? Number(body.lng) : null

  // 추가 정보(attributes): 임의 JSON을 그대로 받지 않고, 허용한 boolean 키만 통과시킨다.
  const ATTR_BOOL_KEYS = ['tax_free', 'has_tasting', 'booking_required', 'smoking', 'handfill', 'has_handfill']
  const attributes: Record<string, boolean> = {}
  if (body.attributes && typeof body.attributes === 'object') {
    for (const k of ATTR_BOOL_KEYS) {
      if (typeof body.attributes[k] === 'boolean') attributes[k] = body.attributes[k]
    }
  }

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

  // 중복 가드: 원어(name_local) 기준 우선 — 구글 Details에서 자동 적재돼 철자가 안 흔들리고
  // 보통 지점명까지 포함해 체인 지점도 구분된다. 원어가 없으면(직접 입력) 이름으로 폴백.
  // 같은 국가 안에서만 비교. (이미 중복이 여러 건이어도 안전하도록 limit(1))
  const findDup = async (col: 'name_local' | 'name', val: string) => {
    const { data } = await client
      .from('places')
      .select('id')
      .eq('country', country)
      .ilike(col, val)
      .limit(1)
    return data?.[0]?.id ?? null
  }
  let existingId: string | null = null
  if (nameLocal) existingId = await findDup('name_local', nameLocal)
  if (!existingId) existingId = await findDup('name', name)
  if (existingId) {
    return NextResponse.json(
      { error: 'duplicate', message: '같은 장소가 이미 등록되어 있습니다.', existingId },
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
      lat,
      lng,
      google_maps_url: googleMapsUrl,
      official_url: officialUrl,
      attributes,
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
