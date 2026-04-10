import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/src/lib/supabase'

const GEOCODE_URL = 'https://maps.apigw.ntruss.com/map-geocode/v2/geocode'

async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const res = await fetch(
    `${GEOCODE_URL}?query=${encodeURIComponent(address)}`,
    {
      headers: {
        'X-NCP-APIGW-API-KEY-ID': process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID!,
        'X-NCP-APIGW-API-KEY': process.env.NAVER_MAP_CLIENT_SECRET!,
      },
    }
  )

  if (!res.ok) return null

  const data = await res.json()
  const addr = data.addresses?.[0]
  if (!addr) return null

  return {
    lat: parseFloat(addr.y),
    lng: parseFloat(addr.x),
  }
}

// POST: 장소 등록
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, address, type, naver_place_id, district, city } = body

    // 필수 필드 검증
    if (!name || !address || !type) {
      return NextResponse.json(
        { error: 'name, address, type은 필수입니다.' },
        { status: 400 }
      )
    }

    if (!['whisky', 'restaurant'].includes(type)) {
      return NextResponse.json(
        { error: 'type은 whisky 또는 restaurant이어야 합니다.' },
        { status: 400 }
      )
    }

    // 네이버 Geocoding API로 좌표 변환
    const coords = await geocode(address)
    if (!coords) {
      return NextResponse.json(
        { error: `주소 좌표 변환 실패: "${address}"` },
        { status: 422 }
      )
    }

    // Supabase에 저장
    const { data, error } = await supabase
      .from('places')
      .insert({
        name,
        address,
        lat: coords.lat,
        lng: coords.lng,
        type,
        naver_place_id: naver_place_id ?? null,
        district: district ?? null,
        city: city ?? null,
        region: 'domestic',
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}

// GET: 전체 장소 목록 반환
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('places')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}
