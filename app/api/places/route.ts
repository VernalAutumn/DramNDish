import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabase } from '@/src/lib/supabase'
import bcrypt from 'bcryptjs'

async function getSessionUserId(): Promise<string | null> {
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
  return user?.id ?? null
}

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
    const [body, submittedBy] = await Promise.all([req.json(), getSessionUserId()])
    const {
      name, address, type, naver_place_id, district, city,
      lat: bodyLat, lng: bodyLng,
      comment, nickname, code,
      // 신규 컬럼
      corkage_type, corkage_fee, cover_charge,
    } = body

    // 비로그인 유저가 코멘트를 남기려는데 비밀번호가 없으면 거부
    // 로그인 유저(submittedBy 존재)는 code 불필요
    if (comment?.trim() && !submittedBy && !code?.trim()) {
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

    // ── 중복 등록 사전 차단: 동일 상호명 + 동일 주소 존재 여부 확인 ───────────
    const { data: existing } = await supabase
      .from('places')
      .select('id')
      .eq('name', name.trim())
      .eq('address', address.trim())
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: '이미 등록된 장소입니다.' },
        { status: 409 }
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
        submitted_by:   submittedBy,
        // 식당: 콜키지 정보
        ...(type === 'restaurant' ? {
          corkage_type: (['impossible', 'free', 'paid'].includes(corkage_type) ? corkage_type : 'impossible'),
          corkage_fee:  typeof corkage_fee === 'number' ? corkage_fee : 0,
        } : {}),
        // 바: 커버차지 금액
        ...(type === 'bar' ? {
          cover_charge: typeof cover_charge === 'number' ? Math.max(0, cover_charge) : 0,
        } : {}),
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // 첫 한 줄 평 저장
    if (comment?.trim()) {
      if (submittedBy) {
        // 로그인 유저: user_id 기록, password_hash 불필요
        await supabase.from('comments').insert({
          place_id: data.id,
          nickname: nickname?.trim() || '익명',
          content:  comment.trim(),
          user_id:  submittedBy,
        })
      } else {
        // 비로그인 유저: password_hash 필수
        const password_hash = await bcrypt.hash(code.trim(), 10)
        await supabase.from('comments').insert({
          place_id:      data.id,
          nickname:      nickname?.trim() || '익명',
          content:       comment.trim(),
          password_hash,
        })
      }
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
