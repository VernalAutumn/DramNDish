import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/src/lib/supabase'
import bcrypt from 'bcryptjs'

// DELETE: 비밀번호 검증 후 태그 삭제
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; tagId: string }> }
) {
  const { tagId } = await params
  const body = await req.json()
  const code: string = (body.code ?? '').trim()

  if (!code) return NextResponse.json({ error: 'code는 필수입니다.' }, { status: 400 })

  const { data: row, error: fetchErr } = await supabase
    .from('tags')
    .select('password_hash')
    .eq('id', tagId)
    .single()

  if (fetchErr || !row) {
    return NextResponse.json({ error: '태그를 찾을 수 없습니다.' }, { status: 404 })
  }

  if (!row.password_hash) {
    return NextResponse.json({ error: '이 태그는 비밀번호가 설정되지 않았습니다.' }, { status: 403 })
  }

  const match = await bcrypt.compare(code, row.password_hash)
  if (!match) {
    return NextResponse.json({ error: '비밀번호가 일치하지 않습니다.' }, { status: 401 })
  }

  const { error: deleteErr } = await supabase
    .from('tags')
    .delete()
    .eq('id', tagId)

  if (deleteErr) {
    console.error('[tags DELETE]', deleteErr)
    return NextResponse.json({ error: deleteErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
