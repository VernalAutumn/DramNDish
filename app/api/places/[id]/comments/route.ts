import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/src/lib/supabase'
import bcrypt from 'bcryptjs'

// GET: 코멘트 목록 조회 (최신순)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const { data, error } = await supabase
    .from('comments')
    .select('id, nickname, content, created_at, likes, dislikes')
    .eq('place_id', id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[comments GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}

// POST: 코멘트 저장 (code → bcrypt hash → password_hash)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json()
  const nickname: string = (body.nickname ?? '').trim()
  const content: string  = (body.content  ?? '').trim()
  const code: string     = (body.code     ?? '').trim()

  if (!nickname) return NextResponse.json({ error: '닉네임을 입력해주세요.' }, { status: 400 })
  if (!content)  return NextResponse.json({ error: '내용을 입력해주세요.' },   { status: 400 })
  if (!code)     return NextResponse.json({ error: '비밀번호를 입력해주세요.' }, { status: 400 })
  if (content.length > 200) return NextResponse.json({ error: '200자 이내로 입력해주세요.' }, { status: 400 })

  const password_hash = await bcrypt.hash(code, 10)

  const { data, error } = await supabase
    .from('comments')
    .insert({ place_id: id, nickname, content, password_hash })
    .select('id, nickname, content, created_at')
    .single()

  if (error) {
    console.error('[comments POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
