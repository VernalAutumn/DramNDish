'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import Script from 'next/script'
import SearchFilter, { FilterState, INITIAL_FILTER } from './SearchFilter'

declare global {
  interface Window {
    naver: any
    __openPlaceDetail: (id: string) => void
  }
}

interface PlaceTag {
  id: string
  type: string
  label: string
  count?: number
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
  tags?: PlaceTag[]
}

interface Tag {
  id: string
  label: string
  count: number
  type: 'payment' | 'general' | 'category' | 'corkage' | 'cover_charge'
}

const FOOD_CATEGORIES = ['한식', '일식', '중식', '양식', '아시안', '기타'] as const

interface PlacePhoto {
  id: string
  url: string
  nickname: string
  created_at: string
}

interface Comment {
  id: string
  nickname: string
  content: string
  created_at: string
  likes: number
  dislikes: number
}

interface SearchResult {
  name: string
  address: string
  city: string | null
  district: string | null
  naver_place_id: string | null
  coords: { lat: number; lng: number }
  category: string
}

const MARKER_COLOR         = '#BF3A21'
const CLUSTER_THRESHOLD    = 14
const CLUSTER_GRID_SIZE    = 60
function inferTypeFromCategory(category: string): 'whisky' | 'bar' | 'restaurant' | null {
  const c = category.toLowerCase()
  if (c.includes('주점') || c.includes('바') || c.includes('bar') || c.includes('클럽') || c.includes('나이트')) return 'bar'
  if (c.includes('주류') || c.includes('와인') || c.includes('위스키') || c.includes('리쿼')) return 'whisky'
  if (c.includes('음식점') || c.includes('식당') || c.includes('카페') || c.includes('레스토랑') ||
      c.includes('한식') || c.includes('일식') || c.includes('중식') || c.includes('양식') || c.includes('분식')) return 'restaurant'
  return null
}

const DEFAULT_PAYMENT_TAGS  = ['카드', '현금', '온누리']
const CORKAGE_TAGS          = ['프리', '불가'] as const
const COVER_CHARGE_TAGS     = ['있음', '없음'] as const
const REGION_ORDER          = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주']
const DBLCLICK_ZOOM        = 16

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

// ── Haversine 거리 계산 (km) ────────────────────────────────────────────
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── 거리 표시 문자열 ─────────────────────────────────────────────────────
function formatDist(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`
}

// ── 주소에서 구/군 단위 추출 (단일 depth 호환용) ─────────────────────────
function extractDistrict(address: string): string {
  const parts = address.split(' ').filter(Boolean)
  return parts[1] ?? parts[0] ?? '기타'
}

// ── 주소 2-Depth 파싱: { city, gu } ──────────────────────────────────────
function parseAddressDepths(address: string): { city: string; gu: string } {
  const parts = address.split(' ').filter(Boolean)
  const rawCity = parts[0] ?? '기타'
  // 시/도 축약: 특별시→서울, 광역시→부산 등
  const city = rawCity
    .replace(/특별자치시$|특별자치도$/, '')
    .replace(/특별시$|광역시$|도$/, '')
    || rawCity
  const gu = parts[1] ?? '기타'
  return { city, gu }
}

const ADD_TYPE_OPTIONS = [
  { value: 'whisky',     label: '리쿼샵' },
  { value: 'bar',        label: '바'     },
  { value: 'restaurant', label: '식당'   },
] as const

function markerIcon(color = '#BF3A21', opacity = 1, favorited = false) {
  const starBadge = favorited ? `
    <div style="position:absolute;top:-4px;right:-4px;width:14px;height:14px;
      background:white;border-radius:50%;display:flex;align-items:center;
      justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.25);">
      <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24"
        fill="#facc15" stroke="#facc15" stroke-width="1">
        <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
      </svg>
    </div>` : ''
  return `
    <div style="cursor:pointer;opacity:${opacity};transition:opacity 0.2s;position:relative;width:28px;height:36px;">
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
        <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 22 14 22S28 24.5 28 14C28 6.268 21.732 0 14 0z" fill="${color}"/>
        <circle cx="14" cy="14" r="6" fill="white"/>
      </svg>
      ${starBadge}
    </div>
  `
}

function clusterIconContent(count: number, color: string) {
  const fs     = count >= 11 ? 14 : 12
  const h      = count >= 11 ? 44 : 36
  const shadow = '0 2px 8px rgba(0,0,0,0.35)'
  const border = '2px solid rgba(255,255,255,0.6)'
  return {
    html: `<div style="width:${h}px;height:${h}px;background:${color};border-radius:50%;
      display:flex;align-items:center;justify-content:center;color:#fff;
      font-weight:700;font-size:${fs}px;cursor:pointer;
      box-shadow:${shadow};border:${border}">${count}</div>`,
    w: h, h,
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
  const setupMarkersRef      = useRef<(map: any, data: Place[]) => void>(() => {})
  const paymentTagInputRef   = useRef<HTMLInputElement>(null)
  const generalTagInputRef   = useRef<HTMLInputElement>(null)
  const addQueryRef          = useRef<HTMLInputElement>(null)
  const prevMapStateRef      = useRef<{ zoom: number; center: any } | null>(null)
  const myLocationMarkerRef  = useRef<any>(null)
  const listScrollRef        = useRef<HTMLDivElement>(null)
  const savedScrollPosition  = useRef<number>(0)
  const favoritedIdsRef      = useRef<Set<string>>(new Set())
  const activeIdRef          = useRef<string | null>(null)
  const viewRef              = useRef<'list' | 'detail'>('list')
  const filteredPlaceIdsRef  = useRef<Set<string>>(new Set())

  // ─── state: places ───────────────────────────────────────────────────────
  const [places,   setPlaces]   = useState<Place[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  // ─── state: panel ────────────────────────────────────────────────────────
  const [panelOpen, setPanelOpen] = useState(true)
  const [view,      setView]      = useState<'list' | 'detail'>('list')
  const [mainTab,   setMainTab]   = useState<'list' | 'favorites'>('list')

  // ─── state: detail ───────────────────────────────────────────────────────
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null)
  const [selectedTags,  setSelectedTags]  = useState<Tag[]>([])
  const [loadingTags,   setLoadingTags]   = useState(false)
  const [isFavorited,   setIsFavorited]   = useState(false)
  const [favCount,      setFavCount]      = useState(0)
  const [isFaving,      setIsFaving]      = useState(false)
  const [showPaymentInput,   setShowPaymentInput]   = useState(false)
  const [newPaymentLabel,    setNewPaymentLabel]    = useState('')
  const [isAddingPaymentTag, setIsAddingPaymentTag] = useState(false)
  const [showGeneralInput,   setShowGeneralInput]   = useState(false)
  const [newGeneralLabel,    setNewGeneralLabel]    = useState('')
  const [isAddingGeneralTag, setIsAddingGeneralTag] = useState(false)

  // ─── state: favorites ────────────────────────────────────────────────────
  const [favoritedIds, setFavoritedIds] = useState<Set<string>>(new Set())

  // ─── state: photos ───────────────────────────────────────────────────────
  const [photos,         setPhotos]         = useState<PlacePhoto[]>([])
  const [selectedPhoto,  setSelectedPhoto]  = useState<string | null>(null)
  const [isUploading,    setIsUploading]    = useState(false)
  const [myNickname,  setMyNickname]  = useState<string | null>(null)
  const [myCode,      setMyCode]      = useState('')

  // ─── state: comments ─────────────────────────────────────────────────────
  const [comments,             setComments]             = useState<Comment[]>([])
  const [newPanelComment,      setNewPanelComment]      = useState('')
  const [isSubmittingComment,  setIsSubmittingComment]  = useState(false)
  const [commentSort,          setCommentSort]          = useState<'latest' | 'oldest' | 'likes'>('latest')
  const [deletingCommentId,    setDeletingCommentId]    = useState<string | null>(null)
  const [deletingPhotoId,      setDeletingPhotoId]      = useState<string | null>(null)
  const [deleteInputCode,      setDeleteInputCode]      = useState('')
  const [votedComments,          setVotedComments]          = useState<Record<string, 'like' | 'dislike'>>({})
  const [votedTags,              setVotedTags]              = useState<Set<string>>(new Set())
  const [commentPasswordError,   setCommentPasswordError]   = useState(false)
  const [photoPasswordError,     setPhotoPasswordError]     = useState(false)

  // ─── state: 우측 컨트롤 패널 ─────────────────────────────────────────────
  const [showProfileCard,  setShowProfileCard]  = useState(false)
  const [showPasswordText, setShowPasswordText] = useState(false)
  const [showFilterCard,   setShowFilterCard]   = useState(false)

  // ─── state: 검색/필터 ────────────────────────────────────────────────────
  const [filterState,   setFilterState]   = useState<FilterState>(INITIAL_FILTER)
  const [userLocation,  setUserLocation]  = useState<{ lat: number; lng: number } | null>(null)
  const [mapReady,      setMapReady]      = useState(false)
  const [accordionOpen, setAccordionOpen] = useState<Record<string, boolean>>({})
  const [viewMode,      setViewMode]      = useState<'distance' | 'region' | 'category'>('category')
  const [categorySort,       setCategorySort]       = useState<'name' | 'distance'>('name')
  const [favoriteSort,       setFavoriteSort]       = useState<'added' | 'name' | 'distance'>('added')
  const [isFavoriteEditMode, setIsFavoriteEditMode] = useState(false)

  // ─── state: 장소 추가 ─────────────────────────────────────────────────────
  const [showAddPanel,        setShowAddPanel]        = useState(false)
  const [addType,             setAddType]             = useState<'whisky' | 'bar' | 'restaurant'>('whisky')
  const [addQuery,            setAddQuery]            = useState('')
  const [searchResults,       setSearchResults]       = useState<SearchResult[]>([])
  const [isSearching,           setIsSearching]           = useState(false)
  const [isAdding,              setIsAdding]              = useState<string | null>(null)
  const [addError,              setAddError]              = useState<string | null>(null)
  const [selectedSearchResult,  setSelectedSearchResult]  = useState<SearchResult | null>(null)
  const [addPaymentTags,        setAddPaymentTags]        = useState<Set<string>>(new Set())
  // 식당 전용
  const [addCategory,         setAddCategory]         = useState('')
  const [addCorkageEnabled,   setAddCorkageEnabled]   = useState(false)
  const [addCorkageType,      setAddCorkageType]      = useState<'free' | 'paid'>('free')
  const [addCorkageText,      setAddCorkageText]      = useState('')
  // 바 전용
  const [addCoverCharge,      setAddCoverCharge]      = useState<'none' | 'exists'>('none')
  const [addCoverChargeText,  setAddCoverChargeText]  = useState('')
  // 공통
  const [addComment,             setAddComment]             = useState('')
  const [addCommentPasswordError, setAddCommentPasswordError] = useState(false)

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
        const ids = new Set(
          data.filter((p) => localStorage.getItem(`favorited_${p.id}`) === 'true').map((p) => p.id)
        )
        setFavoritedIds(ids)
        if (naverMapRef.current) setupMarkersRef.current(naverMapRef.current, data)
      })
      .catch((err) => {
        setError(`장소 목록을 불러오지 못했습니다: ${err.message}`)
        setLoading(false)
      })
  }, [])

  // ─── localStorage 초기화 ─────────────────────────────────────────────────
  useEffect(() => {
    const savedNick = localStorage.getItem('tastamp_nickname')
    const savedCode = localStorage.getItem('tastamp_code')
    if (savedNick) setMyNickname(savedNick)
    if (savedCode) setMyCode(savedCode)
  }, [])

  // ─── 태그 입력 포커스 ────────────────────────────────────────────────────
  useEffect(() => {
    if (showPaymentInput) paymentTagInputRef.current?.focus()
  }, [showPaymentInput])
  useEffect(() => {
    if (showGeneralInput) generalTagInputRef.current?.focus()
  }, [showGeneralInput])

  // ─── 장소 추가 패널 오픈 시 초기화 + 포커스 ─────────────────────────────
  useEffect(() => {
    if (showAddPanel) {
      setAddQuery(''); setSearchResults([]); setAddError(null); setAddCommentPasswordError(false)
      setSelectedSearchResult(null)
      setAddPaymentTags(new Set())
      setAddCategory('')
      setAddCorkageEnabled(false); setAddCorkageType('free'); setAddCorkageText('')
      setAddCoverCharge('none'); setAddCoverChargeText('')
      setAddComment('')
      setTimeout(() => addQueryRef.current?.focus(), 50)
    }
  }, [showAddPanel])

  // ─── window 전역 함수 (인포윈도우 onclick용) ─────────────────────────────
  useEffect(() => {
    window.__openPlaceDetail = (id: string) => openDetailRef.current(id)
    return () => { delete (window as any).__openPlaceDetail }
  }, [])

  // ─── 상세 뷰 열기 ────────────────────────────────────────────────────────
  const openDetail = useCallback(async (id: string) => {
    if (activeIdRef.current === id && viewRef.current === 'detail') return
    const place = placesRef.current.find((p) => p.id === id)
    if (!place) return

    savedScrollPosition.current = listScrollRef.current?.scrollTop ?? 0
    setSelectedPlace(place)
    setView('detail')
    setPanelOpen(true)
    setShowAddPanel(false)
    setActiveId(id)
    setFavCount(place.favorites_count ?? 0)
    setIsFavorited(localStorage.getItem(`favorited_${place.id}`) === 'true')

    if (naverMapRef.current && window.naver?.maps) {
      naverMapRef.current.panTo(new window.naver.maps.LatLng(place.lat, place.lng))
    }

    setSelectedTags([])
    setShowPaymentInput(false)
    setNewPaymentLabel('')
    setShowGeneralInput(false)
    setNewGeneralLabel('')
    setPhotos([])
    setComments([])
    setVotedComments({})
    setVotedTags(new Set())
    setCommentPasswordError(false)
    setPhotoPasswordError(false)
    setNewPanelComment('')
    setIsSubmittingComment(false)
    setCommentSort('latest')
    setDeletingCommentId(null)
    setDeletingPhotoId(null)
    setDeleteInputCode('')
    setLoadingTags(true)

    try {
      const [tagsRes, photosRes, commentsRes] = await Promise.all([
        fetch(`/api/places/${place.id}/tags`),
        fetch(`/api/places/${place.id}/photos`),
        fetch(`/api/places/${place.id}/comments`),
      ])
      const tagsData     = await tagsRes.json()
      const photosData   = await photosRes.json()
      const commentsData = await commentsRes.json()
      setSelectedTags(Array.isArray(tagsData)   ? tagsData   : [])
      setPhotos(Array.isArray(photosData)        ? photosData : [])
      const loadedComments: Comment[] = Array.isArray(commentsData) ? commentsData : []
      setComments(loadedComments)
      // localStorage에서 이미 투표한 코멘트 복원
      const voted: Record<string, 'like' | 'dislike'> = {}
      for (const c of loadedComments) {
        const v = localStorage.getItem(`tastamp_vote_${c.id}`)
        if (v === 'like' || v === 'dislike') voted[c.id] = v
      }
      setVotedComments(voted)
      // localStorage에서 이미 투표한 태그 복원
      const prefix = `voted_tag_${place.id}_`
      const votedTagLabels = new Set(
        Object.keys(localStorage)
          .filter((k) => k.startsWith(prefix))
          .map((k) => decodeURIComponent(k.slice(prefix.length)))
      )
      setVotedTags(votedTagLabels)
    } finally {
      setLoadingTags(false)
    }
  }, [])

  useEffect(() => { openDetailRef.current = openDetail }, [openDetail])
  useEffect(() => { activeIdRef.current    = activeId },    [activeId])
  useEffect(() => { viewRef.current        = view },        [view])
  useEffect(() => {
    favoritedIdsRef.current = favoritedIds
    if (naverMapRef.current) updateDisplay(naverMapRef.current)
  }, [favoritedIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 리스트 복귀 시 스크롤 위치 복원 ────────────────────────────────────
  useEffect(() => {
    if (view === 'list' && listScrollRef.current) {
      // 레이아웃 페인트 이후 복원되도록 requestAnimationFrame 사용
      requestAnimationFrame(() => {
        if (listScrollRef.current) {
          listScrollRef.current.scrollTop = savedScrollPosition.current
        }
      })
    }
  }, [view])

  // ─── GPS 위치 취득 ───────────────────────────────────────────────────────
  const requestUserLocation = useCallback((onSuccess?: (loc: { lat: number; lng: number }) => void) => {
    if (!navigator.geolocation) {
      alert('이 브라우저는 위치 서비스를 지원하지 않습니다.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setUserLocation(loc)
        onSuccess?.(loc)
      },
      (err) => {
        if (err.code === 1) {
          alert('내 위치를 확인하기 위해 위치 권한이 필요합니다. 브라우저 설정에서 위치 권한을 허용해 주세요.')
        } else {
          alert('위치 정보를 가져올 수 없습니다.')
        }
      }
    )
  }, [])

  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {}  // 최초 마운트 시 조용히 무시 (사용자가 명시적으로 요청한 것이 아님)
    )
  }, [])

  // ─── 리스트 아이템 즐겨찾기 빠른 토글 ──────────────────────────────────
  const handleFavoriteById = useCallback(async (placeId: string) => {
    const newFaved = !favoritedIds.has(placeId)
    localStorage.setItem(`favorited_${placeId}`, String(newFaved))
    setFavoritedIds((prev) => {
      const next = new Set(prev)
      if (newFaved) next.add(placeId); else next.delete(placeId)
      return next
    })
    try {
      await fetch(`/api/places/${placeId}/favorite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: newFaved ? 'add' : 'remove' }),
      })
    } catch {
      localStorage.setItem(`favorited_${placeId}`, String(!newFaved))
      setFavoritedIds((prev) => {
        const next = new Set(prev)
        if (!newFaved) next.add(placeId); else next.delete(placeId)
        return next
      })
    }
  }, [favoritedIds])

  // ─── 즐겨찾기 토글 ──────────────────────────────────────────────────────
  const handleFavorite = async () => {
    if (isFaving || !selectedPlace) return
    setIsFaving(true)
    const newFaved = !isFavorited
    setIsFavorited(newFaved)
    setFavCount((c) => newFaved ? c + 1 : Math.max(0, c - 1))
    localStorage.setItem(`favorited_${selectedPlace.id}`, String(newFaved))
    setFavoritedIds((prev) => {
      const next = new Set(prev)
      if (newFaved) next.add(selectedPlace.id); else next.delete(selectedPlace.id)
      return next
    })
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
      setFavoritedIds((prev) => {
        const next = new Set(prev)
        if (!newFaved) next.add(selectedPlace.id); else next.delete(selectedPlace.id)
        return next
      })
    } finally {
      setIsFaving(false)
    }
  }

  // ─── 태그 투표 ──────────────────────────────────────────────────────────
  const handleTagVote = async (label: string, type: string) => {
    if (!selectedPlace) return
    const storageKey = `voted_tag_${selectedPlace.id}_${encodeURIComponent(label)}`
    const isVoted    = !!localStorage.getItem(storageKey)
    const action     = isVoted ? 'remove' : 'add'
    const existing   = selectedTags.find((t) => t.label === label)

    // ── 낙관적 업데이트 ──────────────────────────────────────────────────
    if (action === 'add') {
      localStorage.setItem(storageKey, '1')
      setVotedTags((prev) => new Set([...prev, label]))
      if (existing) {
        setSelectedTags((prev) => prev.map((t) => t.id === existing.id ? { ...t, count: t.count + 1 } : t))
      }
    } else {
      localStorage.removeItem(storageKey)
      setVotedTags((prev) => { const n = new Set(prev); n.delete(label); return n })
      if (existing) {
        setSelectedTags((prev) =>
          existing.count <= 1
            ? prev.filter((t) => t.id !== existing.id)
            : prev.map((t) => t.id === existing.id ? { ...t, count: t.count - 1 } : t)
        )
      }
    }

    try {
      const res  = await fetch(`/api/places/${selectedPlace.id}/tags`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ label, type, action }),
      })
      const data = await res.json()
      if (res.ok) {
        if (action === 'add') {
          setSelectedTags((prev) => {
            const inState = prev.find((t) => t.label === label)
            if (inState) return prev.map((t) => t.label === label ? data : t)
            return [...prev, data]
          })
        } else {
          if (data.deleted) {
            setSelectedTags((prev) => prev.filter((t) => t.label !== label))
          } else {
            setSelectedTags((prev) => prev.map((t) => t.label === label ? data : t))
          }
        }
      } else {
        // ── 롤백 ──────────────────────────────────────────────────────────
        if (action === 'add') {
          localStorage.removeItem(storageKey)
          setVotedTags((prev) => { const n = new Set(prev); n.delete(label); return n })
          if (existing) setSelectedTags((prev) => prev.map((t) => t.id === existing.id ? { ...t, count: t.count - 1 } : t))
        } else {
          localStorage.setItem(storageKey, '1')
          setVotedTags((prev) => new Set([...prev, label]))
          if (existing) setSelectedTags((prev) => prev.map((t) => t.id === existing.id ? { ...t, count: t.count + 1 } : t))
        }
      }
    } catch {
      if (action === 'add') {
        localStorage.removeItem(storageKey)
        setVotedTags((prev) => { const n = new Set(prev); n.delete(label); return n })
        if (existing) setSelectedTags((prev) => prev.map((t) => t.id === existing.id ? { ...t, count: t.count - 1 } : t))
      } else {
        localStorage.setItem(storageKey, '1')
        setVotedTags((prev) => new Set([...prev, label]))
        if (existing) setSelectedTags((prev) => prev.map((t) => t.id === existing.id ? { ...t, count: t.count + 1 } : t))
      }
    }
  }

  // ─── 결제수단 태그 신규 추가 ────────────────────────────────────────────
  const handleAddPaymentTag = async () => {
    const label = newPaymentLabel.trim()
    if (!label || isAddingPaymentTag || !selectedPlace) return
    setIsAddingPaymentTag(true)
    try {
      const res  = await fetch(`/api/places/${selectedPlace.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, type: 'payment', code: myCode }),
      })
      const data = await res.json()
      if (res.ok) {
        setSelectedTags((prev) => {
          const exists = prev.find((t) => t.label === label)
          if (exists) return prev.map((t) => t.label === label ? data : t)
          return [...prev, data]
        })
        setNewPaymentLabel('')
        setShowPaymentInput(false)
      }
    } finally {
      setIsAddingPaymentTag(false)
    }
  }

  // ─── 일반 태그 신규 추가 ────────────────────────────────────────────────
  const handleAddGeneralTag = async () => {
    const label = newGeneralLabel.trim()
    if (!label || isAddingGeneralTag || !selectedPlace) return
    setIsAddingGeneralTag(true)
    try {
      const res  = await fetch(`/api/places/${selectedPlace.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, type: 'general', code: myCode }),
      })
      const data = await res.json()
      if (res.ok) {
        setSelectedTags((prev) => {
          const exists = prev.find((t) => t.label === label)
          if (exists) return prev.map((t) => t.label === label ? data : t)
          return [...prev, data]
        })
        setNewGeneralLabel('')
        setShowGeneralInput(false)
      }
    } finally {
      setIsAddingGeneralTag(false)
    }
  }

  // ─── 패널 코멘트 등록 ────────────────────────────────────────────────────
  const handleSubmitPanelComment = async () => {
    const content = newPanelComment.trim()
    if (!content || isSubmittingComment || !selectedPlace) return
    if (!myCode) { setCommentPasswordError(true); setShowProfileCard(true); return }
    setCommentPasswordError(false)
    setIsSubmittingComment(true)
    const nick = myNickname || '익명'
    const optimistic: Comment = {
      id: `__opt__${Date.now()}`,
      nickname: nick,
      content,
      created_at: new Date().toISOString(),
      likes: 0,
      dislikes: 0,
    }
    setComments((prev) => [optimistic, ...prev])
    setNewPanelComment('')
    try {
      const res = await fetch(`/api/places/${selectedPlace.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nick, content, code: myCode }),
      })
      if (!res.ok) throw new Error('등록 실패')
      const saved: Comment = await res.json()
      setComments((prev) => prev.map((c) => (c.id === optimistic.id ? saved : c)))
    } catch (err) {
      console.error('[panel comment]', err)
      setComments((prev) => prev.filter((c) => c.id !== optimistic.id))
      setNewPanelComment(content)
    } finally {
      setIsSubmittingComment(false)
    }
  }

  // ─── 코멘트 삭제 (인라인 폼 열기 / 확인) ───────────────────────────────
  const handleDeleteComment = (commentId: string) => {
    setDeletingCommentId(commentId)
    setDeleteInputCode('')
  }
  const handleConfirmDeleteComment = async () => {
    if (!selectedPlace || !deletingCommentId) return
    const res = await fetch(`/api/places/${selectedPlace.id}/comments/${deletingCommentId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: deleteInputCode }),
    })
    if (res.ok) {
      setComments((prev) => prev.filter((c) => c.id !== deletingCommentId))
      setDeletingCommentId(null)
      setDeleteInputCode('')
    } else {
      alert('비밀번호가 일치하지 않습니다.')
    }
  }

  // ─── 사진 삭제 (인라인 폼 열기 / 확인) ─────────────────────────────────
  const handleDeletePhoto = (photoId: string) => {
    setDeletingPhotoId(photoId)
    setDeleteInputCode('')
  }
  const handleConfirmDeletePhoto = async () => {
    if (!selectedPlace || !deletingPhotoId) return
    const res = await fetch(`/api/places/${selectedPlace.id}/photos/${deletingPhotoId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: deleteInputCode }),
    })
    if (res.ok) {
      setPhotos((prev) => prev.filter((p) => p.id !== deletingPhotoId))
      setDeletingPhotoId(null)
      setDeleteInputCode('')
    } else {
      alert('비밀번호가 일치하지 않습니다.')
    }
  }

  // ─── 코멘트 투표 (1인 1투표, 취소 불가) ────────────────────────────────
  const handleVoteComment = async (commentId: string, type: 'like' | 'dislike') => {
    if (!selectedPlace) return
    if (votedComments[commentId]) return  // 이미 투표함
    // 낙관적 업데이트 + 투표 상태 즉시 반영
    setComments((prev) => prev.map((c) =>
      c.id !== commentId ? c : {
        ...c,
        likes:    type === 'like'    ? c.likes    + 1 : c.likes,
        dislikes: type === 'dislike' ? c.dislikes + 1 : c.dislikes,
      }
    ))
    setVotedComments((prev) => ({ ...prev, [commentId]: type }))
    try {
      const res = await fetch(`/api/places/${selectedPlace.id}/comments/${commentId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      if (res.ok) {
        const updated = await res.json()
        setComments((prev) => prev.map((c) =>
          c.id === commentId ? { ...c, likes: updated.likes, dislikes: updated.dislikes } : c
        ))
        localStorage.setItem(`tastamp_vote_${commentId}`, type)
      } else {
        throw new Error('vote failed')
      }
    } catch {
      // 롤백
      setComments((prev) => prev.map((c) =>
        c.id !== commentId ? c : {
          ...c,
          likes:    type === 'like'    ? Math.max(0, c.likes    - 1) : c.likes,
          dislikes: type === 'dislike' ? Math.max(0, c.dislikes - 1) : c.dislikes,
        }
      ))
      setVotedComments((prev) => {
        const next = { ...prev }
        delete next[commentId]
        return next
      })
    }
  }

  // ─── 사진 업로드 ────────────────────────────────────────────────────────
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selectedPlace) return
    if (!myCode) { setPhotoPasswordError(true); setShowProfileCard(true); e.target.value = ''; return }
    setPhotoPasswordError(false)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('nickname', myNickname || '익명')
    formData.append('code', myCode)
    setIsUploading(true)
    try {
      const res = await fetch(`/api/places/${selectedPlace.id}/photos`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) throw new Error('업로드 실패')
      const newPhoto = await res.json()
      setPhotos((prev) => [newPhoto, ...prev])
    } catch (err) {
      console.error('[photo upload]', err)
      alert('사진 업로드 중 오류가 발생했습니다.')
    } finally {
      setIsUploading(false)
      e.target.value = ''
    }
  }

  // ─── 네이버 검색 ─────────────────────────────────────────────────────────
  const handleSearch = async () => {
    const q = addQuery.trim()
    if (!q || isSearching) return
    setIsSearching(true)
    setSearchResults([])
    setAddError(null)
    try {
      const res = await fetch(`/api/naver/search?query=${encodeURIComponent(q)}`)
      const data = await res.json()
      if (!res.ok) {
        setAddError(data.error ?? '검색 중 오류가 발생했습니다.')
        return
      }
      if (!Array.isArray(data) || data.length === 0) {
        setAddError('검색 결과가 없습니다.')
        return
      }
      setSearchResults(data)
    } catch {
      setAddError('네트워크 오류가 발생했습니다.')
    } finally {
      setIsSearching(false)
    }
  }

  // ─── 장소 등록 ───────────────────────────────────────────────────────────
  const handleAddPlace = async (result: SearchResult) => {
    if (isAdding) return
    // 한 줄 평 입력 시 비밀번호 필수
    if (addComment.trim() && !myCode) {
      setAddCommentPasswordError(true)
      setShowProfileCard(true)
      alert('비밀번호를 설정해 주세요.')
      return
    }
    setAddCommentPasswordError(false)
    setIsAdding(result.name)
    setAddError(null)
    try {
      const res = await fetch('/api/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:            result.name,
          address:         result.address,
          type:            addType,
          naver_place_id:  result.naver_place_id,
          district:        result.district,
          city:            result.city,
          lat:             result.coords.lat,
          lng:             result.coords.lng,
          ...(addComment.trim() ? {
            comment:  addComment.trim(),
            nickname: myNickname || '익명',
            code:     myCode,
          } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setAddError(data.error ?? '등록 중 오류가 발생했습니다.')
        return
      }

      // 타입별 태그 등록
      const tagsToPost: { type: string; label: string }[] = []
      if (addType === 'whisky') {
        addPaymentTags.forEach((label) => tagsToPost.push({ type: 'payment', label }))
      } else if (addType === 'restaurant') {
        if (addCategory) tagsToPost.push({ type: 'category', label: addCategory })
        if (!addCorkageEnabled) {
          tagsToPost.push({ type: 'corkage', label: '불가' })
        } else if (addCorkageType === 'free') {
          tagsToPost.push({ type: 'corkage', label: '프리' })
        } else {
          tagsToPost.push({ type: 'corkage', label: `유료${addCorkageText.trim() ? ': ' + addCorkageText.trim() : ''}` })
        }
      } else if (addType === 'bar') {
        if (addCoverCharge === 'exists')
          tagsToPost.push({ type: 'cover_charge', label: `있음${addCoverChargeText.trim() ? ': ' + addCoverChargeText.trim() : ''}` })
      }

      const posts: Promise<any>[] = tagsToPost.map((tag) =>
        fetch(`/api/places/${data.id}/tags`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tag),
        })
      )
      await Promise.all(posts)

      // 목록 갱신 + 마커 업데이트
      const listRes  = await fetch('/api/places')
      const listData: Place[] = await listRes.json()
      setPlaces(listData)
      placesRef.current = listData
      if (naverMapRef.current) setupMarkersRef.current(naverMapRef.current, listData)

      // 추가 완료 후 상세 패널 오픈
      setShowAddPanel(false)
      setSelectedSearchResult(null)
      await openDetail(data.id)
    } catch {
      setAddError('등록 중 네트워크 오류가 발생했습니다.')
    } finally {
      setIsAdding(null)
    }
  }

  // ─── 결제수단 태그 목록 ──────────────────────────────────────────────────
  const paymentTagsDisplay = useMemo(() => {
    const dbPayment = selectedTags.filter((t) => t.type === 'payment')
    const dbLabels  = new Set(dbPayment.map((t) => t.label))
    const suggestions = DEFAULT_PAYMENT_TAGS
      .filter((label) => !dbLabels.has(label))
      .map((label) => ({ id: `__pay__${label}`, label, count: 0, type: 'payment' as const }))
    return [...dbPayment.slice().sort((a, b) => b.count - a.count), ...suggestions]
  }, [selectedTags])

  // ─── 콜키지 정책 목록 (식당 전용) ──────────────────────────────────────
  const corkageTagsDisplay = useMemo(() => {
    const db       = selectedTags.filter((t) => t.type === 'corkage')
    const dbLabels = new Set(db.map((t) => t.label))
    const stubs    = CORKAGE_TAGS
      .filter((l) => !dbLabels.has(l))
      .map((l) => ({ id: `__corkage__${l}`, label: l, count: 0, type: 'corkage' as const }))
    return [...db.slice().sort((a, b) => b.count - a.count), ...stubs]
  }, [selectedTags])

  // ─── 커버차지 정책 목록 (바 전용) ────────────────────────────────────────
  const coverChargeTagsDisplay = useMemo(() => {
    const db       = selectedTags.filter((t) => t.type === 'cover_charge')
    const dbLabels = new Set(db.map((t) => t.label))
    const stubs    = COVER_CHARGE_TAGS
      .filter((l) => !dbLabels.has(l))
      .map((l) => ({ id: `__cover__${l}`, label: l, count: 0, type: 'cover_charge' as const }))
    return [...db.slice().sort((a, b) => b.count - a.count), ...stubs]
  }, [selectedTags])

  // ─── 일반 태그 목록 ──────────────────────────────────────────────────────
  const generalTagsDisplay = useMemo(() => {
    return selectedTags
      .filter((t) => t.type === 'general')
      .slice()
      .sort((a, b) => b.count - a.count)
  }, [selectedTags])

  // ─── 정렬된 코멘트 목록 ─────────────────────────────────────────────────
  const sortedComments = useMemo(() => {
    const arr = [...comments]
    if (commentSort === 'latest')  return arr.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    if (commentSort === 'oldest')  return arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    if (commentSort === 'likes')   return arr.sort((a, b) => b.likes - a.likes)
    return arr
  }, [comments, commentSort])

  // ─── 필터링된 장소 목록 ─────────────────────────────────────────────────
  const filteredPlaces = useMemo(() => {
    const { query, type, corkage, categories } = filterState
    const isFilterActive =
      query.trim() !== '' || type !== 'all' || corkage || categories.length > 0

    const result = places.filter((p) => {
      if (query.trim() && !p.name.toLowerCase().includes(query.trim().toLowerCase())) return false
      if (type !== 'all' && p.type !== type) return false
      // 콜키지: '불가' 이외의 corkage 태그('프리', '유료*')가 반드시 존재해야 함
      if (corkage && !p.tags?.some((t) => t.type === 'corkage' && t.label !== '불가')) return false
      // 카테고리: 선택된 카테고리 중 하나라도 정확히 일치하는 태그가 있어야 함 (OR)
      if (categories.length > 0 && !p.tags?.some((t) => t.type === 'category' && categories.includes(t.label))) return false
      return true
    })

    // 필터가 활성화됐는데 0건 → 빈 배열 명시 반환 (전체 장소 반환 금지)
    if (isFilterActive && result.length === 0) return []
    return result
  }, [places, filterState])

  // ─── 거리순 정렬 + 지역별 그룹화 ────────────────────────────────────────
  const distanceSortedPlaces = useMemo(() => {
    if (!userLocation) return filteredPlaces
    return [...filteredPlaces].sort((a, b) => {
      const da = haversine(userLocation.lat, userLocation.lng, a.lat, a.lng)
      const db = haversine(userLocation.lat, userLocation.lng, b.lat, b.lng)
      return da - db
    })
  }, [filteredPlaces, userLocation])

  // 2-Depth: Map<city, Map<gu, places[]>>
  const groupedByRegion = useMemo(() => {
    const outer = new Map<string, Map<string, typeof distanceSortedPlaces>>()
    for (const place of distanceSortedPlaces) {
      const { city, gu } = parseAddressDepths(place.address)
      if (!outer.has(city)) outer.set(city, new Map())
      const inner = outer.get(city)!
      if (!inner.has(gu)) inner.set(gu, [])
      inner.get(gu)!.push(place)
    }
    return outer
  }, [distanceSortedPlaces])

  const groupedByCategory = useMemo(() => {
    const order = ['whisky', 'bar', 'restaurant']
    const map = new Map<string, typeof distanceSortedPlaces>()
    for (const place of filteredPlaces) {
      const key = place.type
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(place)
    }
    // 그룹 내 정렬
    for (const [key, items] of map.entries()) {
      if (categorySort === 'distance' && userLocation) {
        map.set(key, [...items].sort((a, b) =>
          haversine(userLocation.lat, userLocation.lng, a.lat, a.lng) -
          haversine(userLocation.lat, userLocation.lng, b.lat, b.lng)
        ))
      } else {
        map.set(key, [...items].sort((a, b) => a.name.localeCompare(b.name, 'ko')))
      }
    }
    // 종류 순서 정렬
    return new Map([...map.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])))
  }, [filteredPlaces, categorySort, userLocation])

  // ─── 즐겨찾기 장소 목록 ─────────────────────────────────────────────────
  const favWhiskyPlaces = useMemo(() =>
    places.filter((p) => p.type === 'whisky' && favoritedIds.has(p.id)),
    [places, favoritedIds]
  )
  const favBarPlaces = useMemo(() =>
    places.filter((p) => p.type === 'bar' && favoritedIds.has(p.id)),
    [places, favoritedIds]
  )
  const favRestPlaces = useMemo(() =>
    places.filter((p) => p.type === 'restaurant' && favoritedIds.has(p.id)),
    [places, favoritedIds]
  )

  // ─── 필터 변경 시 마커 아이콘 교체로 opacity 동기화 ────────────────────
  useEffect(() => {
    const ids = new Set(filteredPlaces.map((p) => p.id))
    filteredPlaceIdsRef.current = ids
    const hasFilter = ids.size < placesRef.current.length
    placesRef.current.forEach((place) => {
      const marker = markersRef.current[place.id]
      if (!marker) return
      const active  = !hasFilter || ids.has(place.id)
      const opacity = active ? 1 : 0.2
      const zIndex  = active ? 100 : 10
      marker.setZIndex(zIndex)
      marker.setIcon({
        content: markerIcon(TYPE_COLOR[place.type] ?? MARKER_COLOR, opacity, favoritedIdsRef.current.has(place.id)),
        anchor:  new window.naver.maps.Point(14, 36),
      })
    })
    if (naverMapRef.current) updateDisplay(naverMapRef.current)
  }, [filteredPlaces]) // eslint-disable-line react-hooks/exhaustive-deps

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
    const filteredIds = filteredPlaceIdsRef.current
    const hasFilter   = filteredIds.size < placesRef.current.length

    if (zoom >= CLUSTER_THRESHOLD) {
      // 줌 인: 모든 마커 표시, opacity만 분리
      placesRef.current.forEach((place) => {
        const m = markersRef.current[place.id]
        if (!m) return
        const active  = !hasFilter || filteredIds.has(place.id)
        const opacity = active ? 1 : 0.2
        m.setVisible(true)
        m.setIcon({
          content: markerIcon(TYPE_COLOR[place.type] ?? MARKER_COLOR, opacity, favoritedIdsRef.current.has(place.id)),
          anchor:  new window.naver.maps.Point(14, 36),
        })
      })
      return
    }

    if (currentInfoWindowRef.current) {
      currentInfoWindowRef.current.close()
      currentInfoWindowRef.current = null
    }

    // 전체 숨김 후 개별 제어
    Object.values(markersRef.current).forEach((m) => m.setVisible(false))

    // 필터 미해당 → dim 개별 마커 (클러스터링 제외)
    if (hasFilter) {
      placesRef.current.forEach((p) => {
        if (!filteredIds.has(p.id)) {
          const m = markersRef.current[p.id]
          if (m) {
            m.setVisible(true)
            m.setIcon({
              content: markerIcon(TYPE_COLOR[p.type] ?? MARKER_COLOR, 0.2),
              anchor:  new window.naver.maps.Point(14, 36),
            })
          }
        }
      })
    }

    // 필터 해당만 클러스터링 (type별 독립 인스턴스)
    const toCluster = hasFilter
      ? placesRef.current.filter((p) => filteredIds.has(p.id))
      : placesRef.current

    // type으로 그룹화
    const byType: Record<string, Place[]> = {}
    for (const p of toCluster) {
      if (!byType[p.type]) byType[p.type] = []
      byType[p.type].push(p)
    }

    Object.entries(byType).forEach(([type, group]) => {
      const typeColor = TYPE_COLOR[type] ?? MARKER_COLOR
      const clusters  = computeClusters(map, group)
      clusters.forEach((cluster) => {
        if (cluster.places.length === 1) {
          const place0 = cluster.places[0]
          const m = markersRef.current[place0.id]
          if (m) {
            m.setVisible(true)
            m.setIcon({
              content: markerIcon(typeColor, 1, favoritedIdsRef.current.has(place0.id)),
              anchor:  new window.naver.maps.Point(14, 36),
            })
          }
          return
        }
        const { html, w, h } = clusterIconContent(cluster.places.length, typeColor)
        const cm = new window.naver.maps.Marker({
          position: new window.naver.maps.LatLng(cluster.lat, cluster.lng),
          map,
          icon: {
            content: html,
            size:   new window.naver.maps.Size(w, h),
            anchor: new window.naver.maps.Point(w / 2, h / 2),
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
      const color = TYPE_COLOR[place.type] ?? MARKER_COLOR
      const marker = new window.naver.maps.Marker({
        position: new window.naver.maps.LatLng(place.lat, place.lng),
        map,
        icon: {
          content: markerIcon(color, 1, favoritedIdsRef.current.has(place.id)),
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
            <div style="font-size:13px;font-weight:700;color:${color}">${place.name}</div>
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

      markersRef.current[place.id]     = marker
      infoWindowsRef.current[place.id] = infoWindow

      // ── mouseover / mouseout: 인포윈도우 미리보기 ──────────────────────────
      window.naver.maps.Event.addListener(marker, 'mouseover', () => {
        if (currentInfoWindowRef.current !== infoWindow) {
          if (currentInfoWindowRef.current) currentInfoWindowRef.current.close()
          infoWindow.open(map, marker)
          currentInfoWindowRef.current = infoWindow
        }
      })
      window.naver.maps.Event.addListener(marker, 'mouseout', () => {
        infoWindow.close()
        if (currentInfoWindowRef.current === infoWindow) currentInfoWindowRef.current = null
      })

      // ── click: 센터 이동 + 상세 패널 ───────────────────────────────────────
      window.naver.maps.Event.addListener(marker, 'click', () => {
        map.setCenter(marker.getPosition())
        openDetailRef.current(place.id)
      })

      // ── dblclick: 줌 토글 ──────────────────────────────────────────────────
      window.naver.maps.Event.addListener(marker, 'dblclick', () => {
        const currentZoom = map.getZoom()
        if (currentZoom < DBLCLICK_ZOOM) {
          // 줌 아웃 상태 → 줌 인, 이전 상태 저장
          prevMapStateRef.current = { zoom: currentZoom, center: map.getCenter() }
          map.setCenter(marker.getPosition())
          map.setZoom(DBLCLICK_ZOOM)
          openDetailRef.current(place.id)
        } else {
          // 줌 인 상태 → 무조건 복원
          if (prevMapStateRef.current) {
            map.setZoom(prevMapStateRef.current.zoom)
            map.setCenter(prevMapStateRef.current.center)
            prevMapStateRef.current = null
          } else {
            map.setZoom(13)
          }
        }
      })
    })

    updateDisplay(map)
  }

  // setupMarkers를 ref에 동기화
  useEffect(() => { setupMarkersRef.current = setupMarkers })

  // ─── 내 위치(Blue Dot) 마커 ──────────────────────────────────────────────
  useEffect(() => {
    if (!window.naver?.maps || !naverMapRef.current) return

    if (!userLocation) {
      // 위치 소실 시 마커 제거
      if (myLocationMarkerRef.current) {
        myLocationMarkerRef.current.setMap(null)
        myLocationMarkerRef.current = null
      }
      return
    }

    const position = new window.naver.maps.LatLng(userLocation.lat, userLocation.lng)
    const blueDotContent = `
      <div style="
        width: 16px; height: 16px;
        background: #3b82f6;
        border: 2.5px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 6px rgba(59,130,246,0.5);
        position: relative;
      ">
        <div style="
          width: 32px; height: 32px;
          background: rgba(59,130,246,0.15);
          border-radius: 50%;
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
        "></div>
      </div>`

    if (myLocationMarkerRef.current) {
      myLocationMarkerRef.current.setPosition(position)
    } else {
      myLocationMarkerRef.current = new window.naver.maps.Marker({
        map: naverMapRef.current,
        position,
        icon: {
          content: blueDotContent,
          anchor: new window.naver.maps.Point(8, 8),
        },
        zIndex: 200,
      })
    }
  }, [userLocation, mapReady])

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
        if (placesRef.current.length > 0) setupMarkersRef.current(map, placesRef.current)
        setMapReady(true)
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

  const mapUrl = selectedPlace
    ? selectedPlace.naver_place_id
      ? `https://map.naver.com/p/entry/place/${selectedPlace.naver_place_id}`
      : `https://map.naver.com/v5/search/${encodeURIComponent(selectedPlace.name)}`
    : '#'

  // ─── 렌더 ────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full h-full overflow-hidden">

      {/* ── 지도 (전체 배경) ────────────────────────────────────────────── */}
      <div className="absolute inset-0 z-0">
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

      {/* ── 플로팅 패널 ────────────────────────────────────────────────── */}
      {/* 모바일: bottom sheet / 데스크탑: 좌측 플로팅 패널 */}
      <div
        className={[
          'z-20 transition-all duration-300 ease-in-out',
          // 모바일: 바텀 시트
          'fixed bottom-0 left-0 right-0',
          // 데스크탑: 좌측 플로팅 패널
          'md:absolute md:top-4 md:bottom-4 md:left-4 md:right-auto md:w-[360px]',
          panelOpen
            ? 'translate-y-0 md:translate-x-0 md:pointer-events-auto'
            : 'translate-y-[calc(100%-3rem)] md:translate-y-0 md:-translate-x-[calc(100%+1rem)] md:pointer-events-none',
        ].join(' ')}
        style={{ willChange: 'transform' }}
      >
        {/* 모바일 핸들바 */}
        <div
          className="md:hidden flex justify-center items-center py-2 cursor-pointer bg-white rounded-t-2xl"
          onClick={() => setPanelOpen((v) => !v)}
        >
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        <div
          className="panel w-full h-[75dvh] md:h-full flex flex-col overflow-hidden md:rounded-2xl"
          style={{}}
        >

          {/* 목록 / 즐겨찾기 탭 헤더 */}
          {view === 'list' && !showAddPanel && (
            <div className="flex border-b border-border-default flex-shrink-0">
              {(['list', 'favorites'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setMainTab(tab)}
                  className={`flex-1 py-3 text-label font-semibold transition-colors border-b-2 -mb-px ${
                    mainTab === tab
                      ? 'border-brand-primary text-brand-primary'
                      : 'border-transparent text-text-tertiary hover:text-text-secondary'
                  }`}
                >
                  {tab === 'list' ? '목록' : '즐겨찾기'}
                </button>
              ))}
            </div>
          )}

          {/* ── 장소 추가 패널 ─────────────────────────────────────────── */}
          {view === 'list' && showAddPanel && (
            <>
              {/* 헤더 */}
              <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0 flex items-center gap-2">
                <button
                  onClick={() => setShowAddPanel(false)}
                  className="shrink-0 p-1 -ml-1 text-gray-500 hover:text-gray-800 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M15 18l-6-6 6-6"/>
                  </svg>
                </button>
                <h2 className="text-sm font-bold text-gray-900">장소 추가</h2>
              </div>

              {/* ── 수직형 폼 ───────────────────────────────────────────── */}
              <div className="flex-1 overflow-y-auto divide-y divide-gray-100">

                {/* ① 검색 */}
                <div className="px-4 py-4 space-y-3">
                  <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">상호명 검색</p>

                  {/* 상호명 검색 */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-2">검색 후 결과를 선택하세요</p>
                    <div className="flex gap-2">
                      <input
                        ref={addQueryRef}
                        type="text"
                        value={addQuery}
                        onChange={(e) => setAddQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        placeholder="상호명 입력 후 검색"
                        className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none transition-colors focus:border-gray-400"
                      />
                      <button
                        onClick={handleSearch}
                        disabled={!addQuery.trim() || isSearching}
                        className="px-4 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-40 transition-opacity"
                        style={{ backgroundColor: MARKER_COLOR }}
                      >
                        {isSearching ? '검색 중' : '검색'}
                      </button>
                    </div>
                  </div>

                  {/* 검색 결과 */}
                  {addError && (
                    <p className="text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{addError}</p>
                  )}
                  {searchResults.length > 0 && (
                    <ul className="space-y-1.5">
                      {searchResults.map((r, i) => {
                        const isSelected = selectedSearchResult?.naver_place_id === r.naver_place_id && selectedSearchResult?.name === r.name
                        return (
                          <li key={i}>
                            <button
                              onClick={() => {
                                if (isSelected) {
                                  setSelectedSearchResult(null)
                                } else {
                                  setSelectedSearchResult(r)
                                  const inferred = inferTypeFromCategory(r.category)
                                  if (inferred) {
                                    setAddType(inferred)
                                    setAddPaymentTags(new Set())
                                    setAddCategory('')
                                    setAddCorkageEnabled(false); setAddCorkageType('free'); setAddCorkageText('')
                                    setAddCoverCharge('none'); setAddCoverChargeText('')
                                  }
                                }
                              }}
                              className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all ${
                                isSelected
                                  ? 'border-current bg-red-50'
                                  : 'border-gray-100 hover:border-gray-300 hover:bg-gray-50'
                              }`}
                              style={isSelected ? { borderColor: TYPE_COLOR[addType] } : {}}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className={`text-sm font-semibold truncate ${isSelected ? 'text-[#BF3A21]' : 'text-gray-800'}`}>{r.name}</span>
                                {isSelected && (
                                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={TYPE_COLOR[addType]} strokeWidth="2.5" className="shrink-0">
                                    <polyline points="20 6 9 17 4 12"/>
                                  </svg>
                                )}
                              </div>
                              {r.category && (
                                <p className="text-[11px] text-gray-400 mt-0.5 truncate">{r.category}</p>
                              )}
                              <p className="text-xs text-gray-400 mt-0.5 truncate">{r.address}</p>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>

                {/* ② 분류 선택 + 도메인 특화 정보 */}
                {selectedSearchResult && (
                  <div className="px-4 py-4 space-y-4">

                    {/* 분류 선택 (결과 선택 후 표시, 자동 추론으로 pre-fill) */}
                    <div>
                      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">분류</p>
                      <div className="flex gap-2">
                        {ADD_TYPE_OPTIONS.map(({ value, label }) => (
                          <button
                            key={value}
                            onClick={() => {
                              setAddType(value)
                              setAddPaymentTags(new Set())
                              setAddCategory('')
                              setAddCorkageEnabled(false); setAddCorkageType('free'); setAddCorkageText('')
                              setAddCoverCharge('none'); setAddCoverChargeText('')
                            }}
                            className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                              addType === value
                                ? 'text-white border-transparent'
                                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                            }`}
                            style={addType === value ? { backgroundColor: TYPE_COLOR[value] } : {}}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                      {addType === 'whisky' ? '결제 수단' : addType === 'restaurant' ? '식당 정보' : '바 정보'}
                    </p>

                    {/* 리쿼샵: 결제수단 */}
                    {addType === 'whisky' && (
                      <div>
                        <p className="text-caption text-text-disabled mb-2">해당하는 결제 수단을 선택하세요</p>
                        <div className="flex flex-wrap gap-1.5">
                          {DEFAULT_PAYMENT_TAGS.map((tag) => {
                            const active = addPaymentTags.has(tag)
                            return (
                              <button
                                key={tag}
                                onClick={() => setAddPaymentTags((prev) => {
                                  const next = new Set(prev)
                                  active ? next.delete(tag) : next.add(tag)
                                  return next
                                })}
                                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                                  active ? 'text-white border-transparent' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                                }`}
                                style={active ? { backgroundColor: TYPE_COLOR.whisky } : {}}
                              >
                                {tag}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* 식당: 대분류 + 콜키지 */}
                    {addType === 'restaurant' && (
                      <>
                        <div>
                          <p className="text-xs font-semibold text-gray-500 mb-2">대분류 <span className="text-red-400">*</span></p>
                          <div className="flex gap-1.5 flex-wrap">
                            {FOOD_CATEGORIES.map((cat) => (
                              <button
                                key={cat}
                                onClick={() => setAddCategory(cat)}
                                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                                  addCategory === cat ? 'text-white border-transparent' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                                }`}
                                style={addCategory === cat ? { backgroundColor: TYPE_COLOR.restaurant } : {}}
                              >
                                {cat}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-gray-500 mb-2">콜키지</p>
                          <button
                            onClick={() => setAddCorkageEnabled((v) => !v)}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all mb-2 ${
                              addCorkageEnabled ? 'text-white border-transparent' : 'bg-white text-gray-400 border-gray-200'
                            }`}
                            style={addCorkageEnabled ? { backgroundColor: TYPE_COLOR.restaurant } : {}}
                          >
                            <span className={`w-7 h-4 rounded-full relative transition-colors ${addCorkageEnabled ? 'bg-white/30' : 'bg-gray-200'}`}>
                              <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${addCorkageEnabled ? 'left-3.5' : 'left-0.5'}`} />
                            </span>
                            {addCorkageEnabled ? '콜키지 가능' : '콜키지 불가'}
                          </button>
                          {addCorkageEnabled && (
                            <div className="space-y-2">
                              <div className="flex gap-2">
                                {(['free', 'paid'] as const).map((v) => (
                                  <button
                                    key={v}
                                    onClick={() => setAddCorkageType(v)}
                                    className={`flex-1 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                                      addCorkageType === v ? 'text-white border-transparent' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                                    }`}
                                    style={addCorkageType === v ? { backgroundColor: TYPE_COLOR.restaurant } : {}}
                                  >
                                    {v === 'free' ? '콜키지 프리' : '유료'}
                                  </button>
                                ))}
                              </div>
                              {addCorkageType === 'paid' && (
                                <input
                                  type="text"
                                  value={addCorkageText}
                                  onChange={(e) => setAddCorkageText(e.target.value)}
                                  placeholder="예: 병당 2만원"
                                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-orange-300"
                                />
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    {/* 바: 커버차지 */}
                    {addType === 'bar' && (
                      <div>
                        <p className="text-xs font-semibold text-gray-500 mb-2">커버차지</p>
                        <div className="flex gap-2 mb-2">
                          {(['none', 'exists'] as const).map((v) => (
                            <button
                              key={v}
                              onClick={() => setAddCoverCharge(v)}
                              className={`flex-1 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                                addCoverCharge === v ? 'text-white border-transparent' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                              }`}
                              style={addCoverCharge === v ? { backgroundColor: TYPE_COLOR.bar } : {}}
                            >
                              {v === 'none' ? '없음' : '있음'}
                            </button>
                          ))}
                        </div>
                        {addCoverCharge === 'exists' && (
                          <input
                            type="text"
                            value={addCoverChargeText}
                            onChange={(e) => setAddCoverChargeText(e.target.value)}
                            placeholder="예: 10,000원"
                            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-gray-400"
                          />
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ③ 코멘트 */}
                {selectedSearchResult && (
                  <div className="px-4 py-4 space-y-3">
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">한 줄 평</p>
                    <textarea
                      value={addComment}
                      onChange={(e) => { setAddComment(e.target.value); if (e.target.value.trim() === '' || myCode) setAddCommentPasswordError(false) }}
                      placeholder="이 장소에 대한 첫 코멘트를 남겨보세요 (선택, 200자 이내)"
                      maxLength={200}
                      rows={3}
                      className={`w-full text-sm border rounded-xl px-3 py-2 outline-none resize-none transition-colors placeholder:text-gray-300 ${addCommentPasswordError ? 'border-red-400 focus:border-red-500' : 'border-gray-200 focus:border-gray-400'}`}
                    />
                    {addCommentPasswordError && (
                      <p className="text-xs text-red-500 -mt-1.5">우측 상단 프로필에서 비밀번호를 먼저 설정해 주세요.</p>
                    )}
                  </div>
                )}

                {/* ④ 등록 버튼 */}
                {selectedSearchResult && (
                  <div className="px-4 py-4">
                    <button
                      onClick={() => handleAddPlace(selectedSearchResult)}
                      disabled={!!isAdding}
                      className="btn-primary w-full py-3 disabled:opacity-50 active:scale-[0.98]"
                      style={{ backgroundColor: TYPE_COLOR[addType] }}
                    >
                      {isAdding ? '등록 중...' : `"${selectedSearchResult.name}" 등록`}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* 목록 탭 */}
          {view === 'list' && !showAddPanel && mainTab === 'list' && (
            <>
              {/* 장소 수 + 뷰모드 탭 */}
              <div className="px-4 pt-2.5 pb-0 flex-shrink-0 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400">
                    {loading ? '불러오는 중...' : `${filteredPlaces.length}개 장소${filteredPlaces.length !== places.length ? ` / 전체 ${places.length}` : ''}`}
                  </p>
                  {userLocation && (
                    <span className="text-[10px] text-emerald-500 font-medium flex items-center gap-0.5">
                      <svg xmlns="http://www.w3.org/2000/svg" width="7" height="7" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>
                      내 위치 기준
                    </span>
                  )}
                </div>
                {/* 뷰모드 탭 */}
                <div className="flex gap-1 bg-surface-tertiary rounded-xl p-1">
                  {([
                    { key: 'category', label: '종류별' },
                    { key: 'distance', label: '거리순' },
                    { key: 'region',   label: '지역별' },
                  ] as const).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => {
                        if (key === 'distance' && !userLocation) {
                          requestUserLocation()
                        }
                        setViewMode(key)
                      }}
                      className={`flex-1 py-1.5 rounded-lg text-label font-semibold transition-all ${
                        viewMode === key
                          ? 'bg-surface-base text-text-primary shadow-sm'
                          : 'text-text-disabled hover:text-text-tertiary'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/* 종류별 서브 정렬 옵션 */}
                {viewMode === 'category' && (
                  <div className="flex items-center justify-end gap-1 pt-1">
                    {(['name', 'distance'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          if (s === 'distance' && !userLocation) requestUserLocation()
                          setCategorySort(s)
                        }}
                        className={`text-caption font-semibold px-2 py-0.5 rounded-full transition-all ${
                          categorySort === s
                            ? 'bg-text-primary text-white'
                            : 'text-text-disabled hover:text-text-tertiary'
                        }`}
                      >
                        {s === 'name' ? '가나다순' : '거리순'}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div ref={listScrollRef} className="flex-1 overflow-y-auto mt-1">
                {loading ? (
                  <p className="px-5 py-6 text-center text-sm text-gray-400">로딩 중...</p>
                ) : filteredPlaces.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 pb-12 px-6">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <p className="text-sm text-center">조건에 맞는 장소가 없어요.</p>
                    <p className="text-xs text-gray-300 text-center">직접 추가해볼까요?</p>
                    <button
                      onClick={() => setShowAddPanel(true)}
                      className="mt-1 px-5 py-2 rounded-xl text-xs font-bold text-white transition-opacity hover:opacity-80"
                      style={{ backgroundColor: MARKER_COLOR }}
                    >
                      장소 추가
                    </button>
                  </div>
                ) : (() => {
                  // ── 공통 아이템 렌더러 ──────────────────────────────────
                  const renderItem = (place: typeof distanceSortedPlaces[0]) => {
                    const dist        = userLocation ? haversine(userLocation.lat, userLocation.lng, place.lat, place.lng) : null
                    const accentColor = TYPE_COLOR[place.type] ?? MARKER_COLOR
                    const isActive    = activeId === place.id
                    const policyBadges: string[] = []
                    place.tags?.forEach((t) => {
                      if (t.type === 'corkage' && t.label !== '불가') policyBadges.push('콜키지')
                    })
                    return (
                      <li key={place.id}>
                        <button
                          onClick={() => openDetail(place.id)}
                          className={`w-full text-left px-5 py-3 transition-colors hover:bg-gray-50 ${isActive ? 'border-l-2' : ''}`}
                          style={isActive ? { backgroundColor: `${accentColor}10`, borderColor: accentColor } : {}}
                        >
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-semibold" style={{ color: isActive ? accentColor : '#1f2937' }}>
                              {place.name}
                            </span>
                            {viewMode !== 'category' && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                                style={{ color: accentColor, backgroundColor: `${accentColor}18` }}>
                                {TYPE_LABEL[place.type] ?? place.type}
                              </span>
                            )}
                            {policyBadges.map((b) => (
                              <span key={b} className="text-[10px] bg-gray-100 text-gray-500 rounded-full px-1.5 py-0.5">{b}</span>
                            ))}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {dist !== null && (
                              <span className="text-[10px] font-medium text-emerald-500 shrink-0">{formatDist(dist)}</span>
                            )}
                            <span className="text-xs text-gray-400 truncate">{place.address}</span>
                          </div>
                        </button>
                      </li>
                    )
                  }

                  // ── 1-Depth 아코디언 렌더러 ──────────────────────────────
                  const renderAccordion = (
                    entries: [string, typeof distanceSortedPlaces][],
                    labelFn?: (k: string) => string
                  ) => entries.map(([key, items]) => {
                    const isOpen      = accordionOpen[key] !== false
                    const headerLabel = labelFn ? labelFn(key) : key
                    const totalCount  = items.length
                    return (
                      <div key={key}>
                        <button
                          onClick={() => setAccordionOpen((prev) => ({ ...prev, [key]: !isOpen }))}
                          className="w-full flex items-center justify-between px-5 pt-4 pb-2 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-gray-700">{headerLabel}</span>
                            <span className="text-[10px] text-gray-400">{totalCount}곳</span>
                          </div>
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                            fill="none" stroke="currentColor" strokeWidth="2.5"
                            className={`text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                        </button>
                        {isOpen && <ul className="divide-y divide-gray-50">{items.map(renderItem)}</ul>}
                      </div>
                    )
                  })

                  // ── 2-Depth 지역 아코디언 렌더러 ─────────────────────────
                  const renderRegionAccordion = () => {
                    const sortedEntries = Array.from(groupedByRegion.entries()).sort(([a], [b]) => {
                      const aIdx = REGION_ORDER.findIndex((r) => a === r || a.startsWith(r))
                      const bIdx = REGION_ORDER.findIndex((r) => b === r || b.startsWith(r))
                      return (aIdx === -1 ? REGION_ORDER.length : aIdx) - (bIdx === -1 ? REGION_ORDER.length : bIdx)
                    })
                    return sortedEntries.map(([city, guMap]) => {
                      const cityKey    = `city__${city}`
                      const cityOpen   = accordionOpen[cityKey] !== false
                      const totalCount = Array.from(guMap.values()).reduce((s, arr) => s + arr.length, 0)
                      return (
                        <div key={city}>
                          {/* Depth 1: 시/도 헤더 */}
                          <button
                            onClick={() => setAccordionOpen((prev) => ({ ...prev, [cityKey]: !cityOpen }))}
                            className="w-full flex items-center justify-between px-5 pt-4 pb-2 hover:bg-gray-50 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-gray-800">{city}</span>
                              <span className="text-[10px] text-gray-400">{totalCount}곳</span>
                            </div>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                              fill="none" stroke="currentColor" strokeWidth="2.5"
                              className={`text-gray-400 transition-transform duration-200 ${cityOpen ? 'rotate-180' : ''}`}>
                              <polyline points="6 9 12 15 18 9"/>
                            </svg>
                          </button>

                          {/* Depth 2: 구/군 서브 아코디언 */}
                          {cityOpen && Array.from(guMap.entries()).map(([gu, items]) => {
                            const guKey  = `gu__${city}__${gu}`
                            const guOpen = accordionOpen[guKey] !== false
                            return (
                              <div key={gu} className="border-l-2 border-gray-100 ml-5">
                                <button
                                  onClick={() => setAccordionOpen((prev) => ({ ...prev, [guKey]: !guOpen }))}
                                  className="w-full flex items-center justify-between pl-3 pr-5 pt-2 pb-1.5 hover:bg-gray-50 transition-colors"
                                >
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] font-semibold text-gray-600">{gu}</span>
                                    <span className="text-[10px] text-gray-400">{items.length}곳</span>
                                  </div>
                                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
                                    fill="none" stroke="currentColor" strokeWidth="2.5"
                                    className={`text-gray-300 transition-transform duration-200 ${guOpen ? 'rotate-180' : ''}`}>
                                    <polyline points="6 9 12 15 18 9"/>
                                  </svg>
                                </button>
                                {guOpen && <ul className="divide-y divide-gray-50">{items.map(renderItem)}</ul>}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })
                  }

                  return (
                    <>
                      {/* ── 종류별 아코디언 ── */}
                      {viewMode === 'category' && renderAccordion(
                        Array.from(groupedByCategory.entries()),
                        (k) => TYPE_LABEL[k] ?? k
                      )}
                      {/* ── 거리순: 단순 일렬 나열 ── */}
                      {viewMode === 'distance' && (
                        <ul className="divide-y divide-gray-50">
                          {distanceSortedPlaces.map(renderItem)}
                        </ul>
                      )}
                      {/* ── 지역별 2-Depth 아코디언 ── */}
                      {viewMode === 'region' && renderRegionAccordion()}
                      <div className="h-4" />
                    </>
                  )
                })()}
              </div>
              {/* ─── + 장소 추가 버튼 (하단 고정) ─── */}
              <div className="flex-shrink-0 px-4 py-3 border-t border-gray-100">
                <button
                  onClick={() => setShowAddPanel(true)}
                  className="btn-primary w-full py-4 text-body-md shadow-md hover:shadow-lg active:scale-[0.98]"
                  style={{ backgroundColor: MARKER_COLOR }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  장소 추가
                </button>
              </div>
            </>
          )}

          {/* 즐겨찾기 탭 */}
          {view === 'list' && !showAddPanel && mainTab === 'favorites' && (
            <div className="flex-1 overflow-y-auto flex flex-col">
              {favoritedIds.size === 0 ? (
                <div className="flex flex-col items-center justify-center flex-1 gap-2 text-gray-400 pb-10">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                  <p className="text-sm">즐겨찾기한 장소가 없습니다</p>
                  <p className="text-xs text-gray-300">장소 상세에서 ★ 눌러보세요</p>
                </div>
              ) : (() => {
                // 전체 즐겨찾기 통합 목록
                const allFavPlaces = [...favWhiskyPlaces, ...favBarPlaces, ...favRestPlaces]

                // 정렬
                const sortedFavPlaces = [...allFavPlaces].sort((a, b) => {
                  if (favoriteSort === 'name') return a.name.localeCompare(b.name, 'ko')
                  if (favoriteSort === 'distance' && userLocation) {
                    return haversine(userLocation.lat, userLocation.lng, a.lat, a.lng)
                         - haversine(userLocation.lat, userLocation.lng, b.lat, b.lng)
                  }
                  return 0 // 'added': 원 배열 순서 유지
                })

                return (
                  <>
                    {/* 컨트롤 바 */}
                    <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 flex-shrink-0">
                      <select
                        value={favoriteSort}
                        onChange={(e) => setFavoriteSort(e.target.value as typeof favoriteSort)}
                        className="text-xs text-gray-500 bg-transparent border-none outline-none cursor-pointer"
                      >
                        <option value="added">최근 추가순</option>
                        <option value="name">가나다순</option>
                        <option value="distance">가까운 순</option>
                      </select>
                      <button
                        onClick={() => setIsFavoriteEditMode((v) => !v)}
                        className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors ${
                          isFavoriteEditMode
                            ? 'bg-gray-800 text-white'
                            : 'text-gray-400 hover:text-gray-700'
                        }`}
                      >
                        {isFavoriteEditMode ? '완료' : '편집'}
                      </button>
                    </div>

                    {/* 리스트 */}
                    <ul className="divide-y divide-gray-50 overflow-y-auto flex-1">
                      {sortedFavPlaces.map((place) => {
                        const color    = TYPE_COLOR[place.type] ?? MARKER_COLOR
                        const isActive = activeId === place.id
                        const dist     = userLocation
                          ? haversine(userLocation.lat, userLocation.lng, place.lat, place.lng)
                          : null
                        return (
                          <li key={place.id}>
                            <div className={`flex items-stretch transition-colors hover:bg-gray-50 ${isActive ? 'border-l-2' : ''}`}
                              style={isActive ? { borderColor: color, backgroundColor: color + '10' } : {}}>
                              <button
                                disabled={isFavoriteEditMode}
                                onClick={() => { if (!isFavoriteEditMode) openDetail(place.id) }}
                                className="flex-1 text-left px-4 py-3 min-w-0 disabled:cursor-default"
                              >
                                <div className="flex items-center gap-2">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24"
                                    fill={isActive ? color : '#facc15'} stroke="none">
                                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                                  </svg>
                                  <span className="text-sm font-medium truncate" style={isActive ? { color } : { color: '#1f2937' }}>
                                    {place.name}
                                  </span>
                                  <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-auto"
                                    style={{ color, backgroundColor: color + '18' }}>
                                    {TYPE_LABEL[place.type] ?? place.type}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5 ml-[19px]">
                                  {dist !== null && (
                                    <span className="text-[10px] font-medium text-emerald-500 shrink-0">{formatDist(dist)}</span>
                                  )}
                                  {place.district && (
                                    <span className="text-[11px] text-gray-400 truncate">{place.district}</span>
                                  )}
                                </div>
                              </button>
                              {/* 편집 모드: 삭제 버튼 */}
                              {isFavoriteEditMode && (
                                <button
                                  onClick={() => handleFavoriteById(place.id)}
                                  className="flex items-center justify-center px-3 shrink-0 text-red-400 hover:bg-red-50 transition-colors"
                                  aria-label="즐겨찾기 해제"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                                    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6"/>
                                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                                    <path d="M10 11v6M14 11v6"/>
                                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                                  </svg>
                                </button>
                              )}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </>
                )
              })()}
            </div>
          )}

          {/* 상세 뷰 */}
          {view === 'detail' && selectedPlace && (
            <>
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
                  style={{ backgroundColor: TYPE_COLOR[selectedPlace.type] ?? MARKER_COLOR }}
                >
                  {TYPE_LABEL[selectedPlace.type] ?? selectedPlace.type}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                <div className="flex items-start gap-1.5 text-xs text-gray-500">
                  <svg className="shrink-0 mt-0.5" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                  </svg>
                  <span className="leading-snug">{selectedPlace.address}</span>
                </div>
                {/* 액션 버튼 (즐겨찾기 + 지도 보기) */}
                <div className="flex gap-2">
                  <button
                    onClick={handleFavorite}
                    disabled={isFaving}
                    className={`flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-60 flex-1 ${
                      isFavorited ? 'btn-primary' : 'btn-secondary'
                    }`}
                    style={isFavorited ? { backgroundColor: MARKER_COLOR } : {}}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
                      fill={isFavorited ? 'white' : 'none'} stroke={isFavorited ? 'white' : MARKER_COLOR}
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                    <span>즐겨찾기{favCount > 0 && ` (${favCount})`}</span>
                  </button>
                  <a
                    href={mapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary flex items-center justify-center gap-2 active:scale-95 transition-all flex-1"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={MARKER_COLOR} strokeWidth="2">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                    </svg>
                    <span>지도 보기</span>
                  </a>
                </div>

                {/* 카테고리 배지 (식당 전용, 정적 표시) */}
                {!loadingTags && selectedPlace.type === 'restaurant' &&
                  selectedTags.some(t => t.type === 'category') && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedTags.filter(t => t.type === 'category').map(t => (
                      <span key={t.label}
                        className="px-2.5 py-1 rounded-full text-xs font-bold text-white"
                        style={{ backgroundColor: TYPE_COLOR.restaurant }}>
                        {t.label}
                      </span>
                    ))}
                  </div>
                )}

                {/* 콜키지 정책 (식당 전용, 고정 토글) */}
                {selectedPlace.type === 'restaurant' && (
                  <div className="card p-3">
                    <p className="text-label font-semibold text-text-secondary mb-1.5">콜키지</p>
                    <p className="text-caption text-text-disabled mb-2">클릭하여 +1 투표</p>
                    {loadingTags ? (
                      <p className="text-xs text-gray-400">로딩 중...</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {corkageTagsDisplay.map((tag) => {
                          const myVote = votedTags.has(tag.label)
                          return (
                            <button
                              key={tag.label}
                              onClick={() => handleTagVote(tag.label, 'corkage')}
                              className={`tag transition-all active:scale-95 flex items-center gap-1 ${
                                myVote
                                  ? 'tag-active'
                                  : tag.count > 0
                                    ? 'bg-brand-surface border-brand-border text-brand-primary'
                                    : 'hover:bg-brand-surface hover:border-brand-border hover:text-brand-primary'
                              }`}
                            >
                              <span>콜키지 {tag.label}</span>
                              {tag.count > 0 && <span className={myVote ? 'opacity-80' : 'opacity-70'}>+{tag.count}</span>}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* 커버차지 정책 (바 전용, 고정 토글) */}
                {selectedPlace.type === 'bar' && (
                  <div className="card p-3">
                    <p className="text-label font-semibold text-text-secondary mb-1.5">커버차지</p>
                    <p className="text-caption text-text-disabled mb-2">클릭하여 +1 투표</p>
                    {loadingTags ? (
                      <p className="text-xs text-gray-400">로딩 중...</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {coverChargeTagsDisplay.map((tag) => {
                          const myVote = votedTags.has(tag.label)
                          return (
                            <button
                              key={tag.label}
                              onClick={() => handleTagVote(tag.label, 'cover_charge')}
                              className={`tag transition-all active:scale-95 flex items-center gap-1 ${
                                myVote
                                  ? 'tag-active'
                                  : tag.count > 0
                                    ? 'bg-brand-surface border-brand-border text-brand-primary'
                                    : 'hover:bg-brand-surface hover:border-brand-border hover:text-brand-primary'
                              }`}
                            >
                              <span>커버차지 {tag.label}</span>
                              {tag.count > 0 && <span className={myVote ? 'opacity-80' : 'opacity-70'}>+{tag.count}</span>}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* 결제수단 영역 (리쿼샵 전용) */}
                {selectedPlace.type === 'whisky' && (
                  <div className="card p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-bold text-gray-700">결제 수단</p>
                      <button
                        onClick={() => setShowPaymentInput((v) => !v)}
                        className="text-xs font-medium hover:opacity-70 transition-opacity"
                        style={{ color: MARKER_COLOR }}
                      >
                        {showPaymentInput ? '취소' : '+ 추가'}
                      </button>
                    </div>
                    <p className="text-caption text-text-disabled mb-2">클릭하여 결제 가능 수단 등록</p>
                    {showPaymentInput && (
                      <div className="flex gap-2 mb-2.5">
                        <input
                          ref={paymentTagInputRef}
                          type="text"
                          value={newPaymentLabel}
                          onChange={(e) => setNewPaymentLabel(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleAddPaymentTag()}
                          placeholder="예: 지역화폐"
                          maxLength={20}
                          className="flex-1 text-xs border border-gray-200 rounded-full px-3 py-1.5 outline-none transition-colors"
                          onFocus={(e) => e.target.style.borderColor = MARKER_COLOR}
                          onBlur={(e)  => e.target.style.borderColor = '#e5e7eb'}
                        />
                        <button
                          onClick={handleAddPaymentTag}
                          disabled={!newPaymentLabel.trim() || isAddingPaymentTag}
                          className="px-3 py-1.5 rounded-full text-xs font-bold text-white disabled:opacity-40"
                          style={{ backgroundColor: MARKER_COLOR }}
                        >
                          추가
                        </button>
                      </div>
                    )}
                    {loadingTags ? (
                      <p className="text-xs text-gray-400">로딩 중...</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {paymentTagsDisplay.map((tag) => {
                          const myVote = votedTags.has(tag.label)
                          return (
                            <button
                              key={tag.label}
                              onClick={() => handleTagVote(tag.label, 'payment')}
                              className={`tag transition-all active:scale-95 flex items-center gap-1 ${
                                myVote
                                  ? 'tag-active'
                                  : tag.count > 0
                                    ? 'bg-brand-surface border-brand-border text-brand-primary'
                                    : 'hover:bg-brand-surface hover:border-brand-border hover:text-brand-primary'
                              }`}
                            >
                              <span>{tag.label}</span>
                              {tag.count > 0 && <span className={myVote ? 'opacity-80' : 'opacity-70'}>+{tag.count}</span>}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* 일반 태그 영역 (공통) */}
                <div className="card p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-bold text-gray-700">태그</p>
                    <button
                      onClick={() => setShowGeneralInput((v) => !v)}
                      className="text-xs font-medium hover:opacity-70 transition-opacity"
                      style={{ color: MARKER_COLOR }}
                    >
                      {showGeneralInput ? '취소' : '+ 추가'}
                    </button>
                  </div>
                  <p className="text-caption text-text-disabled mb-2">클릭하여 +1 투표</p>
                  {showGeneralInput && (
                    <div className="flex gap-2 mb-2.5">
                      <input
                        ref={generalTagInputRef}
                        type="text"
                        value={newGeneralLabel}
                        onChange={(e) => setNewGeneralLabel(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddGeneralTag()}
                        placeholder="태그 입력"
                        maxLength={20}
                        className="flex-1 text-xs border border-gray-200 rounded-full px-3 py-1.5 outline-none transition-colors"
                        onFocus={(e) => e.target.style.borderColor = MARKER_COLOR}
                        onBlur={(e)  => e.target.style.borderColor = '#e5e7eb'}
                      />
                      <button
                        onClick={handleAddGeneralTag}
                        disabled={!newGeneralLabel.trim() || isAddingGeneralTag}
                        className="px-3 py-1.5 rounded-full text-xs font-bold text-white disabled:opacity-40"
                        style={{ backgroundColor: MARKER_COLOR }}
                      >
                        추가
                      </button>
                    </div>
                  )}
                  {loadingTags ? (
                    <p className="text-xs text-gray-400">로딩 중...</p>
                  ) : generalTagsDisplay.length === 0 ? (
                    <p className="text-xs text-gray-400">아직 태그가 없습니다.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {generalTagsDisplay.map((tag) => {
                        const myVote = votedTags.has(tag.label)
                        return (
                          <button
                            key={tag.label}
                            onClick={() => handleTagVote(tag.label, 'general')}
                            className={`tag transition-all active:scale-95 flex items-center gap-1 ${
                              myVote
                                ? 'bg-[#BF3A21] border-[#BF3A21] text-white'
                                : tag.count > 0
                                  ? 'bg-red-50 border-[#BF3A21] text-[#BF3A21]'
                                  : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-[#BF3A21] hover:text-[#BF3A21] hover:bg-red-50'
                            }`}
                          >
                            <span>{tag.label}</span>
                            {tag.count > 0 && <span className={myVote ? 'opacity-80' : 'opacity-70'}>+{tag.count}</span>}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* 사진 */}
                <div className="card p-3">
                  <p className="text-xs font-bold text-gray-700 mb-2.5">사진</p>
                  {photoPasswordError && (
                    <p className="text-xs text-red-500 mb-1.5">비밀번호를 입력해 주세요.</p>
                  )}
                  <input
                    type="file"
                    id="panel-photo-upload"
                    accept="image/*"
                    className="hidden"
                    onChange={handlePhotoUpload}
                    disabled={isUploading}
                  />
                  <label
                    htmlFor="panel-photo-upload"
                    className={`w-full h-16 border-2 border-dashed rounded-xl flex items-center justify-center gap-2 transition-colors group cursor-pointer ${
                      isUploading
                        ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                        : photoPasswordError
                          ? 'border-red-300 text-red-400'
                          : 'border-gray-200 text-gray-400 hover:border-[#BF3A21] hover:text-[#BF3A21]'
                    }`}
                  >
                    {isUploading ? (
                      <span className="text-xs font-medium">업로드 중...</span>
                    ) : (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                          <circle cx="8.5" cy="8.5" r="1.5"/>
                          <polyline points="21 15 16 10 5 21"/>
                        </svg>
                        <span className="text-xs font-medium">사진 추가</span>
                      </>
                    )}
                  </label>
                  {photos.length > 0 && (
                    <div className="mt-2.5 grid grid-cols-3 gap-1">
                      {photos.map((photo) => (
                        <div key={photo.id} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 group">
                          <img
                            src={photo.url}
                            alt={`${photo.nickname}님의 사진`}
                            className="w-full h-full object-cover cursor-zoom-in"
                            onClick={() => { if (!deletingPhotoId) setSelectedPhoto(photo.url) }}
                          />
                          <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-gradient-to-t from-black/50 to-transparent flex items-end justify-between">
                            <p className="text-[9px] text-white truncate">{photo.nickname}</p>
                          </div>
                          {/* 삭제 버튼 (hover 시 노출) */}
                          {deletingPhotoId !== photo.id && (
                            <button
                              onClick={() => handleDeletePhoto(photo.id)}
                              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              title="삭제"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                              </svg>
                            </button>
                          )}
                          {/* 인라인 삭제 폼 */}
                          {deletingPhotoId === photo.id && (
                            <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-1.5 p-2">
                              <input
                                type="password"
                                value={deleteInputCode}
                                onChange={(e) => setDeleteInputCode(e.target.value.slice(0, 20))}
                                onKeyDown={(e) => e.key === 'Enter' && handleConfirmDeletePhoto()}
                                placeholder="비밀번호"
                                maxLength={20}
                                autoFocus
                                className="w-full text-[10px] rounded-lg px-2 py-1 outline-none bg-white/90 text-gray-800 placeholder:text-gray-400"
                              />
                              <div className="flex gap-1 w-full">
                                <button
                                  onClick={handleConfirmDeletePhoto}
                                  className="flex-1 py-1 rounded-lg text-[10px] font-bold text-white bg-red-500 hover:bg-red-600 transition-colors"
                                >
                                  삭제
                                </button>
                                <button
                                  onClick={() => { setDeletingPhotoId(null); setDeleteInputCode('') }}
                                  className="flex-1 py-1 rounded-lg text-[10px] font-bold text-gray-700 bg-white/80 hover:bg-white transition-colors"
                                >
                                  취소
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ─── 코멘트 섹션 ──────────────────────────────────────── */}
                <div className="card p-3">
                  <p className="text-xs font-bold text-gray-700 mb-2.5">한 줄 평</p>

                  {/* 코멘트 작성 폼 */}
                  <div className="mb-3 space-y-2">
                    <textarea
                      value={newPanelComment}
                      onChange={(e) => setNewPanelComment(e.target.value)}
                      placeholder="이 장소에 대한 한 줄 평을 남겨보세요 (200자 이내)"
                      maxLength={200}
                      rows={2}
                      className="w-full text-xs border border-gray-200 rounded-xl px-3 py-2 outline-none resize-none transition-colors placeholder:text-gray-300 focus:border-gray-400"
                    />
                    {commentPasswordError && (
                      <p className="text-xs text-red-500">비밀번호를 입력해 주세요.</p>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-300">{newPanelComment.length}/200</span>
                      <button
                        onClick={handleSubmitPanelComment}
                        disabled={!newPanelComment.trim() || isSubmittingComment}
                        className="px-3 py-1.5 rounded-full text-xs font-bold text-white disabled:opacity-40 transition-opacity"
                        style={{ backgroundColor: MARKER_COLOR }}
                      >
                        {isSubmittingComment ? '등록 중...' : '등록'}
                      </button>
                    </div>
                  </div>

                  {/* 코멘트 정렬 + 목록 */}
                  {loadingTags ? (
                    <p className="text-xs text-gray-400">로딩 중...</p>
                  ) : comments.length === 0 ? (
                    <p className="text-xs text-gray-400">아직 코멘트가 없습니다.</p>
                  ) : (
                    <>
                      {/* 정렬 드롭다운 */}
                      <div className="flex justify-end mb-2">
                        <select
                          value={commentSort}
                          onChange={(e) => setCommentSort(e.target.value as 'latest' | 'oldest' | 'likes')}
                          className="text-[10px] text-gray-400 border border-gray-200 rounded-lg px-2 py-1 outline-none bg-white cursor-pointer hover:border-gray-300 transition-colors"
                        >
                          <option value="latest">최신순</option>
                          <option value="oldest">오래된순</option>
                          <option value="likes">공감순</option>
                        </select>
                      </div>
                      <ul className="space-y-2">
                        {sortedComments.map((c) => (
                          <li
                            key={c.id}
                            className={`transition-opacity ${c.id.startsWith('__opt__') ? 'opacity-50' : ''}`}
                          >
                            {/* 본문 행 */}
                            <div className="flex items-start gap-1.5">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-1.5">
                                  <span className="text-xs font-semibold text-gray-700">{c.nickname}</span>
                                  <span className="text-[10px] text-gray-300">
                                    {new Date(c.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                                  </span>
                                </div>
                                <p className="text-xs text-gray-600 mt-0.5 leading-snug">{c.content}</p>
                              </div>
                              {/* 삭제 버튼 (optimistic 항목 제외) */}
                              {!c.id.startsWith('__opt__') && deletingCommentId !== c.id && (
                                <button
                                  onClick={() => handleDeleteComment(c.id)}
                                  className="shrink-0 self-start mt-0.5 p-1 rounded text-gray-300 hover:text-red-400 transition-colors"
                                  title="삭제"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                                  </svg>
                                </button>
                              )}
                            </div>
                            {/* 찬반 투표 행 (optimistic 항목 제외) */}
                            {!c.id.startsWith('__opt__') && deletingCommentId !== c.id && (
                              <div className="flex items-center gap-2 mt-1 ml-0.5">
                                {/* 좋아요 */}
                                {(() => {
                                  const myVote   = votedComments[c.id]
                                  const isLiked  = myVote === 'like'
                                  const voted    = !!myVote
                                  return (
                                    <button
                                      onClick={() => handleVoteComment(c.id, 'like')}
                                      disabled={voted}
                                      className={`flex items-center gap-1 text-[10px] transition-colors ${
                                        isLiked
                                          ? 'text-blue-500 font-semibold cursor-default'
                                          : voted
                                            ? 'text-gray-300 cursor-default'
                                            : 'text-gray-400 hover:text-blue-500'
                                      }`}
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24"
                                        fill={isLiked ? 'currentColor' : 'none'}
                                        stroke="currentColor" strokeWidth="2">
                                        <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/>
                                        <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
                                      </svg>
                                      <span>{c.likes > 0 ? c.likes : ''}</span>
                                    </button>
                                  )
                                })()}
                                {/* 싫어요 */}
                                {(() => {
                                  const myVote      = votedComments[c.id]
                                  const isDisliked  = myVote === 'dislike'
                                  const voted       = !!myVote
                                  return (
                                    <button
                                      onClick={() => handleVoteComment(c.id, 'dislike')}
                                      disabled={voted}
                                      className={`flex items-center gap-1 text-[10px] transition-colors ${
                                        isDisliked
                                          ? 'text-red-400 font-semibold cursor-default'
                                          : voted
                                            ? 'text-gray-300 cursor-default'
                                            : 'text-gray-400 hover:text-red-400'
                                      }`}
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24"
                                        fill={isDisliked ? 'currentColor' : 'none'}
                                        stroke="currentColor" strokeWidth="2">
                                        <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/>
                                        <path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>
                                      </svg>
                                      <span>{c.dislikes > 0 ? c.dislikes : ''}</span>
                                    </button>
                                  )
                                })()}
                              </div>
                            )}
                            {/* 인라인 삭제 폼 */}
                            {deletingCommentId === c.id && (
                              <div className="mt-1.5 flex gap-1.5 items-center bg-gray-50 rounded-xl px-2.5 py-2 border border-gray-200">
                                <input
                                  type="password"
                                  value={deleteInputCode}
                                  onChange={(e) => setDeleteInputCode(e.target.value.slice(0, 20))}
                                  onKeyDown={(e) => e.key === 'Enter' && handleConfirmDeleteComment()}
                                  placeholder="비밀번호"
                                  maxLength={20}
                                  autoFocus
                                  className="flex-1 text-xs bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-red-300 placeholder:text-gray-300"
                                />
                                <button
                                  onClick={handleConfirmDeleteComment}
                                  className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-white bg-red-500 hover:bg-red-600 transition-colors shrink-0"
                                >
                                  삭제
                                </button>
                                <button
                                  onClick={() => { setDeletingCommentId(null); setDeleteInputCode('') }}
                                  className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-gray-500 bg-white border border-gray-200 hover:bg-gray-100 transition-colors shrink-0"
                                >
                                  취소
                                </button>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>

                {/* ─── 면책 조항 ────────────────────────────────────────── */}
                <p className="text-[10px] text-gray-400 leading-relaxed pb-2">
                  자세한 사항은 네이버 지도 또는 연락을 통해 직접 확인하시길 바랍니다. 본 지도는 위치 정보만 제공하며, 이로 인한 손해를 책임지지 않습니다.
                </p>
              </div>
            </>
          )}

        </div>
      </div>

      {/* ── 사진 라이트박스 모달 ───────────────────────────────────────── */}
      {selectedPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setSelectedPhoto(null)}
        >
          {/* 닫기 버튼 */}
          <button
            onClick={() => setSelectedPhoto(null)}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          {/* 사진 (배경 클릭 전파 차단 없음 → 이미지 클릭도 닫힘) */}
          <img
            src={selectedPhoto}
            alt="사진 확대"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* ── 우측 상단 통합 컨트롤 패널 ─────────────────────────────────── */}
      <div className="absolute top-4 right-4 z-30 flex flex-col items-end gap-2 w-[268px]">

        {/* 프로필 카드 */}
        <div className={`panel w-full rounded-2xl overflow-hidden transition-shadow duration-300 ${(commentPasswordError || photoPasswordError || addCommentPasswordError) ? 'ring-2 ring-red-500' : ''}`}
             style={{ boxShadow: (commentPasswordError || photoPasswordError || addCommentPasswordError) ? '0 0 0 3px rgba(239,68,68,0.25), 0 4px 24px rgba(0,0,0,0.13)' : '0 4px 24px rgba(0,0,0,0.13), 0 1px 4px rgba(0,0,0,0.08)' }}>
          <button
            onClick={() => setShowProfileCard((v) => !v)}
            className="flex items-center gap-2.5 px-3.5 py-2.5 w-full hover:bg-gray-50 transition-colors"
          >
            {/* 아바타 */}
            <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-white text-[11px] font-bold"
                 style={{ backgroundColor: myNickname ? MARKER_COLOR : '#d1d5db' }}>
              {myNickname ? myNickname[0].toUpperCase() : (
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                </svg>
              )}
            </div>
            <div className="flex-1 text-left min-w-0">
              <p className="text-xs font-bold text-gray-800 truncate leading-tight">
                {myNickname || <span className="text-gray-400 font-normal">닉네임 설정 안 됨</span>}
              </p>
              <p className="text-[10px] text-gray-400 leading-tight mt-0.5">
                {myCode ? '🔒 비밀번호 설정됨' : '⚠︎ 비밀번호 미설정'}
              </p>
            </div>
            <svg className={`shrink-0 transition-transform duration-200 ${showProfileCard ? 'rotate-180' : ''}`}
                 xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
                 fill="none" stroke="#9ca3af" strokeWidth="2.5">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>

          {showProfileCard && (
            <div className="px-3.5 pb-3.5 space-y-2 border-t border-gray-100 pt-2.5">
              {/* 닉네임 */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 w-14 shrink-0">닉네임</span>
                <input
                  type="text"
                  value={myNickname ?? ''}
                  onChange={(e) => { setMyNickname(e.target.value); localStorage.setItem('tastamp_nickname', e.target.value) }}
                  placeholder="익명"
                  maxLength={20}
                  className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none transition-colors focus:border-gray-400"
                />
              </div>
              {/* 비밀번호 */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 w-14 shrink-0">비밀번호</span>
                <div className="flex-1 relative min-w-0">
                  <input
                    type={showPasswordText ? 'text' : 'password'}
                    value={myCode}
                    onChange={(e) => { const v = e.target.value.slice(0, 20); setMyCode(v); localStorage.setItem('tastamp_code', v); if (v) { setCommentPasswordError(false); setPhotoPasswordError(false); setAddCommentPasswordError(false) } }}
                    placeholder="콘텐츠 삭제 시 사용"
                    maxLength={20}
                    className={`w-full text-xs border rounded-lg px-2.5 py-1.5 pr-7 outline-none transition-colors ${(commentPasswordError || photoPasswordError || addCommentPasswordError) ? 'border-red-500 focus:border-red-500' : 'border-gray-200 focus:border-gray-400'}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswordText((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showPasswordText ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              <p className="text-[9px] text-gray-300 leading-relaxed">등록한 콘텐츠 삭제 시 이 비밀번호로 인증합니다.</p>
            </div>
          )}
        </div>

        {/* 필터 카드 */}
        <div className="panel w-full rounded-2xl overflow-hidden">
          <button
            onClick={() => setShowFilterCard((v) => !v)}
            className="flex items-center gap-2.5 px-3.5 py-2.5 w-full hover:bg-gray-50 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.5">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
            </svg>
            <span className="text-xs font-bold text-gray-700">필터</span>
            {(filterState.type !== 'all' || filterState.corkage || filterState.categories.length > 0 || !!filterState.query) && (
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: MARKER_COLOR }} />
            )}
            <svg className={`ml-auto shrink-0 transition-transform duration-200 ${showFilterCard ? 'rotate-180' : ''}`}
                 xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
                 fill="none" stroke="#9ca3af" strokeWidth="2.5">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>

          {showFilterCard && (
            <div className="border-t border-gray-100">
              <SearchFilter onChange={setFilterState} />
            </div>
          )}
        </div>
        {/* /내부 컨텐츠 div */}
      </div>
      {/* /플로팅 패널 외부 래퍼 */}

      {/* ── GPS 플로팅 액션 버튼 ────────────────────────────────────────── */}
      <button
        onClick={() => {
          requestUserLocation((loc) => {
            naverMapRef.current?.panTo(new window.naver.maps.LatLng(loc.lat, loc.lng))
          })
        }}
        className="absolute bottom-20 right-4 md:bottom-6 md:right-6 z-20 bg-white p-3 rounded-full shadow-lg hover:bg-gray-50 active:scale-95 transition-all"
        title="내 위치로 이동"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
          fill="none" stroke={userLocation ? '#10b981' : '#6b7280'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
          <path d="M12 7a5 5 0 1 0 0 10A5 5 0 0 0 12 7z" strokeDasharray="2 0"/>
        </svg>
      </button>

      {/* ── 패널 토글 버튼 (데스크탑 전용) ────────────────────────────── */}
      <button
        onClick={() => setPanelOpen((v) => !v)}
        className="hidden md:flex items-center justify-center absolute top-1/2 -translate-y-1/2 z-30 bg-white shadow-md rounded-r-xl rounded-l-none p-3 min-h-[44px] min-w-[28px] hover:bg-gray-50 transition-[left] duration-300 ease-in-out"
        style={{ left: panelOpen ? 'calc(1rem + 360px)' : '0' }}
        aria-label={panelOpen ? '패널 닫기' : '패널 열기'}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          {panelOpen ? <path d="M15 18l-6-6 6-6"/> : <path d="M9 18l6-6-6-6"/>}
        </svg>
      </button>

    </div>
  )
}
