import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/src/lib/supabase'
import bcrypt from 'bcryptjs'

// GET: 해당 장소의 사진 목록
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const { data, error } = await supabase
    .from('place_photos')
    .select('id, url, nickname, created_at')
    .eq('place_id', id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[photos GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}

// POST: 사진 업로드 및 DB 저장 (code → bcrypt hash → password_hash)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const formData = await req.formData()
    const file     = formData.get('file')     as File
    const nickname = (formData.get('nickname') as string)?.trim() || '익명'
    const code     = (formData.get('code')     as string)?.trim() || ''

    if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
    if (!code) return NextResponse.json({ error: '비밀번호를 입력해주세요.' }, { status: 400 })

    const fileExt  = file.name.split('.').pop()
    const fileName = `${id}_${Date.now()}.${fileExt}`

    const { error: uploadError } = await supabase.storage
      .from('place_photos')
      .upload(fileName, file)

    if (uploadError) {
      console.error('[photos POST upload]', uploadError)
      throw uploadError
    }

    const { data: { publicUrl } } = supabase.storage
      .from('place_photos')
      .getPublicUrl(fileName)

    const password_hash = await bcrypt.hash(code, 10)

    const { data: dbData, error: dbError } = await supabase
      .from('place_photos')
      .insert({ place_id: id, url: publicUrl, nickname, password_hash })
      .select('id, url, nickname, created_at')
      .single()

    if (dbError) {
      console.error('[photos POST db]', dbError)
      throw dbError
    }

    return NextResponse.json(dbData, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
