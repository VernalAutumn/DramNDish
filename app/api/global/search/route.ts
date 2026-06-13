import { NextRequest, NextResponse } from 'next/server'
import { autocompletePlaces } from '@/src/lib/adapters/google-places'

/**
 * GET /api/global/search?query=liquor mountain&country=JP&token=<세션토큰>
 * 해외 장소 자동완성 — /global/add 검색창에서 타이핑할 때마다 호출.
 * Google Places(New) Autocomplete를 서버에서 호출하고 제안 목록을 내려준다.
 *
 * country 로 해당 국가만 제한 → 한국 결과는 자동 제외(밴).
 * 키(GOOGLE_PLACES_API_KEY)는 서버에서만 쓰여 브라우저에 노출되지 않는다.
 */
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('query')?.trim()
  const country = req.nextUrl.searchParams.get('country')?.trim() || undefined
  const token = req.nextUrl.searchParams.get('token')?.trim() || undefined

  if (!query) {
    return NextResponse.json({ suggestions: [] })
  }

  try {
    const suggestions = await autocompletePlaces(query, country, token)
    return NextResponse.json({ suggestions })
  } catch (e) {
    console.error('[api/global/search]', e)
    return NextResponse.json({ error: '검색에 실패했습니다.' }, { status: 502 })
  }
}
