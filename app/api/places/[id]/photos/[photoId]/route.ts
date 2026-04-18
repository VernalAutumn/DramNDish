import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/src/lib/supabase'
import bcrypt from 'bcryptjs'

// DELETE: 비밀번호 검증 후 사진 삭제 (Storage + DB)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const { photoId } = await params
  const body = await req.json()
  const code: string = (body.code ?? '').trim()

  if (!code) return NextResponse.json({ error: 'code는 필수입니다.' }, { status: 400 })

  const { data: row, error: fetchErr } = await supabase
    .from('place_photos')
    .select('password_hash, url')
    .eq('id', photoId)
    .single()

  if (fetchErr || !row) {
    return NextResponse.json({ error: '사진을 찾을 수 없습니다.' }, { status: 404 })
  }

  if (!row.password_hash) {
    return NextResponse.json({ error: '이 사진은 비밀번호가 설정되지 않았습니다.' }, { status: 403 })
  }

  const match = await bcrypt.compare(code, row.password_hash)
  if (!match) {
    return NextResponse.json({ error: '비밀번호가 일치하지 않습니다.' }, { status: 401 })
  }

  // Storage 파일 삭제 (URL에서 파일명 추출)
  try {
    const urlParts = row.url.split('/place_photos/')
    if (urlParts.length > 1) {
      const filePath = urlParts[1].split('?')[0]
      await supabase.storage.from('place_photos').remove([filePath])
    }
  } catch (e) {
    console.warn('[photos DELETE] storage remove warning:', e)
  }

  const { error: deleteErr } = await supabase
    .from('place_photos')
    .delete()
    .eq('id', photoId)

  if (deleteErr) {
    console.error('[photos DELETE]', deleteErr)
    return NextResponse.json({ error: deleteErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
