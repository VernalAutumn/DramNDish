// Google Maps Embed API — 해외(Global) 지도 표시용 헬퍼 (클라이언트).
//
// Embed API는 무료·무제한(과금 없음)이라 로드맵의 "해외 0원" 기조에 맞다.
// 단점: place 모드는 한 번에 1곳만 핀으로 표시 → 선택한 장소를 보여주는 데 쓴다.
//
// 키는 iframe URL(src)에 들어가 브라우저에 노출되므로, 반드시:
//   - "Maps Embed API" 전용으로 제한된 별도 키를 쓰고
//   - HTTP 리퍼러(도메인+localhost)로 제한할 것.
//   → Places용 서버 키(GOOGLE_PLACES_API_KEY)와 절대 같은 키를 쓰지 말 것.
export const EMBED_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY

// 국가 개요용 중심 좌표·줌 (장소 선택 전 배경 지도).
const COUNTRY_VIEW: Record<string, { lat: number; lng: number; zoom: number }> = {
  JP: { lat: 36.2, lng: 138.2, zoom: 5 },
  TW: { lat: 23.7, lng: 121.0, zoom: 7 },
  UK: { lat: 54.5, lng: -2.5, zoom: 5 },
  US: { lat: 39.5, lng: -98.35, zoom: 4 },
}

/**
 * 장소 1곳을 핀으로 보여주는 지도 URL (place 모드).
 *
 * 좌표(q=lat,lng) 대신 **이름으로 검색**한다 — 상세의 '지도보기' 아웃링크와 동일한 방식.
 * 일부 장소는 좌표가 동네 단위로 거칠게 저장돼 있어(예: 수기/시드 등록) 좌표로 찍으면
 * 엉뚱한 곳이 나온다. 이름+지역+주소로 검색하면 구글이 정확한 업장을 집어준다.
 * 키 없으면 null.
 */
export function placeEmbedSrc(p: {
  name: string
  name_local: string | null
  region: string | null
  address: string | null
}): string | null {
  if (!EMBED_KEY) return null
  // 구글에서 가장 잘 찾히는 토큰 순서: 원문(영어/현지어) 이름 → 지역 → 주소.
  const query = [p.name_local || p.name, p.region, p.address].filter(Boolean).join(' ').trim()
  if (!query) return null
  return `https://www.google.com/maps/embed/v1/place?key=${EMBED_KEY}&q=${encodeURIComponent(query)}`
}

/** 국가 개요 지도 URL (view 모드, 핀 없음 — 선택 전 배경). 키 없으면 null. */
export function embedCountrySrc(country: string): string | null {
  if (!EMBED_KEY) return null
  const v = COUNTRY_VIEW[country] ?? COUNTRY_VIEW.JP
  return `https://www.google.com/maps/embed/v1/view?key=${EMBED_KEY}&center=${v.lat},${v.lng}&zoom=${v.zoom}`
}
