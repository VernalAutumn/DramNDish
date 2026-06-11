// dramndish Global(해외) — 공용 타입·표기 헬퍼
// 데이터 모델: dramndish-global-spec.md §5·§6 / DB: supabase/DRAMNDISH_README.md

export interface GlobalPlace {
  id: string
  name: string
  name_local: string | null
  type: string // 'liquor_shop' | 'bar' | 'restaurant' | 'distillery'
  subkind: string | null // distillery 전용: 'distillery' | 'ib_shop'
  country: string
  region: string | null
  address: string | null
  lat: number | null
  lng: number | null
  source: string // 'seed' | 'community'
  google_maps_url: string | null
  official_url: string | null
  attributes: Record<string, unknown>
  created_at: string
  contributor: { nickname: string | null } | null
}

export interface GlobalReview {
  id: string
  rating: 'revisit' | 'fine' | 'meh' | null
  comment: string | null
  visited_at: string
  photo_urls: string[]
  created_at: string
  user: { nickname: string | null } | null
}

export interface GlobalBottleLog {
  id: string
  free_label: string | null
  context: string
  price: number | null
  currency: string | null
  fx_to_krw: number | null
  photo_url: string | null
  logged_at: string
  product: { display_name: string } | null
  user: { nickname: string | null } | null
}

export interface GlobalObservation {
  id: string
  obs_type: string
  value_bucket: string | null
  value_text: string | null
  note: string | null
  observed_at: string
  verification_status: 'single' | 'confirmed'
}

export const GLOBAL_TYPE_LABEL: Record<string, string> = {
  liquor_shop: '리쿼샵',
  bar: '바',
  restaurant: '음식점',
  distillery: '증류소',
}

export const COUNTRY_LABEL: Record<string, string> = {
  JP: '일본',
  TW: '대만',
  UK: '영국',
  US: '미국',
}

export const BOTTLE_CONTEXT_LABEL: Record<string, string> = {
  shop_purchase: '매장 구매',
  distillery_direct: '증류소 구매',
  distillery_tasting: '증류소 시음',
  bar_favorite: '가장 좋았던 한 잔',
}

export const OBS_TYPE_LABEL: Record<string, string> = {
  cask_level: '핸드필 캐스크 잔량',
  bottle_level: '보틀 잔량',
  price: '가격',
  stock: '재고',
  tour_info: '투어 정보',
}

export const VALUE_BUCKET_LABEL: Record<string, string> = {
  plenty: '넉넉함',
  half: '절반 정도',
  low: '얼마 안 남음',
  unknown: '모름',
}

export function countryLabel(code: string): string {
  return COUNTRY_LABEL[code] ?? code
}

export function daysSince(dateStr: string): number {
  const d = new Date(dateStr)
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000))
}

// §8.4 경과일 색상: 0–5 / 6–14 / 15+
export function freshnessColor(days: number): string {
  if (days <= 5) return '#10b981'
  if (days <= 14) return '#f59e0b'
  return '#ef4444'
}
