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

// DELETE: 소유권(user_id) 또는 비밀번호 검증 후 사진 삭제
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  const { photoId } = await params
  const body = await req.json().catch(() => ({}))
  const code: string = (body.code ?? '').trim()

  // ── 레코드 조회 ─────────────────────────────────────────────────────────
  const { data: row, error: fetchErr } = await anonClient
    .from('place_photos')
    .select('password_hash, url, user_id')
    .eq('id', photoId)
    .single()

  if (fetchErr || !row) {
    return NextResponse.json({ error: '사진을 찾을 수 없습니다.' }, { status: 404 })
  }

  // ── 인가: 로그인 유저의 소유권 or 비밀번호 확인 ─────────────────────────
  const ssrClient = await makeSSRClient()
  const { data: { user } } = await ssrClient.auth.getUser()

  const isOwner = user && row.user_id && row.user_id === user.id

  if (!isOwner) {
    // 소유자가 아닌 경우 비밀번호 필요
    if (!code) return NextResponse.json({ error: 'code는 필수입니다.' }, { status: 400 })
    if (!row.password_hash) {
      return NextResponse.json({ error: '이 사진은 비밀번호가 설정되지 않았습니다.' }, { status: 403 })
    }
    const match = await bcrypt.compare(code, row.password_hash)
    if (!match) {
      return NextResponse.json({ error: '비밀번호가 일치하지 않습니다.' }, { status: 401 })
    }
  }

  // ── Storage 파일 삭제 ────────────────────────────────────────────────────
  try {
    const urlParts = row.url.split('/place_photos/')
    if (urlParts.length > 1) {
      const filePath = urlParts[1].split('?')[0]
      await anonClient.storage.from('place_photos').remove([filePath])
    }
  } catch (e) {
    console.warn('[photos DELETE] storage remove warning:', e)
  }

  // ── DB 삭제 ─────────────────────────────────────────────────────────────
  const { error: deleteErr } = await anonClient
    .from('place_photos')
    .delete()
    .eq('id', photoId)

  if (deleteErr) {
    console.error('[photos DELETE]', deleteErr)
    return NextResponse.json({ error: deleteErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
