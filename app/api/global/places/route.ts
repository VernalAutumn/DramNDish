import { NextRequest, NextResponse } from 'next/server'
import { createDramndishClient } from '@/src/lib/supabase'

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
