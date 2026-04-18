import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/src/lib/supabase'
import bcrypt from 'bcryptjs'

const GEOCODE_URL = 'https://maps.apigw.ntruss.com/map-geocode/v2/geocode'

async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const res = await fetch(
    `${GEOCODE_URL}?query=${encodeURIComponent(address)}`,
    {
      headers: {
        'X-NCP-APIGW-API-KEY-ID': process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID!,
        'X-NCP-APIGW-API-KEY':    process.env.NAVER_MAP_CLIENT_SECRET!,
      },
    }
  )
  if (!res.ok) return null
  const data = await res.json()
  const addr = data.addresses?.[0]
  if (!addr) return null
  return { lat: parseFloat(addr.y), lng: parseFloat(addr.x) }
}

// POST: 장소 등록
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, address, type, naver_place_id, district, city, lat: bodyLat, lng: bodyLng, comment, nickname, code } = body

    // 코멘트가 있는데 비밀번호가 없으면 거부
    if (comment?.trim() && !code?.trim()) {
      return NextResponse.json(
        { error: '코멘트 등록 시 비밀번호(code)가 필요합니다.' },
        { status: 400 }
      )
    }

    if (!name || !address || !type) {
      return NextResponse.json(
        { error: 'name, address, type은 필수입니다.' },
        { status: 400 }
      )
    }

    if (!['whisky', 'bar', 'restaurant'].includes(type)) {
      return NextResponse.json(
        { error: 'type은 whisky, bar, restaurant 중 하나여야 합니다.' },
        { status: 400 }
      )
    }

    // 좌표가 이미 제공된 경우 Geocoding 생략
    let lat: number
    let lng: number
    if (typeof bodyLat === 'number' && typeof bodyLng === 'number') {
      lat = bodyLat
      lng = bodyLng
    } else {
      const coords = await geocode(address)
      if (!coords) {
        return NextResponse.json(
          { error: `주소 좌표 변환 실패: "${address}"` },
          { status: 422 }
        )
      }
      lat = coords.lat
      lng = coords.lng
    }

    const { data, error } = await supabase
      .from('places')
      .insert({
        name,
        address,
        lat,
        lng,
        type,
        naver_place_id: naver_place_id ?? null,
        district:       district       ?? null,
        city:           city           ?? null,
        region:         'domestic',
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // 첫 한 줄 평 저장
    if (comment?.trim()) {
      const password_hash = await bcrypt.hash(code.trim(), 10)
      await supabase.from('comments').insert({
        place_id:      data.id,
        nickname:      nickname?.trim() || '익명',
        content:       comment.trim(),
        password_hash,
      })
    }

    return NextResponse.json(data, { status: 201 })
  } catch {
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}

// GET: 전체 장소 목록 반환
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('places')
      .select('*, tags(id, type, label, count)')
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}
