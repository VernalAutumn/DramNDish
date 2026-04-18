import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/src/lib/supabase'

// PATCH: 관리자 장소 정보 수정
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json()

  const allowed = ['name', 'address', 'type', 'district', 'naver_place_id']
  const payload: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) payload[key] = body[key]
  }

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: '수정할 필드가 없습니다.' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('places')
    .update(payload)
    .eq('id', id)
    .select('id, name, address, type, district, naver_place_id, lat, lng, favorites_count')
    .single()

  if (error) {
    console.error('[places PATCH]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
