'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import SearchFilter, { FilterState, INITIAL_FILTER } from '@/src/components/SearchFilter'
import { createClient } from '@/src/lib/supabase-browser'

// ── 타입 ──────────────────────────────────────────────────────────────────
interface PlaceTag {
  id:    string
  type:  string
  label: string
  count?: number
}

interface Place {
  id:             string
  name:           string
  address:        string
  lat:            number
  lng:            number
  type:           string
  district:       string | null
  naver_place_id: string | null
  favorites_count: number | null
  corkage_type:   'impossible' | 'free' | 'paid' | null
  corkage_fee:    number | null
  cover_charge:   number | null
  tags?:          PlaceTag[]
}

// ── 상수 ──────────────────────────────────────────────────────────────────
const MARKER_COLOR = '#BF3A21'

const TYPE_LABEL: Record<string, string> = {
  whisky:     '리쿼샵',
  bar:        '바',
  restaurant: '식당',
}

const TYPE_COLOR: Record<string, string> = {
  whisky:     '#BF3A21',
  bar:        '#8B4513',
  restaurant: '#F97316',
}

function formatDist(km: number) {
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── 컴포넌트 ──────────────────────────────────────────────────────────────
export default function ListPage() {
  const router   = useRouter()
  const supabase = createClient()

  // 데이터
  const [places,   setPlaces]   = useState<Place[]>([])
  const [loading,  setLoading]  = useState(true)
  const [favIds,   setFavIds]   = useState<Set<string>>(new Set())
  const [loggedIn, setLoggedIn] = useState(false)

  // 필터
  const [filterState,       setFilterState]       = useState<FilterState>(INITIAL_FILTER)
  const [selectedTagFilters, setSelectedTagFilters] = useState<string[]>([])
  const [showFilter,        setShowFilter]        = useState(false)

  // 탭: 목록 / 즐겨찾기
  const [mainTab, setMainTab] = useState<'list' | 'favorites'>('list')

  // 위치
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)

  // ─── 데이터 로드 ──────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/places')
      .then((r) => r.json())
      .then((data: Place[]) => { setPlaces(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setLoggedIn(true)
        fetch('/api/favorites')
          .then((r) => r.json())
          .then((ids: string[]) => setFavIds(new Set(ids)))
          .catch(() => {})
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 위치 요청 ────────────────────────────────────────────────────────
  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
    )
  }, [])

  // ─── 태그 목록 (선택 타입 기준) ───────────────────────────────────────
  const uniqueGeneralTags = useMemo(() => {
    const source = filterState.type === 'all'
      ? places
      : places.filter((p) => p.type === filterState.type)
    const countMap = new Map<string, number>()
    source.forEach((p) => {
      ;(p.tags ?? []).filter((t) => t.type === 'general').forEach((t) => {
        countMap.set(t.label, (countMap.get(t.label) ?? 0) + 1)
      })
    })
    return Array.from(countMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label]) => label)
  }, [places, filterState.type])

  // 타입 변경 시 태그 필터 초기화
  useEffect(() => { setSelectedTagFilters([]) }, [filterState.type])

  // ─── 필터링 ───────────────────────────────────────────────────────────
  const filteredPlaces = useMemo(() => {
    const { query, type, corkage, categories } = filterState
    let result = places
    if (type !== 'all') result = result.filter((p) => p.type === type)
    if (query.trim()) result = result.filter((p) =>
      p.name.toLowerCase().includes(query.trim().toLowerCase()) ||
      p.address.toLowerCase().includes(query.trim().toLowerCase()),
    )
    if (corkage) result = result.filter((p) =>
      p.corkage_type === 'free' || p.corkage_type === 'paid',
    )
    if (categories.length > 0) result = result.filter((p) =>
      categories.some((cat) => (p.tags ?? []).some((t) => t.type === 'category' && t.label === cat)),
    )
    if (selectedTagFilters.length > 0) result = result.filter((p) =>
      selectedTagFilters.some((tag) => (p.tags ?? []).some((t) => t.type === 'general' && t.label === tag)),
    )
    return result
  }, [places, filterState, selectedTagFilters])

  const displayPlaces = useMemo(() => {
    const list = mainTab === 'favorites'
      ? filteredPlaces.filter((p) => favIds.has(p.id))
      : filteredPlaces
    if (!userLocation) return list
    return [...list].sort((a, b) =>
      haversine(userLocation.lat, userLocation.lng, a.lat, a.lng) -
      haversine(userLocation.lat, userLocation.lng, b.lat, b.lng),
    )
  }, [filteredPlaces, mainTab, favIds, userLocation])

  const isFilterActive =
    filterState.type !== 'all' || filterState.corkage ||
    filterState.categories.length > 0 || !!filterState.query ||
    selectedTagFilters.length > 0

  // ─── 장소 클릭 → 상세 페이지로 이동 ──────────────────────────────────
  const openOnMap = (id: string) => {
    router.push(`/place/${id}`)
  }

  // ─── 렌더 ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-white">
      {/* 헤더 */}
      <div className="flex-shrink-0 px-4 pt-4 pb-2 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-base font-bold text-gray-900">장소 목록</h1>
          <button
            onClick={() => setShowFilter((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all"
            style={
              isFilterActive
                ? { backgroundColor: MARKER_COLOR, color: '#fff', borderColor: MARKER_COLOR }
                : { backgroundColor: '#f9fafb', color: '#374151', borderColor: '#e5e7eb' }
            }
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.5">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
            </svg>
            필터
            {isFilterActive && (
              <span className="w-1.5 h-1.5 rounded-full bg-white/70 shrink-0" />
            )}
          </button>
        </div>

        {/* 검색창 */}
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 focus-within:border-gray-400 transition-colors mb-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="#9ca3af" strokeWidth="2.5" className="shrink-0">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            value={filterState.query}
            onChange={(e) => setFilterState((prev) => ({ ...prev, query: e.target.value }))}
            placeholder="장소명 검색"
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-gray-300 text-gray-800"
          />
          {filterState.query && (
            <button
              onClick={() => setFilterState((prev) => ({ ...prev, query: '' }))}
              className="shrink-0 text-gray-400 hover:text-gray-600"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>

        {/* 필터 패널 (토글) */}
        {showFilter && (
          <div className="border border-gray-100 rounded-xl overflow-hidden bg-gray-50 mb-2">
            <SearchFilter
              onChange={setFilterState}
              tags={uniqueGeneralTags}
              selectedTags={selectedTagFilters}
              onTagChange={setSelectedTagFilters}
              hideSearch
            />
          </div>
        )}

        {/* 목록 / 즐겨찾기 탭 */}
        <div className="flex border-b border-gray-100 -mb-2">
          {([
            { key: 'list',      label: '목록' },
            { key: 'favorites', label: '즐겨찾기' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => {
                if (key === 'favorites' && !loggedIn) return // 비로그인 시 비활성
                setMainTab(key)
              }}
              className={`flex-1 py-2.5 text-xs font-semibold transition-colors border-b-2 -mb-px ${
                mainTab === key
                  ? 'border-[#BF3A21] text-[#BF3A21]'
                  : key === 'favorites' && !loggedIn
                  ? 'border-transparent text-gray-300 cursor-not-allowed'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {label}
              {key === 'favorites' && !loggedIn && (
                <span className="ml-1 text-[10px]">(로그인 필요)</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 장소 목록 */}
      <div className="flex-1 overflow-y-auto">
        {/* 카운트 + 거리 정렬 */}
        <div className="px-4 pt-2 pb-1 flex items-center justify-between">
          <p className="text-xs text-gray-400">
            {loading ? '불러오는 중...' : `${displayPlaces.length}개 장소`}
          </p>
          <button
            onClick={requestLocation}
            className={`text-[10px] font-semibold flex items-center gap-0.5 ${
              userLocation ? 'text-emerald-500' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
            </svg>
            {userLocation ? '내 위치 기준 정렬됨' : '거리순 정렬'}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
            불러오는 중...
          </div>
        ) : displayPlaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-gray-400">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <p className="text-sm">조건에 맞는 장소가 없어요.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {displayPlaces.map((place) => {
              const dist        = userLocation
                ? haversine(userLocation.lat, userLocation.lng, place.lat, place.lng)
                : null
              const accentColor = TYPE_COLOR[place.type] ?? MARKER_COLOR
              const isFav       = favIds.has(place.id)

              // 정책 뱃지
              const badges: { label: string; color: string; bg: string }[] = []
              if (place.type === 'restaurant') {
                if (place.corkage_type === 'free')
                  badges.push({ label: '콜키지 프리', color: '#c2410c', bg: '#fff7ed' })
                else if (place.corkage_type === 'paid')
                  badges.push({ label: '콜키지 유료', color: '#b45309', bg: '#fffbeb' })
              }
              if (place.type === 'bar' && place.cover_charge != null && place.cover_charge > 0)
                badges.push({ label: '커버차지', color: MARKER_COLOR, bg: `${MARKER_COLOR}15` })

              return (
                <li key={place.id}>
                  <button
                    onClick={() => openOnMap(place.id)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-semibold text-gray-900 truncate">
                            {place.name}
                          </span>
                          <span
                            className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                            style={{ color: accentColor, backgroundColor: `${accentColor}18` }}
                          >
                            {TYPE_LABEL[place.type] ?? place.type}
                          </span>
                          {badges.map((b) => (
                            <span
                              key={b.label}
                              className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 shrink-0"
                              style={{ color: b.color, backgroundColor: b.bg }}
                            >
                              {b.label}
                            </span>
                          ))}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {dist !== null && (
                            <span className="text-[10px] font-medium text-emerald-500 shrink-0">
                              {formatDist(dist)}
                            </span>
                          )}
                          <span className="text-xs text-gray-400 truncate">{place.address}</span>
                        </div>
                      </div>
                      {isFav && (
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"
                          viewBox="0 0 24 24" fill={MARKER_COLOR} stroke={MARKER_COLOR}
                          strokeWidth="1.5" className="shrink-0 mt-0.5">
                          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                        </svg>
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {/* BottomNav 높이만큼 여백 */}
        <div className="h-20" />
      </div>
    </div>
  )
}
