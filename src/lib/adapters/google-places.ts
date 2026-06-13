import type { IPlaceStandard, PlaceSuggestion } from './types'

// Google Places API (New) 어댑터 — 해외 장소 검색.
// 문서: https://developers.google.com/maps/documentation/places/web-service
//
// 두 단계로 나뉜다 (세션 토큰으로 묶어 비용 1회분으로 과금):
//   1) Autocomplete: 타이핑하면 제안 목록을 받는다.        places:autocomplete
//   2) Place Details: 고른 1건의 좌표·주소·지도링크를 받는다. places/{id}
//
// 한국 밴: Autocomplete의 includedRegionCodes 로 "선택한 국가만" 하드 제한.
//   국내(한국)는 네이버로 운영하므로 해외 검색에 한국이 섞이지 않게 한다.
//   국가가 고정되므로 languageCode:'ko'(한국어 주소)를 써도 한국으로 새지 않는다.
// 필드 마스크: Place Details에서 꼭 필요한 필드만 요청해 과금을 최소화한다.

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete'
const DETAILS_BASE_URL = 'https://places.googleapis.com/v1/places/'

// 우리 국가 코드(JP/TW/UK/US) → Google regionCode(소문자 ISO 3166-1). 영국만 UK→gb.
const REGION_CODE: Record<string, string> = { JP: 'jp', TW: 'tw', UK: 'gb', US: 'us' }

// 국가 → 현지 언어 코드. 상세 조회 시 "현지어 원문" 이름·주소를 받기 위함.
// 예: JP → ja → "リカーマウンテン 銀座777". 매칭 없으면 undefined(=구글 기본).
const LOCAL_LANG: Record<string, string> = { JP: 'ja', TW: 'zh-TW', UK: 'en-GB', US: 'en' }

/** 국가 코드에 맞는 현지 언어 코드 (없으면 undefined) */
export function localeForCountry(country?: string): string | undefined {
  return country ? LOCAL_LANG[country] : undefined
}

const DETAILS_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'googleMapsUri',
  'primaryType',
].join(',')

// ── Autocomplete 응답에서 쓰는 부분만 추린 타입 ──
interface AcResponse {
  suggestions?: {
    placePrediction?: {
      placeId?: string
      structuredFormat?: {
        mainText?: { text?: string }
        secondaryText?: { text?: string }
      }
      text?: { text?: string }
    }
  }[]
}

interface DetailsResponse {
  id?: string
  displayName?: { text?: string }
  formattedAddress?: string
  location?: { latitude?: number; longitude?: number }
  googleMapsUri?: string
  primaryType?: string
}

/**
 * 타이핑한 입력으로 제안 목록을 받는다. 서버에서만 호출 (API 키 필요).
 *
 * @param input        사용자 입력 (영어/현지어 권장, 한국어도 일부 가능)
 * @param country      우리 국가 코드(JP/TW/UK/US). 이 국가로 하드 제한 → 한국 자동 밴.
 * @param sessionToken 자동완성↔상세를 한 세션으로 묶는 토큰 (비용 절감)
 */
export async function autocompletePlaces(
  input: string,
  country?: string,
  sessionToken?: string
): Promise<PlaceSuggestion[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY 환경변수가 없습니다.')

  const body: Record<string, unknown> = { input, languageCode: 'ko' }
  const regionCode = country ? REGION_CODE[country] : undefined
  if (regionCode) body.includedRegionCodes = [regionCode]
  if (sessionToken) body.sessionToken = sessionToken

  const res = await fetch(AUTOCOMPLETE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Autocomplete ${res.status}: ${text}`)
  }

  const data = (await res.json()) as AcResponse
  return (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
    .map((p) => ({
      providerId: p.placeId!,
      mainText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
      secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
    }))
}

/**
 * 고른 장소 1건의 상세(좌표·주소·지도링크)를 표준 형식으로 받는다. 서버 전용.
 *
 * @param placeId      Autocomplete가 준 providerId
 * @param sessionToken autocompletePlaces에 쓴 것과 같은 토큰 (세션 마감 → 과금 1회분)
 * @param languageCode 이름·주소를 받을 언어. "현지어 원문"을 원하면 현지 언어(ja 등).
 *                     미지정 시 구글 기본(보통 영어/로마자).
 */
export async function getGooglePlaceDetails(
  placeId: string,
  sessionToken?: string,
  languageCode?: string
): Promise<IPlaceStandard> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY 환경변수가 없습니다.')

  const url = new URL(DETAILS_BASE_URL + encodeURIComponent(placeId))
  if (languageCode) url.searchParams.set('languageCode', languageCode)
  if (sessionToken) url.searchParams.set('sessionToken', sessionToken)

  const res = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': DETAILS_FIELD_MASK,
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Place Details ${res.status}: ${text}`)
  }

  const p = (await res.json()) as DetailsResponse
  return {
    source: 'google',
    providerId: p.id ?? placeId,
    name: p.displayName?.text ?? '',
    address: p.formattedAddress ?? null,
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    googleMapsUrl: p.googleMapsUri ?? null,
    primaryType: p.primaryType ?? null,
  }
}
