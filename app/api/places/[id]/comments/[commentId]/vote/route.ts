import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/src/lib/supabase'

// POST: 코멘트 찬반 투표 (+1)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  const { commentId } = await params
  const body = await req.json()
  const type: 'like' | 'dislike' = body.type

  if (type !== 'like' && type !== 'dislike') {
    return NextResponse.json({ error: 'type은 like 또는 dislike여야 합니다.' }, { status: 400 })
  }

  const { data: row, error: fetchErr } = await supabase
    .from('comments')
    .select('likes, dislikes')
    .eq('id', commentId)
    .single()

  if (fetchErr || !row) {
    return NextResponse.json({ error: '코멘트를 찾을 수 없습니다.' }, { status: 404 })
  }

  const update = type === 'like'
    ? { likes: row.likes + 1 }
    : { dislikes: row.dislikes + 1 }

  const { data: updated, error: updateErr } = await supabase
    .from('comments')
    .update(update)
    .eq('id', commentId)
    .select('id, likes, dislikes')
    .single()

  if (updateErr) {
    console.error('[vote POST]', updateErr)
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json(updated)
}
