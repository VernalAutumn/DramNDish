import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabase } from '@/src/lib/supabase'
import bcrypt from 'bcryptjs'

async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies()
  const ssrClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(list) { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) },
      },
    },
  )
  const { data: { user } } = await ssrClient.auth.getUser()
  return user?.id ?? null
}

// GET: 장소의 태그 목록
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const { data, error } = await supabase
    .from('tags')
    .select('id, label, count, type')
    .eq('place_id', id)
    .order('count', { ascending: false })

  if (error) {
    console.error('[tags GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}

// POST: 태그 생성 or count +1(add) / count -1·삭제(remove)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const [body, userId] = await Promise.all([req.json(), getSessionUserId()])

  const label: string            = (body.label ?? '').trim()
  const type: string             = body.type ?? 'general'
  const code: string             = (body.code  ?? '').trim()
  const action: 'add' | 'remove' = body.action === 'remove' ? 'remove' : 'add'

  if (!label) {
    return NextResponse.json({ error: 'label은 필수입니다.' }, { status: 400 })
  }

  // 기존 태그 확인 (같은 label + 같은 type)
  const { data: existing, error: selectErr } = await supabase
    .from('tags')
    .select('id, label, count, type')
    .eq('place_id', id)
    .eq('label', label)
    .eq('type', type)
    .maybeSingle()

  if (selectErr) {
    console.error('[tags POST] select error:', selectErr)
    return NextResponse.json({ error: selectErr.message }, { status: 500 })
  }

  // ── remove ─────────────────────────────────────────────────────────────
  if (action === 'remove') {
    if (!existing) {
      return NextResponse.json({ error: '태그를 찾을 수 없습니다.' }, { status: 404 })
    }
    if (existing.count <= 1) {
      const { error: deleteErr } = await supabase
        .from('tags')
        .delete()
        .eq('id', existing.id)
      if (deleteErr) {
        console.error('[tags POST] delete error:', deleteErr)
        return NextResponse.json({ error: deleteErr.message }, { status: 500 })
      }
      return NextResponse.json({ deleted: true, label })
    }
    const { data: updated, error: updateErr } = await supabase
      .from('tags')
      .update({ count: existing.count - 1 })
      .eq('id', existing.id)
      .select('id, label, count, type')
      .single()
    if (updateErr) {
      console.error('[tags POST] update error:', updateErr)
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }
    return NextResponse.json(updated)
  }

  // ── add ────────────────────────────────────────────────────────────────
  if (existing) {
    // 기존 태그 → count +1
    const { data: updated, error: updateErr } = await supabase
      .from('tags')
      .update({ count: existing.count + 1 })
      .eq('id', existing.id)
      .select('id, label, count, type')
      .single()
    if (updateErr) {
      console.error('[tags POST] update error:', updateErr)
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }
    return NextResponse.json(updated)
  }

  // 신규 생성 → code bcrypt 해싱 + added_by 기록
  const password_hash = code ? await bcrypt.hash(code, 10) : null
  const { data: inserted, error: insertErr } = await supabase
    .from('tags')
    .insert({
      place_id: id,
      label,
      type,
      count: 1,
      password_hash,
      ...(userId ? { added_by: userId } : {}),
    })
    .select('id, label, count, type')
    .single()

  if (insertErr) {
    console.error('[tags POST] insert error:', insertErr)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json(inserted, { status: 201 })
}
