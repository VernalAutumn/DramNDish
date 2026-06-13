import { NextRequest, NextResponse } from 'next/server'
import { createDramndishClient } from '@/src/lib/supabase'

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

    const [placeRes, reviewsRes, logsRes, obsRes] = await Promise.all([
      supabase
        .from('places')
        .select('*, contributor:users!places_contributed_by_fkey(nickname)')
        .eq('id', id)
        .single(),
      supabase
        .from('reviews')
        .select(
          'id, user_id, rating, comment, visited_at, photo_urls, companion_type, party_size, bar_smoking, bar_cover_charge, created_at, user:users!reviews_user_id_fkey(nickname), votes:review_votes(vote, user_id)'
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

    return NextResponse.json({
      place: placeRes.data,
      reviews: reviewsRes.data ?? [],
      reviewsFailed: !!reviewsRes.error,
      bottleLogs: logsRes.data ?? [],
      bottleLogsFailed: !!logsRes.error,
      observations,
      observationsFailed: !!obsRes.error,
    })
  } catch (e) {
    console.error('[api/global/places/[id]] error:', e)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
