import { NextRequest, NextResponse } from 'next/server'
import { createDramndishClient } from '@/src/lib/supabase'
import { makeGlobalSSRClient } from '@/src/lib/global-server'
import { createAdminGlobalClient } from '@/src/lib/supabase-admin'
import { isAdminEmail } from '@/src/lib/admin'

/**
 * GET /api/global/places/[id]
 * 해외 장소 상세(§8.2) — 장소 + 한줄평(재방문 집계 포함) + 구매 인증(bottle_logs,
 * RLS로 public_minimal 행만 내려옴) + 관찰 데이터(검증 상태 뷰).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = createDramndishClient()

    const [placeRes, reviewsRes, logsRes, obsRes, photosRes] = await Promise.all([
      supabase
        .from('places')
        .select('*, contributor:users!places_contributed_by_fkey(nickname)')
        .eq('id', id)
        .single(),
      supabase
        .from('reviews')
        .select(
          'id, user_id, rating, comment, visited_at, photo_urls, companion_type, party_size, bar_smoking, bar_cover_charge, shop_had_tasting, shop_tax_free, created_at, user:users!reviews_user_id_fkey(nickname), votes:review_votes(vote, user_id)'
        )
        .eq('place_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('bottle_logs')
        .select(
          'id, user_id, review_id, free_label, context, price, currency, fx_to_krw, photo_url, photo_urls, logged_at, product:products(display_name), user:users!bottle_logs_user_id_fkey(nickname)'
        )
        .eq('place_id', id)
        .order('logged_at', { ascending: false }),
      supabase
        .from('observations_with_status')
        .select(
          'id, user_id, obs_type, value_bucket, value_text, note, observed_at, verification_status'
        )
        .eq('place_id', id)
        .order('observed_at', { ascending: false }),
      supabase
        .from('photos')
        .select('id, user_id, url, caption, created_at, user:users!photos_user_id_fkey(nickname)')
        .eq('place_id', id)
        .order('created_at', { ascending: false }),
    ])

    // 관찰 작성자 닉네임 병합 (§8.4 출처 노출). 뷰는 FK 임베딩이 안 되므로 별도 조회.
    let observations = obsRes.data ?? []
    if (observations.length > 0) {
      const uids = [...new Set(observations.map((o) => o.user_id).filter(Boolean))]
      if (uids.length > 0) {
        const { data: us } = await supabase.from('users').select('id, nickname').in('id', uids)
        const nameById = new Map((us ?? []).map((u) => [u.id, u.nickname]))
        observations = observations.map((o) => ({
          ...o,
          nickname: nameById.get(o.user_id) ?? null,
        }))
      }
    }

    if (placeRes.error) {
      if (placeRes.error.code === 'PGRST116') {
        return NextResponse.json({ error: 'not_found' }, { status: 404 })
      }
      if (placeRes.error.code === 'PGRST106' || placeRes.error.code === '42P01') {
        return NextResponse.json(
          { error: 'not_ready', detail: placeRes.error.message },
          { status: 503 }
        )
      }
      console.error('[api/global/places/[id]] place error:', placeRes.error)
      return NextResponse.json({ error: 'server_error' }, { status: 500 })
    }

    // 부속 데이터 에러는 페이지 전체를 막지 않되, 숨기지 않고 플래그로 전달 (§9)
    if (reviewsRes.error) console.error('[api/global/places/[id]] reviews error:', reviewsRes.error)
    if (logsRes.error) console.error('[api/global/places/[id]] bottle_logs error:', logsRes.error)
    if (obsRes.error) console.error('[api/global/places/[id]] observations error:', obsRes.error)
    if (photosRes.error) console.error('[api/global/places/[id]] photos error:', photosRes.error)

    return NextResponse.json({
      place: placeRes.data,
      reviews: reviewsRes.data ?? [],
      reviewsFailed: !!reviewsRes.error,
      bottleLogs: logsRes.data ?? [],
      bottleLogsFailed: !!logsRes.error,
      observations,
      observationsFailed: !!obsRes.error,
      photos: photosRes.data ?? [],
      photosFailed: !!photosRes.error,
    })
  } catch (e) {
    console.error('[api/global/places/[id]] error:', e)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}

/**
 * PATCH /api/global/places/[id]  (관리자 전용)
 * body: { official_url?: string|null, attributes?: Record<string, unknown> }
 *  - official_url 은 컬럼 갱신.
 *  - attributes 는 기존 값에 "병합"(보낸 키만 덮어씀). 흡연·커버차지는 후기 집계라 폼에서 제외.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  // ── 관리자 인증 (서버 재검증) ──────────────────────────────────────────
  const ssr = await makeGlobalSSRClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!isAdminEmail(user.email)) {
    return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
  }

  let admin
  try {
    admin = createAdminGlobalClient()
  } catch {
    return NextResponse.json(
      { error: '서버에 SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' },
      { status: 503 }
    )
  }

  // 기존 attributes 읽어 병합 (보낸 키만 덮어씀)
  const { data: cur, error: readErr } = await admin
    .from('places')
    .select('attributes')
    .eq('id', id)
    .single()
  if (readErr || !cur) {
    return NextResponse.json({ error: '장소를 찾을 수 없습니다.' }, { status: 404 })
  }

  const patch: Record<string, unknown> = {}
  if (body.attributes && typeof body.attributes === 'object') {
    patch.attributes = { ...(cur.attributes as Record<string, unknown>), ...body.attributes }
  }
  if (body.official_url !== undefined) {
    patch.official_url = body.official_url ? String(body.official_url).trim() : null
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: '변경할 내용이 없습니다.' }, { status: 400 })
  }

  const { error } = await admin.from('places').update(patch).eq('id', id)
  if (error) {
    console.error('[places PATCH]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
