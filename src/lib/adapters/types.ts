// 해외 장소 검색 — 공급자 중립 표준 형식 (IPlaceStandard)
//
// 왜 필요한가:
//   지금은 Google Places로 검색하지만, 나중에 다른 검색 공급자(Foursquare 등)를
//   붙일 수도 있다. 화면·DB가 "Google 응답 모양"에 직접 의존하면, 공급자를 바꿀 때
//   전부 고쳐야 한다. 그래서 모든 공급자는 이 IPlaceStandard "한 가지 모양"으로
//   변환(adapt)해서 넘긴다. 화면은 이 모양만 알면 된다.
//
// 이 표준은 그대로 /global/add 폼과 global.places 컬럼에 매핑된다.

export interface IPlaceStandard {
  /** 검색 공급자 식별 — 현재는 'google'만 */
  source: 'google'
  /** 공급자의 고유 장소 ID (Google place id, 예: "ChIJ...") — 중복 판정·딥링크에 사용 */
  providerId: string
  /** 표시 이름 (요청 언어 기준) → 폼의 name */
  name: string
  /** 전체 주소 → 폼의 address */
  address: string | null
  /** 주소에서 추출한 도시(locality 등) → 폼의 region 프리필. 없으면 null. 사용자가 수정 가능 */
  city: string | null
  /** 위도 → places.lat */
  lat: number | null
  /** 경도 → places.lng */
  lng: number | null
  /** 구글 지도 딥링크 → places.google_maps_url (지도 렌더링 없이 앱으로 아웃링크) */
  googleMapsUrl: string | null
  /** 구글이 분류한 대표 유형 (예: 'liquor_store', 'bar') — 유형 자동 추천에 활용 */
  primaryType: string | null
  /** 공식 사이트(websiteUri) → 폼의 official_url 자동채움 (없으면 null) */
  officialUrl: string | null
}

// 자동완성(Autocomplete) 1건 — 드롭다운에 보여줄 최소 정보.
// 아직 좌표·상세는 없다. 사용자가 고르면 placeId로 상세를 따로 조회한다.
export interface PlaceSuggestion {
  /** 공급자 장소 ID — 선택 시 상세 조회 키 */
  providerId: string
  /** 굵게 보일 이름 (예: "Liquor Mountain Ginza 777") */
  mainText: string
  /** 회색으로 보일 주소 (예: "7 Chome-7-7 Ginza, Chuo City, Tokyo, Japan") */
  secondaryText: string
}
