'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import Script from 'next/script'

declare global {
  interface Window {
    naver: any
    __openPlaceDetail: (id: string) => void
  }
}

interface Place {
  id: string
  name: string
  address: string
  lat: number
  lng: number
  type: string
  district: string | null
  naver_place_id: string | null
  favorites_count: number | null
}

interface Tag {
  id: string
  label: string
  count: number
  type: 'payment' | 'general'
}

const MARKER_COLOR          = '#BF3A21'
const CLUSTER_THRESHOLD     = 14
const CLUSTER_GRID_SIZE     = 60
const DEFAULT_PAYMENT_TAGS  = ['카드', '현금', '온누리']

const TYPE_LABEL: Record<string, string> = {
  whisky:     '리쿼샵',
  bar:        '바',
  restaurant: '맛집',
}

function markerIcon() {
  return `
    <div style="cursor:pointer">
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
        <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 22 14 22S28 24.5 28 14C28 6.268 21.732 0 14 0z" fill="${MARKER_COLOR}"/>
        <circle cx="14" cy="14" r="6" fill="white"/>
      </svg>
    </div>
  `
}

function clusterIconContent(count: number) {
  const size     = count >= 11 ? 48 : count >= 6 ? 42 : 36
  const fontSize = count >= 11 ? 16 : 13
  return {
    html: `
      <div style="
        width:${size}px;height:${size}px;
        background:${MARKER_COLOR};border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        color:#fff;font-weight:700;font-size:${fontSize}px;
        cursor:pointer;
        box-shadow:0 2px 8px rgba(0,0,0,0.35);
        border:2px solid rgba(255,255,255,0.6);
      ">${count}</div>
    `,
    size,
  }
}

export default function NaverMap() {
  // ─── refs ────────────────────────────────────────────────────────────────
  const mapRef               = useRef<HTMLDivElement>(null)
  const naverMapRef          = useRef<any>(null)
  const placesRef            = useRef<Place[]>([])
  const markersRef           = useRef<Record<string, any>>({})
  const infoWindowsRef       = useRef<Record<string, any>>({})
  const clusterMarkersRef    = useRef<any[]>([])
  const currentInfoWindowRef = useRef<any>(null)
  const openDetailRef        = useRef<(id: string) => void>(() => {})
  const tagInputRef          = useRef<HTMLInputElement>(null)

  // ─── state: places ───────────────────────────────────────────────────────
  const [places,  setPlaces]  = useState<Place[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  // ─── state: panel ────────────────────────────────────────────────────────
  const [panelOpen, setPanelOpen] = useState(true)
  const [view, setView]           = useState<'list' | 'detail'>('list')

  // ─── state: detail ───────────────────────────────────────────────────────
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null)
  const [selectedTags,  setSelectedTags]  = useState<Tag[]>([])
  const [loadingTags,   setLoadingTags]   = useState(false)
  const [isFavorited,   setIsFavorited]   = useState(false)
  const [favCount,      setFavCount]      = useState(0)
  const [isFaving,      setIsFaving]      = useState(false)
  const [showTagInput,  setShowTagInput]  = useState(false)
  const [newTagLabel,   setNewTagLabel]   = useState('')
  const [isAddingTag,   setIsAddingTag]   = useState(false)
  const [detailTab,     setDetailTab]     = useState<'payment' | 'general'>('payment')

  // ─── 장소 불러오기 ───────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/places')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: Place[]) => {
        setPlaces(data)
        placesRef.current = data
        setLoading(false)
        if (naverMapRef.current) setupMarkers(naverMapRef.current, data)
      })
      .catch((err) => {
        setError(`장소 목록을 불러오지 못했습니다: ${err.message}`)
        setLoading(false)
      })
  }, [])

  // ─── 태그 입력 포커스 ────────────────────────────────────────────────────
  useEffect(() => {
    if (showTagInput) tagInputRef.current?.focus()
  }, [showTagInput])

  // ─── 패널 토글 시 지도 리사이즈 ─────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => naverMapRef.current?.autoResize?.(), 310)
    return () => clearTimeout(t)
  }, [panelOpen])

  // ─── window 전역 함수 (인포윈도우 onclick용) ─────────────────────────────
  useEffect(() => {
    window.__openPlaceDetail = (id: string) => openDetailRef.current(id)
    return () => { delete (window as any).__openPlaceDetail }
  }, [])

  // ─── 상세 뷰 열기 ────────────────────────────────────────────────────────
  const openDetail = useCallback(async (id: string) => {
    const place = placesRef.current.find((p) => p.id === id)
    if (!place) return

    setSelectedPlace(place)
    setView('detail')
    setPanelOpen(true)
    setActiveId(id)
    setFavCount(place.favorites_count ?? 0)
    setIsFavorited(localStorage.getItem(`favorited_${place.id}`) === 'true')
    setSelectedTags([])
    setShowTagInput(false)
    setNewTagLabel('')
    setDetailTab('payment')
    setLoadingTags(true)

    try {
      const res  = await fetch(`/api/places/${place.id}/tags`)
      const data = await res.json()
      setSelectedTags(Array.isArray(data) ? data : [])
    } finally {
      setLoadingTags(false)
    }
  }, [])

  useEffect(() => { openDetailRef.current = openDetail }, [openDetail])

  // ─── 즐겨찾기 토글 ──────────────────────────────────────────────────────
  const handleFavorite = async () => {
    if (isFaving || !selectedPlace) return
    setIsFaving(true)
    const newFaved = !isFavorited
    setIsFavorited(newFaved)
    setFavCount((c) => newFaved ? c + 1 : Math.max(0, c - 1))
    localStorage.setItem(`favorited_${selectedPlace.id}`, String(newFaved))
    try {
      await fetch(`/api/places/${selectedPlace.id}/favorite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: newFaved ? 'add' : 'remove' }),
      })
    } catch {
      setIsFavorited(!newFaved)
      setFavCount((c) => newFaved ? Math.max(0, c - 1) : c + 1)
      localStorage.setItem(`favorited_${selectedPlace.id}`, String(!newFaved))
    } finally {
      setIsFaving(false)
    }
  }

  // ─── 태그 투표 ──────────────────────────────────────────────────────────
  const handleTagVote = async (label: string, type: 'payment' | 'general') => {
    if (!selectedPlace) return
    const existing = selectedTags.find((t) => t.label === label)

    if (existing) {
      setSelectedTags((prev) =>
        prev.map((t) => t.id === existing.id ? { ...t, count: t.count + 1 } : t)
      )
    }

    try {
      const res  = await fetch(`/api/places/${selectedPlace.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, type }),
      })
      const data = await res.json()
      if (res.ok) {
        setSelectedTags((prev) => {
          const inState = prev.find((t) => t.label === label)
          if (inState) return prev.map((t) => t.label === label ? data : t)
          return [...prev, data]
        })
      } else if (existing) {
        setSelectedTags((prev) =>
          prev.map((t) => t.id === existing.id ? { ...t, count: t.count - 1 } : t)
        )
      }
    } catch {
      if (existing) {
        setSelectedTags((prev) =>
          prev.map((t) => t.id === existing.id ? { ...t, count: t.count - 1 } : t)
        )
      }
    }
  }

  // ─── 태그 신규 추가 ──────────────────────────────────────────────────────
  const handleAddTag = async () => {
    const label = newTagLabel.trim()
    if (!label || isAddingTag || !selectedPlace) return
    setIsAddingTag(true)
    try {
      const res  = await fetch(`/api/places/${selectedPlace.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, type: detailTab }),
      })
      const data = await res.json()
      if (res.ok) {
        setSelectedTags((prev) => {
          const exists = prev.find((t) => t.label === label)
          if (exists) return prev.map((t) => t.label === label ? data : t)
          return [...prev, data]
        })
        setNewTagLabel('')
        setShowTagInput(false)
      }
    } finally {
      setIsAddingTag(false)
    }
  }

  // ─── 결제수단 태그 목록 (DB + 기본 제안) ────────────────────────────────
  const paymentTagsDisplay = useMemo(() => {
    const dbPayment = selectedTags.filter((t) => t.type === 'payment')
    const dbLabels  = new Set(dbPayment.map((t) => t.label))
    const suggestions = DEFAULT_PAYMENT_TAGS
      .filter((label) => !dbLabels.has(label))
      .map((label) => ({ id: `__pay__${label}`, label, count: 0, type: 'payment' as const }))
    return [...dbPayment.slice().sort((a, b) => b.count - a.count), ...suggestions]
  }, [selectedTags])

  // ─── 일반 태그 목록 ──────────────────────────────────────────────────────
  const generalTagsDisplay = useMemo(() => {
    return selectedTags
      .filter((t) => t.type === 'general')
      .slice()
      .sort((a, b) => b.count - a.count)
  }, [selectedTags])

  // ─── 클러스터 마커 제거 ──────────────────────────────────────────────────
  const clearClusterMarkers = () => {
    clusterMarkersRef.current.forEach((m) => m.setMap(null))
    clusterMarkersRef.current = []
  }

  // ─── 그리드 기반 클러스터 계산 ──────────────────────────────────────────
  const computeClusters = (map: any, data: Place[]) => {
    const proj   = map.getProjection()
    const points = data.map((p) => {
      const offset = proj.fromCoordToOffset(new window.naver.maps.LatLng(p.lat, p.lng))
      return { place: p, x: offset.x, y: offset.y }
    })

    const assigned = new Set<string>()
    const clusters: { places: Place[]; lat: number; lng: number }[] = []

    for (const pt of points) {
      if (assigned.has(pt.place.id)) continue
      const group: Place[] = [pt.place]
      assigned.add(pt.place.id)

      for (const other of points) {
        if (assigned.has(other.place.id)) continue
        const dx = pt.x - other.x
        const dy = pt.y - other.y
        if (Math.sqrt(dx * dx + dy * dy) <= CLUSTER_GRID_SIZE) {
          group.push(other.place)
          assigned.add(other.place.id)
        }
      }

      clusters.push({
        places: group,
        lat: group.reduce((s, p) => s + p.lat, 0) / group.length,
        lng: group.reduce((s, p) => s + p.lng, 0) / group.length,
      })
    }
    return clusters
  }

  // ─── 줌 레벨에 따라 마커 / 클러스터 전환 ────────────────────────────────
  const updateDisplay = (map: any) => {
    const zoom = map.getZoom()
    clearClusterMarkers()

    if (zoom >= CLUSTER_THRESHOLD) {
      Object.values(markersRef.current).forEach((m) => m.setVisible(true))
      return
    }

    if (currentInfoWindowRef.current) {
      currentInfoWindowRef.current.close()
      currentInfoWindowRef.current = null
    }
    Object.values(markersRef.current).forEach((m) => m.setVisible(false))

    const clusters = computeClusters(map, placesRef.current)

    clusters.forEach((cluster) => {
      if (cluster.places.length === 1) {
        const m = markersRef.current[cluster.places[0].id]
        if (m) m.setVisible(true)
        return
      }

      const { html, size } = clusterIconContent(cluster.places.length)
      const cm = new window.naver.maps.Marker({
        position: new window.naver.maps.LatLng(cluster.lat, cluster.lng),
        map,
        icon: {
          content: html,
          size:   new window.naver.maps.Size(size, size),
          anchor: new window.naver.maps.Point(size / 2, size / 2),
        },
        title: `${cluster.places.length}개 장소`,
      })

      window.naver.maps.Event.addListener(cm, 'click', () => {
        const bounds = new window.naver.maps.LatLngBounds(
          new window.naver.maps.LatLng(
            Math.min(...cluster.places.map((p) => p.lat)),
            Math.min(...cluster.places.map((p) => p.lng))
          ),
          new window.naver.maps.LatLng(
            Math.max(...cluster.places.map((p) => p.lat)),
            Math.max(...cluster.places.map((p) => p.lng))
          )
        )
        map.fitBounds(bounds, { top: 80, right: 80, bottom: 80, left: 80 })
      })

      clusterMarkersRef.current.push(cm)
    })
  }

  // ─── 마커 & 인포윈도우 세팅 ─────────────────────────────────────────────
  const setupMarkers = (map: any, data: Place[]) => {
    Object.values(markersRef.current).forEach((m) => m.setMap(null))
    clearClusterMarkers()
    markersRef.current        = {}
    infoWindowsRef.current    = {}
    currentInfoWindowRef.current = null

    data.forEach((place) => {
      const marker = new window.naver.maps.Marker({
        position: new window.naver.maps.LatLng(place.lat, place.lng),
        map,
        icon: {
          content: markerIcon(),
          anchor:  new window.naver.maps.Point(14, 36),
        },
        title: place.name,
      })
      marker.setVisible(false)

      const infoWindow = new window.naver.maps.InfoWindow({
        content: `
          <div
            onclick="window.__openPlaceDetail('${place.id}')"
            style="padding:10px 14px;cursor:pointer;font-family:sans-serif;min-width:140px"
          >
            <div style="font-size:13px;font-weight:700;color:${MARKER_COLOR}">${place.name}</div>
            <div style="font-size:11px;color:#6b7280;margin-top:2px">${TYPE_LABEL[place.type] ?? place.type}${place.district ? ' · ' + place.district : ''}</div>
            <div style="font-size:10px;color:#9ca3af;margin-top:4px">탭하여 자세히 보기 →</div>
          </div>
        `,
        borderWidth:     1,
        borderColor:     '#e5e7eb',
        backgroundColor: '#fff',
        anchorSize: new window.naver.maps.Size(10, 10),
        anchorSkew: true,
      })

      markersRef.current[place.id]    = marker
      infoWindowsRef.current[place.id] = infoWindow

      // 마커 클릭 → 인포윈도우 토글
      window.naver.maps.Event.addListener(marker, 'click', () => {
        if (currentInfoWindowRef.current === infoWindow) {
          infoWindow.close()
          currentInfoWindowRef.current = null
          return
        }
        if (currentInfoWindowRef.current) currentInfoWindowRef.current.close()
        infoWindow.open(map, marker)
        currentInfoWindowRef.current = infoWindow
        map.panTo(marker.getPosition())
      })
    })

    updateDisplay(map)
  }

  // ─── 지도 초기화 ─────────────────────────────────────────────────────────
  const initMap = () => {
    if (!mapRef.current) return
    let attempts = 0

    const tryInit = () => {
      if (window.naver?.maps) {
        const map = new window.naver.maps.Map(mapRef.current!, {
          center: new window.naver.maps.LatLng(37.5665, 126.978),
          zoom: 12,
        })
        naverMapRef.current = map

        window.naver.maps.Event.addListener(map, 'zoom_changed', () => updateDisplay(map))
        window.naver.maps.Event.addListener(map, 'idle',         () => updateDisplay(map))

        if (placesRef.current.length > 0) setupMarkers(map, placesRef.current)
        return
      }
      if (++attempts >= 50) {
        setError('naver.maps 초기화 실패. NCP 콘솔 설정을 확인하세요.')
        return
      }
      setTimeout(tryInit, 100)
    }
    tryInit()
  }

  const mapUrl = selectedPlace?.naver_place_id
    ? `https://map.naver.com/p/entry/place/${selectedPlace.naver_place_id}`
    : `https://map.naver.com/p/search/${encodeURIComponent(selectedPlace?.address ?? '')}`

  // ─── 렌더 ────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full h-full flex overflow-hidden">

      {/* ── 좌측 패널 ──────────────────────────────────────────────────── */}
      <div
        className="relative flex-shrink-0 h-full overflow-hidden transition-all duration-300 ease-in-out"
        style={{ width: panelOpen ? 360 : 0 }}
      >
        <div className="w-[360px] h-full bg-white border-r border-gray-200 flex flex-col">

          {/* 목록 뷰 */}
          {view === 'list' && (
            <>
              <div className="px-5 py-4 border-b border-gray-100 flex-shrink-0">
                <h2 className="text-sm font-bold text-gray-800">위스키 거점</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {loading ? '불러오는 중...' : `${places.length}개 장소`}
                </p>
              </div>
              <ul className="flex-1 overflow-y-auto divide-y divide-gray-50">
                {loading ? (
                  <li className="px-5 py-6 text-center text-sm text-gray-400">로딩 중...</li>
                ) : places.map((place) => (
                  <li key={place.id}>
                    <button
                      onClick={() => openDetail(place.id)}
                      className={`w-full text-left px-5 py-3.5 transition-colors hover:bg-gray-50 ${
                        activeId === place.id ? 'bg-red-50 border-l-2 border-[#BF3A21]' : ''
                      }`}
                    >
                      <div className={`text-sm font-medium ${activeId === place.id ? 'text-[#BF3A21]' : 'text-gray-800'}`}>
                        {place.name}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {TYPE_LABEL[place.type] ?? place.type}
                        {place.district && ` · ${place.district}`}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* 상세 뷰 */}
          {view === 'detail' && selectedPlace && (
            <>
              {/* 상세 헤더 */}
              <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0 flex items-center gap-3">
                <button
                  onClick={() => { setView('list'); setSelectedPlace(null); setActiveId(null) }}
                  className="shrink-0 p-1 -ml-1 text-gray-500 hover:text-gray-800 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 18l-6-6 6-6"/>
                  </svg>
                </button>
                <h2 className="text-sm font-bold text-gray-900 truncate">{selectedPlace.name}</h2>
                <span
                  className="shrink-0 ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
                  style={{ backgroundColor: MARKER_COLOR }}
                >
                  {TYPE_LABEL[selectedPlace.type] ?? selectedPlace.type}
                </span>
              </div>

              {/* 상세 본문 */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

                {/* 주소 */}
                <div className="flex items-start gap-1.5 text-xs text-gray-500">
                  <svg className="shrink-0 mt-0.5" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                  </svg>
                  <span className="leading-snug">{selectedPlace.address}</span>
                </div>

                {/* 액션 버튼 */}
                <div className="flex gap-2">
                  {/* 즐겨찾기 */}
                  <button
                    onClick={handleFavorite}
                    disabled={isFaving}
                    className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm active:scale-95 transition-all disabled:opacity-60 flex-1 border ${
                      isFavorited
                        ? 'text-white border-transparent'
                        : 'bg-white text-gray-700 hover:bg-gray-50 border-gray-200'
                    }`}
                    style={isFavorited ? { backgroundColor: MARKER_COLOR } : {}}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
                      fill={isFavorited ? 'white' : 'none'}
                      stroke={isFavorited ? 'white' : MARKER_COLOR}
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                    <span>즐겨찾기{favCount > 0 && ` (${favCount})`}</span>
                  </button>

                  {/* 네이버 지도 */}
                  <a
                    href={mapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white text-gray-700 hover:bg-gray-50 border border-gray-200 shadow-sm active:scale-95 transition-all flex-1"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={MARKER_COLOR} strokeWidth="2">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                    </svg>
                    <span>지도 보기</span>
                  </a>
                </div>

                {/* 탭 */}
                <div>
                  {/* 탭 헤더 */}
                  <div className="flex border-b border-gray-100 mb-3">
                    {(['payment', 'general'] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => { setDetailTab(tab); setShowTagInput(false); setNewTagLabel('') }}
                        className={`flex-1 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px ${
                          detailTab === tab
                            ? 'border-[#BF3A21] text-[#BF3A21]'
                            : 'border-transparent text-gray-400 hover:text-gray-600'
                        }`}
                      >
                        {tab === 'payment' ? '결제수단' : '태그'}
                      </button>
                    ))}
                  </div>

                  {/* 탭 상단: 추가 버튼 */}
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-xs text-gray-400">
                      {detailTab === 'payment' ? '클릭하여 결제 가능 수단 등록' : '클릭하여 +1 투표'}
                    </span>
                    <button
                      onClick={() => setShowTagInput((v) => !v)}
                      className="text-xs font-medium hover:opacity-70 transition-opacity"
                      style={{ color: MARKER_COLOR }}
                    >
                      {showTagInput ? '취소' : '+ 추가'}
                    </button>
                  </div>

                  {/* 태그 입력 */}
                  {showTagInput && (
                    <div className="flex gap-2 mb-2.5">
                      <input
                        ref={tagInputRef}
                        type="text"
                        value={newTagLabel}
                        onChange={(e) => setNewTagLabel(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                        placeholder={detailTab === 'payment' ? '예: 지역화폐' : '태그 입력'}
                        maxLength={20}
                        className="flex-1 text-xs border border-gray-200 rounded-full px-3 py-1.5 outline-none transition-colors"
                        onFocus={(e) => e.target.style.borderColor = MARKER_COLOR}
                        onBlur={(e)  => e.target.style.borderColor = '#e5e7eb'}
                      />
                      <button
                        onClick={handleAddTag}
                        disabled={!newTagLabel.trim() || isAddingTag}
                        className="px-3 py-1.5 rounded-full text-xs font-bold text-white disabled:opacity-40"
                        style={{ backgroundColor: MARKER_COLOR }}
                      >
                        추가
                      </button>
                    </div>
                  )}

                  {/* 태그 목록 */}
                  {loadingTags ? (
                    <p className="text-xs text-gray-400">로딩 중...</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {(detailTab === 'payment' ? paymentTagsDisplay : generalTagsDisplay).map((tag) => (
                        <button
                          key={tag.id}
                          onClick={() => handleTagVote(tag.label, detailTab)}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all active:scale-95 ${
                            tag.count > 0
                              ? 'bg-red-50 border-[#BF3A21] text-[#BF3A21]'
                              : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-[#BF3A21] hover:text-[#BF3A21] hover:bg-red-50'
                          }`}
                        >
                          <span>{tag.label}</span>
                          {tag.count > 0 && <span className="opacity-70">+{tag.count}</span>}
                        </button>
                      ))}
                      {detailTab === 'general' && generalTagsDisplay.length === 0 && (
                        <p className="text-xs text-gray-400">아직 태그가 없습니다.</p>
                      )}
                    </div>
                  )}
                </div>

              </div>
            </>
          )}

        </div>
      </div>

      {/* ── 패널 토글 버튼 ──────────────────────────────────────────────── */}
      <button
        onClick={() => setPanelOpen((v) => !v)}
        className="absolute top-1/2 -translate-y-1/2 z-30 bg-white border border-gray-200 shadow-md rounded-r-lg py-3 px-1.5 hover:bg-gray-50"
        style={{
          left: panelOpen ? 360 : 0,
          transition: 'left 300ms ease-in-out',
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          {panelOpen
            ? <path d="M15 18l-6-6 6-6"/>
            : <path d="M9 18l6-6-6-6"/>
          }
        </svg>
      </button>

      {/* ── 지도 ────────────────────────────────────────────────────────── */}
      <div className="flex-1 h-full relative">
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
            <p className="text-red-500 text-center px-6 whitespace-pre-line">{error}</p>
          </div>
        )}
        <div ref={mapRef} className="w-full h-full" />
        <Script
          id="naver-maps"
          src="https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=s1iwnee0mj"
          strategy="afterInteractive"
          onLoad={initMap}
          onError={() => setError('네이버 지도 스크립트 로드 실패')}
        />
      </div>

    </div>
  )
}
