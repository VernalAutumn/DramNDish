import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/src/lib/supabase'

// GET: 코멘트 목록 조회 (최신순)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const { data, error } = await supabase
    .from('comments')
    .select('id, nickname, content, created_at')
    .eq('place_id', id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[comments GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}

// POST: 코멘트 저장
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json()
  const nickname: string = (body.nickname ?? '').trim()
  const content: string  = (body.content  ?? '').trim()

  if (!nickname) return NextResponse.json({ error: '닉네임을 입력해주세요.' }, { status: 400 })
  if (!content)  return NextResponse.json({ error: '내용을 입력해주세요.' },   { status: 400 })
  if (content.length > 200) return NextResponse.json({ error: '200자 이내로 입력해주세요.' }, { status: 400 })

  const { data, error } = await supabase
    .from('comments')
    .insert({ place_id: id, nickname, content })
    .select('id, nickname, content, created_at')
    .single()

  if (error) {
    console.error('[comments POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

// DELETE: 코멘트 삭제 (id 기반)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await params  // place_id는 사용 안 하지만 params 소비 필요
  const { commentId } = await req.json()

  if (!commentId) return NextResponse.json({ error: 'commentId는 필수입니다.' }, { status: 400 })

  const { error } = await supabase
    .from('comments')
    .delete()
    .eq('id', commentId)

  if (error) {
    console.error('[comments DELETE]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
