import { NextRequest, NextResponse } from 'next/server'
import { makeGlobalSSRClient, getGlobalUser } from '@/src/lib/global-server'

/**
 * GET  /api/global/places/[id]/favorite  → { favorited: boolean }  (로그인 시 본인 여부)
 * POST /api/global/places/[id]/favorite  body: { action: 'add' | 'remove' }
 *
 * global.favorites — 전부 본인 한정(RLS). 로그인 필수 (§9 로그인 필요).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const client = await makeGlobalSSRClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return NextResponse.json({ favorited: false, authenticated: false })

  const { data } = await client
    .from('favorites')
    .select('place_id')
    .eq('user_id', user.id)
    .eq('place_id', id)
    .maybeSingle()

  return NextResponse.json({ favorited: !!data, authenticated: true })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { action } = await req.json().catch(() => ({}))

  const client = await makeGlobalSSRClient()
  const user = await getGlobalUser(client)
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  if (action === 'add') {
    const { error } = await client
      .from('favorites')
      .upsert({ user_id: user.id, place_id: id }, { onConflict: 'user_id,place_id' })
    if (error) {
      console.error('[global favorite add]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ favorited: true })
  }

  const { error } = await client
    .from('favorites')
    .delete()
    .eq('user_id', user.id)
    .eq('place_id', id)
  if (error) {
    console.error('[global favorite remove]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ favorited: false })
}
