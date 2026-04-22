import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { supabase as anonClient } from '@/src/lib/supabase'
import bcrypt from 'bcryptjs'

async function makeSSRClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(list) { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) },
      },
    },
  )
}

// GET: 코멘트 목록 조회 (최신순)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const { data, error } = await anonClient
    .from('comments')
    .select('id, nickname, content, created_at, likes, dislikes, user_id')
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
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await req.json()

  if (!(body.content ?? '').trim()) {
    return NextResponse.json({ error: '내용을 입력해주세요.' }, { status: 400 })
  }
  if ((body.content ?? '').length > 200) {
    return NextResponse.json({ error: '200자 이내로 입력해주세요.' }, { status: 400 })
  }

  const content: string = body.content.trim()

  // ── 로그인 여부 확인 ────────────────────────────────────────────────────
  const ssrClient = await makeSSRClient()
  const { data: { user } } = await ssrClient.auth.getUser()

  let nickname: string
  let userId: string | undefined
  let passwordHash: string | null = null

  if (user) {
    // 로그인 유저: app_nickname 사용, code 불필요
    nickname = (user.user_metadata?.app_nickname as string | undefined) || (body.nickname ?? '').trim() || '익명'
    userId   = user.id
  } else {
    // 익명 유저: nickname + code 필수
    nickname = (body.nickname ?? '').trim()
    const code: string = (body.code ?? '').trim()
    if (!nickname) return NextResponse.json({ error: '닉네임을 입력해주세요.' }, { status: 400 })
    if (!code)     return NextResponse.json({ error: '비밀번호를 입력해주세요.' }, { status: 400 })
    passwordHash = await bcrypt.hash(code, 10)
  }

  // ── DB Insert ───────────────────────────────────────────────────────────
  const { data, error } = await anonClient
    .from('comments')
    .insert({
      place_id:      id,
      nickname,
      content,
      password_hash: passwordHash,
      ...(userId ? { user_id: userId } : {}),
    })
    .select('id, nickname, content, created_at, likes, dislikes, user_id')
    .single()

  if (error) {
    console.error('[comments POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
