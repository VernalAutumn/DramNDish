import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { supabase as anonClient } from '@/src/lib/supabase'
import bcrypt from 'bcryptjs'

// ── SSR 클라이언트 (쿠키 기반 auth) ──────────────────────────────────────────
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

// GET: 장소 사진 목록
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const { data, error } = await anonClient
    .from('place_photos')
    .select('id, url, nickname, created_at, user_id')
    .eq('place_id', id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[photos GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data ?? [])
}

// POST: 사진 업로드
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  try {
    const formData = await req.formData()
    const file     = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })

    // ── 로그인 여부 확인 ────────────────────────────────────────────────────
    const ssrClient = await makeSSRClient()
    const { data: { user } } = await ssrClient.auth.getUser()

    let nickname: string
    let userId: string | undefined
    let passwordHash: string | null = null

    if (user) {
      // 로그인 유저: app_nickname 사용, code 불필요
      nickname = (user.user_metadata?.app_nickname as string | undefined) || '익명'
      userId   = user.id
    } else {
      // 익명 유저: nickname + code 필수
      nickname = (formData.get('nickname') as string | null)?.trim() || '익명'
      const code = (formData.get('code') as string | null)?.trim() || ''
      if (!code) return NextResponse.json({ error: '비밀번호를 입력해주세요.' }, { status: 400 })
      passwordHash = await bcrypt.hash(code, 10)
    }

    // ── Storage 업로드 ──────────────────────────────────────────────────────
    const fileExt  = file.name.split('.').pop()
    const fileName = `${id}_${Date.now()}.${fileExt}`

    const { error: uploadError } = await anonClient.storage
      .from('place_photos')
      .upload(fileName, file)

    if (uploadError) {
      console.error('[photos POST upload]', uploadError)
      throw uploadError
    }

    const { data: { publicUrl } } = anonClient.storage
      .from('place_photos')
      .getPublicUrl(fileName)

    // ── DB Insert ───────────────────────────────────────────────────────────
    const { data: dbData, error: dbError } = await anonClient
      .from('place_photos')
      .insert({
        place_id:      id,
        url:           publicUrl,
        nickname,
        password_hash: passwordHash,
        ...(userId ? { user_id: userId } : {}),
      })
      .select('id, url, nickname, created_at, user_id')
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
