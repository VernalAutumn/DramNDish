import { NextRequest, NextResponse } from 'next/server'
import { getGooglePlaceDetails, getGooglePlaceCityEn, localeForCountry } from '@/src/lib/adapters/google-places'
import { toKoreanCity } from '@/src/lib/city-ko'

/**
 * GET /api/global/place?placeId=ChIJ...&country=JP&token=<세션토큰>
 * 자동완성에서 고른 장소 1건의 상세(좌표·주소·지도링크)를 표준 형식으로 내려준다.
 * /global/add 에서 제안을 선택하면 폼을 자동 채우기 위해 호출.
 *
 * country 로 현지 언어를 정해 "현지어 원문" 이름·주소를 받는다 (JP→ja 등).
 * token 은 autocomplete 때 쓴 것과 같아야 한다 — 세션을 마감해 과금이 1회분이 된다.
 */
export async function GET(req: NextRequest) {
  const placeId = req.nextUrl.searchParams.get('placeId')?.trim()
  const country = req.nextUrl.searchParams.get('country')?.trim() || undefined
  const token = req.nextUrl.searchParams.get('token')?.trim() || undefined

  if (!placeId) {
    return NextResponse.json({ error: 'placeId 파라미터가 필요합니다.' }, { status: 400 })
  }

  try {
    // 현지어 상세(이름 원문 등) + 영어 도시를 병렬 조회. 영어 도시가 있으면 region 프리필용으로 덮어쓴다.
    const [place, cityEn] = await Promise.all([
      getGooglePlaceDetails(placeId, token, localeForCountry(country)),
      getGooglePlaceCityEn(placeId),
    ])
    // 영어 도시를 사전에 있는 경우 한국어로 통일(런던·아일라 등). 없으면 영어 유지.
    if (cityEn) place.city = toKoreanCity(cityEn)
    return NextResponse.json({ place })
  } catch (e) {
    console.error('[api/global/place]', e)
    return NextResponse.json({ error: '장소 정보를 불러오지 못했습니다.' }, { status: 502 })
  }
}
