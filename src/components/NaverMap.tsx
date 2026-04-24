'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import Script from 'next/script'
import SearchFilter, { FilterState, INITIAL_FILTER } from './SearchFilter'
import { createClient } from '@/src/lib/supabase-browser'
import type { User } from '@supabase/supabase-js'

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
  // 신규 컬럼
  corkage_type:  'impossible' | 'free' | 'paid' | null
  corkage_fee:   number | null
  cover_charge:  number | null
}

interface Tag {
  id: string
  label: string
  count: number
  type: 'payment' | 'general' | 'category'
}

const FOOD_CATEGORIES = ['한식', '일식', '중식', '양식', '아시안', '기타'] as const

interface PlacePhoto {
  id: string
  url: string
  nickname: string
  created_at: string
  user_id?: string
}

interface Comment {
  id: string
  nickname: string
  content: string
  created_at: string
  likes: number
  dislikes: number
  user_id?: string
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

interface ActivityItem {
  id: string
  type: 'comment' | 'photo'
  content?: string
  url?: string
  created_at: string
  place_id: string
  place_name: string
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

type SheetState = 'closed' | 'peek' | 'expanded'
const REGION_ORDER          = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주']
const DBLCLICK_ZOOM        = 16
const LIST_CLICK_ZOOM      = 15   // 리스트 클릭 시 최소 줌 레벨

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

function markerIcon(color = '#BF3A21', opacity = 1, favorited = false, selected = false) {
  const starBadge = favorited ? `
    <div style="position:absolute;top:-4px;right:-4px;width:14px;height:14px;
      background:white;border-radius:50%;display:flex;align-items:center;
      justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.25);">
      <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24"
        fill="#facc15" stroke="#facc15" stroke-width="1">
        <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
      </svg>
    </div>` : ''
  const scaleStyle = selected
    ? 'transform:scale(1.3);transform-origin:center bottom;'
    : ''
  return `
    <div style="cursor:pointer;opacity:${opacity};transition:opacity 0.2s,transform 0.2s;
      position:relative;width:28px;height:36px;${scaleStyle}">
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
  const openDetailRef        = useRef<(id: string, targetZoom?: number) => void>(() => {})
  const setupMarkersRef      = useRef<(map: any, data: Place[]) => void>(() => {})
  const panelWrapperRef          = useRef<HTMLDivElement>(null)
  const touchStartY              = useRef(0)
  const sheetStateAtStart        = useRef<SheetState>('expanded')
  const sheetStateRef            = useRef<SheetState>('expanded')
  const isScrollSwipe            = useRef(false)
  // stable function ref — avoids stale closure in native event listeners
  const applyMobileTransformRef  = useRef((state: SheetState, animate = true) => {
    const wrapper = panelWrapperRef.current
    if (!wrapper || typeof window === 'undefined' || window.innerWidth >= 768) return
    wrapper.style.transition = animate ? '' : 'none'
    const map: Record<SheetState, string> = {
      closed:   'calc(100% - 3rem)',
      peek:     'calc(100% - 40dvh)',
      expanded: '0px',
    }
    wrapper.style.transform = `translateY(${map[state]})`
  })
  const paymentTagInputRef   = useRef<HTMLInputElement>(null)
  const generalTagInputRef   = useRef<HTMLInputElement>(null)
  const addQueryRef          = useRef<HTMLInputElement>(null)
  const prevMapStateRef      = useRef<{ zoom: number; center: any } | null>(null)
  const myLocationMarkerRef  = useRef<any>(null)
  const listScrollRef        = useRef<HTMLDivElement>(null)
  const savedScrollPosition  = useRef<number>(0)
  const favoritedIdsRef      = useRef<Set<string>>(new Set())
  const activeIdRef              = useRef<string | null>(null)
  const selectedIdRef            = useRef<string | null>(null)
  const updateMarkerHighlightRef = useRef<(id: string | null) => void>(() => {})
  const viewRef              = useRef<'list' | 'detail'>('list')
  const filteredPlaceIdsRef  = useRef<Set<string>>(new Set())

  // ─── state: places ───────────────────────────────────────────────────────
  const [places,   setPlaces]   = useState<Place[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  // ─── state: panel ────────────────────────────────────────────────────────
  const [sheetState, setSheetState] = useState<SheetState>('expanded')
  const [view,       setView]       = useState<'list' | 'detail'>('list')
  const [mainTab,    setMainTab]    = useState<'list' | 'favorites'>('list')

  // ─── state: detail ───────────────────────────────────────────────────────
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null)
  const [selectedTags,  setSelectedTags]  = useState<Tag[]>([])
  const [loadingTags,   setLoadingTags]   = useState(false)
  const [isFavorited,   setIsFavorited]   = useState(false)
  const [favCount,      setFavCount]      = useState(0)
  const isFavingRef = useRef(false)        // state 대신 ref → 즉각 낙관적 업데이트, disabled 없음
  const [showPaymentInput,   setShowPaymentInput]   = useState(false)
  const [newPaymentLabel,    setNewPaymentLabel]    = useState('')
  const [isAddingPaymentTag, setIsAddingPaymentTag] = useState(false)
  const [showGeneralInput,   setShowGeneralInput]   = useState(false)
  const [newGeneralLabel,    setNewGeneralLabel]    = useState('')
  const [isAddingGeneralTag, setIsAddingGeneralTag] = useState(false)

  // ─── state: auth ─────────────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [loginToast,    setLoginToast]    = useState(false)
  const [reportToast,   setReportToast]   = useState(false)
  const [overseasToast, setOverseasToast] = useState(false)
  const supabase = useRef(createClient()).current

  // ─── state: favorites ────────────────────────────────────────────────────
  const [favoritedIds, setFavoritedIds] = useState<Set<string>>(new Set())

  // ─── state: 우측 카드 대시보드 ──────────────────────────────────────────
  const [userStats,          setUserStats]          = useState<{ comments: number; photos: number } | null>(null)
  const [activityList,       setActivityList]       = useState<ActivityItem[]>([])
  const [showActivitySheet,  setShowActivitySheet]  = useState(false)
  const [activityTab,        setActivityTab]        = useState<'comment' | 'photo'>('comment')
  const [nicknameSetupValue, setNicknameSetupValue] = useState('')   // 닉네임 설정 모달 입력값
  const [showNicknameModal,  setShowNicknameModal]  = useState(false) // 닉네임 설정 모달 표시 여부
  const [isLoadingStats,     setIsLoadingStats]     = useState(false)
  const [isSavingNickname,   setIsSavingNickname]   = useState(false)
  const [isLoadingActivity,  setIsLoadingActivity]  = useState(false)

  // ─── state: photos ───────────────────────────────────────────────────────
  const [photos,         setPhotos]         = useState<PlacePhoto[]>([])
  const [selectedPhoto,  setSelectedPhoto]  = useState<PlacePhoto | null>(null)
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

  // ─── state: 콜키지/커버차지 인라인 수정 ───────────────────────────────────
  const [showCorkageEdit,   setShowCorkageEdit]   = useState(false)
  const [editCorkageType,   setEditCorkageType]   = useState<'impossible' | 'free' | 'paid'>('impossible')
  const [editCorkageFee,    setEditCorkageFee]    = useState('')
  const [showCoverEdit,     setShowCoverEdit]     = useState(false)
  const [editCoverCharge,   setEditCoverCharge]   = useState('')
  const [isSavingPlaceEdit, setIsSavingPlaceEdit] = useState(false)

  // ─── state: 우측 컨트롤 패널 ─────────────────────────────────────────────
  const [showProfileCard,  setShowProfileCard]  = useState(false)
  const [showPasswordText, setShowPasswordText] = useState(false)
  const [showFilterCard,   setShowFilterCard]   = useState(false)

  // ─── state: 검색/필터 ────────────────────────────────────────────────────
  const [filterState,        setFilterState]        = useState<FilterState>(INITIAL_FILTER)
  const [selectedTagFilters, setSelectedTagFilters] = useState<string[]>([])
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
  const [addCorkageType,      setAddCorkageType]      = useState<'impossible' | 'free' | 'paid'>('impossible')
  const [addCorkageFee,       setAddCorkageFee]       = useState('')
  // 바 전용
  const [addCoverChargeAmount, setAddCoverChargeAmount] = useState('')
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

  // ─── 인증 상태 구독 + 즐겨찾기 DB 로드 ──────────────────────────────────
  // ※ 구글 본명(display_name / full_name)은 절대 myNickname에 쓰지 않는다.
  //   익명 myNickname 은 localStorage 전용이며 로그인 상태와 완전히 분리된다.
  useEffect(() => {
    // 현재 세션 확인
    supabase.auth.getSession().then(({ data: { session } }) => {
      const user = session?.user ?? null
      setCurrentUser(user)
      if (user) {
        loadFavoritesFromDB()
        const appNick = user.user_metadata?.app_nickname as string | undefined
        if (!appNick) {
          setShowNicknameModal(true)
        }
        // 이미 닉네임 있는 경우 통계는 카드 열릴 때 or 여기서 즉시 로드
      }
    })
    // 로그인/로그아웃 이벤트 구독
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null
      setCurrentUser(user)
      if (user) {
        loadFavoritesFromDB()
        setUserStats(null)
        setNicknameSetupValue('')
        const appNick = user.user_metadata?.app_nickname as string | undefined
        if (!appNick) {
          // 닉네임 미설정 → 모달 오픈
          setShowNicknameModal(true)
        } else {
          // 닉네임 설정됨 → 바로 통계 로드
          setShowNicknameModal(false)
        }
      } else {
        // ── 로그아웃: 즐겨찾기 초기화 + 익명 상태 복원 ──
        setFavoritedIds(new Set())
        favoritedIdsRef.current = new Set()
        setUserStats(null)
        setActivityList([])
        setShowNicknameModal(false)
        // localStorage에 저장된 익명 닉네임/비밀번호 복원
        const savedNick = localStorage.getItem('tastamp_nickname')
        const savedCode = localStorage.getItem('tastamp_code')
        setMyNickname(savedNick ?? null)
        setMyCode(savedCode ?? '')
      }
    })
    return () => subscription.unsubscribe()
  }, [supabase]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── DB에서 즐겨찾기 목록 로드 ──────────────────────────────────────────
  const loadFavoritesFromDB = useCallback(async () => {
    try {
      const res = await fetch('/api/favorites')
      if (!res.ok) return
      const ids: string[] = await res.json()
      const idSet = new Set(ids)
      setFavoritedIds(idSet)
      favoritedIdsRef.current = idSet
      // 마커 갱신 (star badge 반영)
      if (naverMapRef.current && placesRef.current.length > 0) {
        setupMarkersRef.current(naverMapRef.current, placesRef.current)
      }
    } catch { /* 네트워크 오류 무시 */ }
  }, [])

  // ─── 유저 통계 로드 ─────────────────────────────────────────────────────
  const loadUserStats = useCallback(async () => {
    setIsLoadingStats(true)
    try {
      const res = await fetch('/api/user/stats')
      if (res.ok) setUserStats(await res.json())
    } catch { /* 무시 */ }
    finally { setIsLoadingStats(false) }
  }, [])

  // ─── 활동 내역 로드 ─────────────────────────────────────────────────────
  const loadActivity = useCallback(async () => {
    setIsLoadingActivity(true)
    try {
      const res = await fetch('/api/user/activity')
      if (res.ok) setActivityList(await res.json())
    } catch { /* 무시 */ }
    finally { setIsLoadingActivity(false) }
  }, [])

  // ─── 로그아웃 ────────────────────────────────────────────────────────────
  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut()
  }, [supabase])

  // ─── 닉네임 저장 (app_nickname 키 사용, 구글 본명과 분리) ────────────────
  const handleSaveNickname = useCallback(async () => {
    if (!currentUser || isSavingNickname) return
    const nickname = nicknameSetupValue.trim()
    if (!nickname) return
    setIsSavingNickname(true)
    try {
      const { data, error } = await supabase.auth.updateUser({
        data: { app_nickname: nickname },
      })
      if (!error && data.user) {
        setCurrentUser(data.user)
        setShowNicknameModal(false)  // 모달 닫기 (영구)
        setNicknameSetupValue('')
        loadUserStats()              // 통계 즉시 로드
      }
    } catch { /* 무시 */ }
    finally { setIsSavingNickname(false) }
  }, [currentUser, nicknameSetupValue, isSavingNickname, supabase, loadUserStats])

  // ─── 카드 열릴 때 대시보드 통계 로드 ─────────────────────────────────────
  useEffect(() => {
    const appNick = currentUser?.user_metadata?.app_nickname as string | undefined
    if (showProfileCard && currentUser && appNick && !isLoadingStats) {
      loadUserStats()
    }
  }, [showProfileCard]) // eslint-disable-line react-hooks/exhaustive-deps

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
      setAddCorkageType('impossible'); setAddCorkageFee('')
      setAddCoverChargeAmount('')
      setAddComment('')
      setTimeout(() => addQueryRef.current?.focus(), 50)
    }
  }, [showAddPanel])

  // ─── window 전역 함수 (인포윈도우 onclick용) ─────────────────────────────
  useEffect(() => {
    // 시트 상태는 openDetail 내부에서 컨텍스트에 맞게 직접 처리
    window.__openPlaceDetail = (id: string) => openDetailRef.current(id)
    return () => { delete (window as any).__openPlaceDetail }
  }, [])

  // ─── 상세 뷰 열기 ────────────────────────────────────────────────────────
  const openDetail = useCallback(async (id: string, targetZoom?: number) => {
    if (activeIdRef.current === id && viewRef.current === 'detail') return
    const place = placesRef.current.find((p) => p.id === id)
    if (!place) return

    savedScrollPosition.current = listScrollRef.current?.scrollTop ?? 0
    setSelectedPlace(place)
    setView('detail')
    // 모바일: 마커 탭은 closed/peek/expanded 무관하게 항상 peek으로 통일
    //   - closed → peek (시트 올라옴)
    //   - peek   → peek (데이터만 교체, 높이 유지)
    //   - expanded → peek (과도하게 가리지 않도록 살짝 내려옴)
    // 데스크탑: 항상 expanded (패널 표시 보장)
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setSheetState('peek')
    } else {
      setSheetState('expanded')
    }
    setShowAddPanel(false)
    setActiveId(id)
    setFavCount(place.favorites_count ?? 0)
    setIsFavorited(favoritedIdsRef.current.has(place.id))  // ref → stale closure 방지

    // 선택 마커 하이라이트 즉시 적용
    updateMarkerHighlightRef.current(id)

    if (naverMapRef.current && window.naver?.maps) {
      const map = naverMapRef.current
      const pos = new window.naver.maps.LatLng(place.lat, place.lng)

      // targetZoom이 지정되어 있고 현재 줌이 부족하면 먼저 줌 설정
      // (projection 좌표계가 줌에 종속되므로 panTo 계산 전에 반드시 선행)
      if (targetZoom !== undefined && map.getZoom() < targetZoom) {
        map.setZoom(targetZoom, false)  // false = 애니메이션 없이 즉시 적용
      }

      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        // 모바일: peek 시트(40dvh)에 가려지지 않는 가시 영역 중앙으로 오프셋 팬
        // 마커를 화면 상단 60dvh 영역의 중심(30% from top)에 배치
        try {
          const proj       = map.getProjection()
          const markerOff  = proj.fromCoordToOffset(pos)
          const peekH      = window.innerHeight * 0.4
          const newOff     = new window.naver.maps.Point(markerOff.x, markerOff.y + peekH / 2)
          map.panTo(proj.fromOffsetToCoord(newOff))
        } catch {
          map.panTo(pos)  // API 미지원 fallback
        }
      } else {
        map.panTo(pos)
      }
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
    // 콜키지/커버차지 편집 상태 초기화
    setShowCorkageEdit(false)
    setEditCorkageType((place.corkage_type as 'impossible' | 'free' | 'paid') ?? 'impossible')
    setEditCorkageFee(place.corkage_fee != null ? String(place.corkage_fee) : '')
    setShowCoverEdit(false)
    setEditCoverCharge(place.cover_charge != null ? String(place.cover_charge) : '')
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

  useEffect(() => { openDetailRef.current  = openDetail },   [openDetail])
  useEffect(() => { activeIdRef.current    = activeId },     [activeId])
  useEffect(() => { viewRef.current        = view },         [view])
  useEffect(() => { sheetStateRef.current  = sheetState },   [sheetState])

  // ─── 마커 선택 강조 ──────────────────────────────────────────────────────
  const updateMarkerHighlight = useCallback((selectedId: string | null) => {
    if (typeof window === 'undefined' || !window.naver?.maps) return
    selectedIdRef.current = selectedId
    const filteredIds = filteredPlaceIdsRef.current
    const hasFilter   = filteredIds.size < placesRef.current.length
    placesRef.current.forEach((place) => {
      const m = markersRef.current[place.id]
      if (!m) return
      const isSelected = selectedId === place.id
      const dimmed     = selectedId !== null && !isSelected
      const active     = !hasFilter || filteredIds.has(place.id)
      // 필터 dim(0.2) > 선택 dim(0.35) > 정상(1) 우선순위
      const opacity = !active ? 0.2 : dimmed ? 0.35 : 1
      m.setIcon({
        content: markerIcon(
          TYPE_COLOR[place.type] ?? MARKER_COLOR,
          opacity,
          favoritedIdsRef.current.has(place.id),
          isSelected,
        ),
        anchor: new window.naver.maps.Point(14, 36),
      })
      m.setZIndex(isSelected ? 200 : (active ? 100 : 10))
    })
  }, [])
  useEffect(() => { updateMarkerHighlightRef.current = updateMarkerHighlight }, [updateMarkerHighlight])

  // 리스트 뷰 복귀 시 하이라이트 초기화
  useEffect(() => {
    if (view === 'list') updateMarkerHighlightRef.current(null)
  }, [view])

  // 바텀 시트 완전 닫힘 시 하이라이트 초기화
  useEffect(() => {
    if (sheetState === 'closed') updateMarkerHighlightRef.current(null)
  }, [sheetState])

  // ── 모바일 시트 transform 적용 (sheetState 변경 시) ─────────────────────
  useEffect(() => {
    applyMobileTransformRef.current(sheetState, true)
  }, [sheetState])

  // ── body pull-to-refresh 차단 ────────────────────────────────────────────
  useEffect(() => {
    document.body.style.overscrollBehaviorY = 'none'
    return () => { document.body.style.overscrollBehaviorY = '' }
  }, [])

  // ── 리스트 스크롤 영역: 상단에서 아래로 스와이프 시 시트 내리기 ─────────
  useEffect(() => {
    const el = listScrollRef.current
    if (!el) return
    const onTouchStart = (e: TouchEvent) => {
      touchStartY.current = e.touches[0].clientY
      sheetStateAtStart.current = sheetStateRef.current
      isScrollSwipe.current = false
    }
    const onTouchMove = (e: TouchEvent) => {
      const delta = e.touches[0].clientY - touchStartY.current
      const scrollTop = el.scrollTop
      const curState = sheetStateAtStart.current
      if (!isScrollSwipe.current && scrollTop === 0 && delta > 8
          && (curState === 'expanded' || curState === 'peek')) {
        isScrollSwipe.current = true
        const wrapper = panelWrapperRef.current
        if (wrapper) wrapper.style.transition = 'none'
      }
      if (isScrollSwipe.current) {
        e.preventDefault()
        const wrapper = panelWrapperRef.current
        if (!wrapper) return
        const h = wrapper.getBoundingClientRect().height
        const peekPx = window.innerHeight * 0.4
        const offsets: Record<SheetState, number> = {
          closed: h - 48, peek: h - peekPx, expanded: 0,
        }
        const rawOffset = offsets[curState] + Math.max(0, delta)
        wrapper.style.transform = `translateY(${Math.min(h - 48, rawOffset)}px)`
      }
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (!isScrollSwipe.current) return
      isScrollSwipe.current = false
      const delta = e.changedTouches[0].clientY - touchStartY.current
      const curState = sheetStateAtStart.current
      const wrapper = panelWrapperRef.current
      if (wrapper) wrapper.style.transition = ''
      if (curState === 'expanded' && delta > 60) {
        setSheetState('peek')
      } else if (curState === 'peek' && delta > 60) {
        setSheetState('closed')
      } else {
        applyMobileTransformRef.current(curState, true)
      }
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove',  onTouchMove,  { passive: false })
    el.addEventListener('touchend',   onTouchEnd,   { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove',  onTouchMove)
      el.removeEventListener('touchend',   onTouchEnd)
    }
  }, []) // refs 사용 → 의존성 없음
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

  // ─── 비로그인 토스트 표시 ────────────────────────────────────────────────
  const showLoginRequired = useCallback(() => {
    setLoginToast(true)
    setTimeout(() => setLoginToast(false), 3500)
  }, [])

  // ─── 해외 탭 클릭 (준비중 안내) ──────────────────────────────────────────
  const handleOverseasClick = useCallback(() => {
    setOverseasToast(true)
    setTimeout(() => setOverseasToast(false), 4000)
  }, [])

  // ─── 리스트 아이템 즐겨찾기 빠른 토글 ──────────────────────────────────
  const handleFavoriteById = useCallback(async (placeId: string) => {
    if (!currentUser) { showLoginRequired(); return }

    // ref에서 최신 상태 읽기 → stale closure 방지, deps에서 favoritedIds 제거 가능
    const newFaved = !favoritedIdsRef.current.has(placeId)
    // 즉시 낙관적 업데이트
    setFavoritedIds((prev) => {
      const next = new Set(prev)
      if (newFaved) next.add(placeId); else next.delete(placeId)
      return next
    })
    try {
      const res = await fetch(`/api/places/${placeId}/favorite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: newFaved ? 'add' : 'remove' }),
      })
      if (!res.ok) throw new Error()
    } catch {
      // 실패 시 롤백
      setFavoritedIds((prev) => {
        const next = new Set(prev)
        if (!newFaved) next.add(placeId); else next.delete(placeId)
        return next
      })
    }
  }, [currentUser, showLoginRequired]) // favoritedIds 제거 → ref로 읽으므로 불필요

  // ─── 콜키지 수정 저장 ────────────────────────────────────────────────────
  const handleSaveCorkage = async () => {
    if (!selectedPlace || !currentUser || isSavingPlaceEdit) return
    setIsSavingPlaceEdit(true)
    try {
      const fee = editCorkageType === 'paid' ? (parseInt(editCorkageFee, 10) || 0) : 0
      const res = await fetch(`/api/places/${selectedPlace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ corkage_type: editCorkageType, corkage_fee: fee }),
      })
      if (res.ok) {
        setSelectedPlace((prev) => prev ? { ...prev, corkage_type: editCorkageType, corkage_fee: fee } : prev)
        setShowCorkageEdit(false)
      }
    } finally {
      setIsSavingPlaceEdit(false)
    }
  }

  // ─── 커버차지 수정 저장 ──────────────────────────────────────────────────
  const handleSaveCoverCharge = async () => {
    if (!selectedPlace || !currentUser || isSavingPlaceEdit) return
    setIsSavingPlaceEdit(true)
    try {
      const amount = parseInt(editCoverCharge, 10) || 0
      const res = await fetch(`/api/places/${selectedPlace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cover_charge: amount }),
      })
      if (res.ok) {
        setSelectedPlace((prev) => prev ? { ...prev, cover_charge: amount } : prev)
        setShowCoverEdit(false)
      }
    } finally {
      setIsSavingPlaceEdit(false)
    }
  }

  // ─── 즐겨찾기 토글 (상세 패널) ──────────────────────────────────────────
  const handleFavorite = async () => {
    if (!currentUser) { showLoginRequired(); return }
    if (isFavingRef.current || !selectedPlace) return
    isFavingRef.current = true

    // ── 낙관적 업데이트: API 응답 전에 즉시 반영 ──────────────────────────
    // ref에서 현재 상태 읽기 → stale closure 원천 차단
    const placeId  = selectedPlace.id
    const newFaved = !favoritedIdsRef.current.has(placeId)
    setIsFavorited(newFaved)
    setFavCount((c) => newFaved ? c + 1 : Math.max(0, c - 1))
    setFavoritedIds((prev) => {
      const next = new Set(prev)
      if (newFaved) next.add(placeId); else next.delete(placeId)
      return next
    })

    // ── 백그라운드 API 호출 ────────────────────────────────────────────────
    try {
      const res = await fetch(`/api/places/${placeId}/favorite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: newFaved ? 'add' : 'remove' }),
      })
      if (!res.ok) throw new Error()

      // ── 서버 최종값으로 덮어쓰기 (숫자 어긋남 방지) ─────────────────────
      const { favorites_count } = (await res.json()) as { favorites_count: number }
      setFavCount(favorites_count)
      // places 캐시도 갱신 → 상세 패널 재진입 시 stale 방지
      setPlaces((prev) => prev.map((p) =>
        p.id === placeId ? { ...p, favorites_count } : p,
      ))
      placesRef.current = placesRef.current.map((p) =>
        p.id === placeId ? { ...p, favorites_count } : p,
      )
    } catch {
      // ── 실패 시 롤백 ────────────────────────────────────────────────────
      setIsFavorited(!newFaved)
      setFavCount((c) => newFaved ? Math.max(0, c - 1) : c + 1)
      setFavoritedIds((prev) => {
        const next = new Set(prev)
        if (!newFaved) next.add(placeId); else next.delete(placeId)
        return next
      })
    } finally {
      isFavingRef.current = false
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
    // 로그인 사용자는 비밀번호 불필요
    if (!currentUser && !myCode) { setCommentPasswordError(true); setShowProfileCard(true); return }
    setCommentPasswordError(false)
    setIsSubmittingComment(true)
    // 로그인 유저는 app_nickname 사용, 익명 유저는 로컬 닉네임 사용
    const appNick = currentUser?.user_metadata?.app_nickname as string | undefined
    const nick = appNick || myNickname || '익명'
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
      // 로그인 유저: 통계 즉시 반영
      if (currentUser) setUserStats((prev) => prev ? { ...prev, comments: prev.comments + 1 } : prev)
    } catch (err) {
      console.error('[panel comment]', err)
      setComments((prev) => prev.filter((c) => c.id !== optimistic.id))
      setNewPanelComment(content)
    } finally {
      setIsSubmittingComment(false)
    }
  }

  // ─── 삭제/신고 버튼 노출 권한 판정 ────────────────────────────────────
  // 삭제: 본인 글(user_id 일치) + 익명 글(user_id null)
  const canDelete = (itemUserId?: string | null) =>
    !itemUserId || itemUserId === currentUser?.id
  // 신고: 익명 글(user_id null) + 타인 글(user_id 불일치) — 본인 글만 제외
  const canReport = (itemUserId?: string | null) =>
    !itemUserId || itemUserId !== currentUser?.id

  // ─── 신고 핸들러 ────────────────────────────────────────────────────────
  const handleReport = useCallback(async (
    reported_item_id: string,
    item_type: 'comment' | 'photo',
  ) => {
    const reason = window.prompt('신고 사유를 입력해 주세요. (최대 500자)')?.trim()
    if (!reason) return                         // 취소 or 빈 값
    if (reason.length > 500) {
      alert('신고 사유는 500자 이내로 입력해주세요.')
      return
    }
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reported_item_id, item_type, reason }),
      })
      if (!res.ok) throw new Error()
      setReportToast(true)
      setTimeout(() => setReportToast(false), 4000)
    } catch {
      alert('신고 접수 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
    }
  }, [])

  // ─── 코멘트 삭제 (소유자 즉시 삭제 / 익명 인라인 폼) ─────────────────
  const handleDeleteComment = async (comment: Comment) => {
    if (!selectedPlace) return
    // 삭제 전 사용자 확인
    if (!window.confirm('정말 삭제하시겠습니까? 삭제된 데이터는 복구할 수 없습니다.')) return
    // 로그인 유저 본인 글: 비밀번호 없이 즉시 삭제
    if (currentUser && comment.user_id && comment.user_id === currentUser.id) {
      const res = await fetch(`/api/places/${selectedPlace.id}/comments/${comment.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        setComments((prev) => prev.filter((c) => c.id !== comment.id))
        if (currentUser) setUserStats((prev) => prev ? { ...prev, comments: Math.max(0, prev.comments - 1) } : prev)
      }
      return
    }
    // 익명 글 또는 타인 글: 비밀번호 인라인 폼 표시
    setDeletingCommentId(comment.id)
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

  // ─── 사진 삭제 (소유자 즉시 삭제 / 익명 인라인 폼) ─────────────────────
  const handleDeletePhoto = async (photo: PlacePhoto) => {
    if (!selectedPlace) return
    // 삭제 전 사용자 확인
    if (!window.confirm('정말 삭제하시겠습니까? 삭제된 데이터는 복구할 수 없습니다.')) return
    // 로그인 유저 본인 글: 비밀번호 없이 즉시 삭제
    if (currentUser && photo.user_id && photo.user_id === currentUser.id) {
      const res = await fetch(`/api/places/${selectedPlace.id}/photos/${photo.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        setPhotos((prev) => prev.filter((p) => p.id !== photo.id))
        if (currentUser) setUserStats((prev) => prev ? { ...prev, photos: Math.max(0, prev.photos - 1) } : prev)
      }
      return
    }
    // 익명 글 또는 타인 글: 비밀번호 인라인 폼 표시
    setDeletingPhotoId(photo.id)
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
    // 로그인 체크 (label onClick에서 1차 차단, 여기서 2차 안전망)
    if (!currentUser) { showLoginRequired(); e.target.value = ''; return }
    // 익명 사용자는 비밀번호 필수
    if (!currentUser && !myCode) { setPhotoPasswordError(true); setShowProfileCard(true); e.target.value = ''; return }
    setPhotoPasswordError(false)

    const formData = new FormData()
    formData.append('file', file)
    if (!currentUser) {
      // 익명: nickname + code 전송 (서버에서 검증)
      formData.append('nickname', myNickname || '익명')
      formData.append('code', myCode)
    }
    // 로그인 유저는 서버가 쿠키에서 user_id·app_nickname을 직접 읽으므로 별도 전송 불필요

    setIsUploading(true)
    try {
      const res = await fetch(`/api/places/${selectedPlace.id}/photos`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) throw new Error('업로드 실패')
      const newPhoto = await res.json()
      setPhotos((prev) => [newPhoto, ...prev])
      // 로그인 유저: 통계 즉시 반영
      if (currentUser) setUserStats((prev) => prev ? { ...prev, photos: prev.photos + 1 } : prev)
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
    // 한 줄 평 입력 시 비밀번호 필수 (비로그인 사용자만)
    if (!currentUser && addComment.trim() && !myCode) {
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
          // 식당: 콜키지 (DB 직접 저장)
          ...(addType === 'restaurant' ? {
            corkage_type: addCorkageType,
            corkage_fee:  addCorkageType === 'paid' ? (parseInt(addCorkageFee, 10) || 0) : 0,
          } : {}),
          // 바: 커버차지 금액 (DB 직접 저장)
          ...(addType === 'bar' ? {
            cover_charge: parseInt(addCoverChargeAmount, 10) || 0,
          } : {}),
          ...(addComment.trim() ? {
            comment:  addComment.trim(),
            nickname: (currentUser?.user_metadata?.app_nickname as string | undefined) || myNickname || '익명',
            code:     myCode,
          } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setAddError(data.error ?? '등록 중 오류가 발생했습니다.')
        return
      }

      // 타입별 태그 등록 (payment: 리쿼샵 결제수단, category: 식당 대분류)
      // corkage / cover_charge 는 places 테이블에 직접 저장되므로 태그로 등록하지 않음
      const tagsToPost: { type: string; label: string }[] = []
      if (addType === 'whisky') {
        addPaymentTags.forEach((label) => tagsToPost.push({ type: 'payment', label }))
      } else if (addType === 'restaurant') {
        if (addCategory) tagsToPost.push({ type: 'category', label: addCategory })
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

  // ─── 현재 선택된 대분류에 속하는 장소의 general 태그만 추출 (인기순) ───────
  const uniqueGeneralTags = useMemo(() => {
    const { type } = filterState
    const source = type === 'all' ? places : places.filter((p) => p.type === type)
    const countMap = new Map<string, number>()
    source.forEach((p) => {
      p.tags?.forEach((t) => {
        if (t.type === 'general') {
          countMap.set(t.label, (countMap.get(t.label) ?? 0) + (t.count ?? 1))
        }
      })
    })
    return Array.from(countMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label]) => label)
  }, [places, filterState.type])

  // ─── 대분류 변경 시 태그 필터 초기화 (보이지 않는 태그 필터 잔존 방지) ───
  useEffect(() => {
    setSelectedTagFilters([])
  }, [filterState.type])

  // ─── 필터링된 장소 목록 ─────────────────────────────────────────────────
  const filteredPlaces = useMemo(() => {
    const { query, type, corkage, categories } = filterState
    const isFilterActive =
      query.trim() !== '' || type !== 'all' || corkage || categories.length > 0 || selectedTagFilters.length > 0

    const result = places.filter((p) => {
      if (query.trim() && !p.name.toLowerCase().includes(query.trim().toLowerCase())) return false
      if (type !== 'all' && p.type !== type) return false
      // 콜키지: places.corkage_type이 'free' 또는 'paid'인 경우만 포함
      if (corkage && p.corkage_type === 'impossible') return false
      if (corkage && !p.corkage_type) return false
      // 카테고리: 선택된 카테고리 중 하나라도 정확히 일치하는 태그가 있어야 함 (OR)
      if (categories.length > 0 && !p.tags?.some((t) => t.type === 'category' && categories.includes(t.label))) return false
      // 태그 칩 필터: 선택된 태그 중 하나라도 포함하는 장소만 (OR)
      if (selectedTagFilters.length > 0 && !p.tags?.some((t) => t.type === 'general' && selectedTagFilters.includes(t.label))) return false
      return true
    })

    // 필터가 활성화됐는데 0건 → 빈 배열 명시 반환 (전체 장소 반환 금지)
    if (isFilterActive && result.length === 0) return []
    return result
  }, [places, filterState, selectedTagFilters])

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
      // 선택 마커 강조 재적용 (zoom-in 상태에서 개별 마커가 보일 때)
      updateMarkerHighlightRef.current(selectedIdRef.current)
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

      // ── click: 상세 패널 (오프셋 팬은 openDetail 내부에서 처리) ──────────
      window.naver.maps.Event.addListener(marker, 'click', () => {
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
  // ─── 구글 로그인 핸들러 (토스트에서 사용) ───────────────────────────────
  const handleGoogleLogin = async () => {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${siteUrl}/auth/callback` },
    })
  }

  // ─── 바텀 시트 스와이프 핸들러 (핸들바 + 헤더 영역) ─────────────────────
  const onHandleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
    sheetStateAtStart.current = sheetStateRef.current
    const el = panelWrapperRef.current
    if (el) el.style.transition = 'none'
  }

  const onHandleTouchMove = (e: React.TouchEvent) => {
    const delta = e.touches[0].clientY - touchStartY.current
    const el = panelWrapperRef.current
    if (!el || typeof window === 'undefined') return
    const h = el.getBoundingClientRect().height
    const peekPx = window.innerHeight * 0.4  // 40dvh in px
    const offsets: Record<SheetState, number> = {
      closed: h - 48, peek: h - peekPx, expanded: 0,
    }
    const baseOffset = offsets[sheetStateAtStart.current]
    const rawOffset = baseOffset + delta
    // 상단(0)~핸들만 보임(h-48) 사이로 클램핑
    el.style.transform = `translateY(${Math.max(0, Math.min(h - 48, rawOffset))}px)`
  }

  const onHandleTouchEnd = (e: React.TouchEvent) => {
    const delta = e.changedTouches[0].clientY - touchStartY.current
    const curState = sheetStateAtStart.current
    const el = panelWrapperRef.current
    if (el) el.style.transition = ''
    const THRESHOLD = 60
    // 3단 스냅 로직
    let nextState: SheetState = curState
    if      (curState === 'expanded' && delta >  THRESHOLD) nextState = 'peek'
    else if (curState === 'peek'     && delta >  THRESHOLD) nextState = 'closed'
    else if (curState === 'peek'     && delta < -THRESHOLD) nextState = 'expanded'
    else if (curState === 'closed'   && delta < -THRESHOLD) nextState = 'peek'
    if (nextState !== curState) {
      setSheetState(nextState)
    } else {
      // 임계값 미달 → 현재 위치로 스냅백
      applyMobileTransformRef.current(curState, true)
    }
  }

  return (
    <div className="relative w-full h-full overflow-hidden">

      {/* ── 비로그인 즐겨찾기 토스트 ────────────────────────────────────── */}
      {loginToast && (
        <div
          className="fixed bottom-24 left-1/2 z-[200] flex items-center gap-3 rounded-2xl px-4 py-3 shadow-2xl"
          style={{
            transform: 'translateX(-50%)',
            background: '#1C1412',
            color: '#fff',
            minWidth: '240px',
          }}
        >
          <span className="text-sm font-medium flex-1">로그인이 필요한 기능입니다</span>
          <button
            onClick={handleGoogleLogin}
            className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full"
            style={{ background: 'var(--color-brand-primary)', color: '#fff' }}
          >
            로그인
          </button>
        </div>
      )}

      {/* ── 신고 완료 토스트 ────────────────────────────────────────────── */}
      {reportToast && (
        <div
          className="fixed bottom-24 left-1/2 z-[200] flex items-center gap-3 rounded-2xl px-4 py-3 shadow-2xl"
          style={{ transform: 'translateX(-50%)', background: '#1C1412', color: '#fff', minWidth: '280px' }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2.5" className="shrink-0">
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
          </svg>
          <span className="text-sm font-medium flex-1">
            신고가 접수되었습니다. 관리자 검토 후 조치됩니다.
          </span>
        </div>
      )}

      {/* ── 해외 준비중 토스트 ──────────────────────────────────────────── */}
      {overseasToast && (
        <div
          className="fixed bottom-24 left-1/2 z-[200] flex items-center gap-3 rounded-2xl px-4 py-3 shadow-2xl"
          style={{ transform: 'translateX(-50%)', background: '#1C1412', color: '#fff' }}
        >
          <span className="text-sm font-medium flex-1">
            해외는 곧 추가 예정입니다! ✈️
          </span>
        </div>
      )}

      {/* ── 📱 모바일 국내/해외 탑 앱바 (md 미만) ──────────────────────── */}
      <div
        className="md:hidden fixed top-0 left-0 right-0 z-30 flex bg-white border-b border-gray-100"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {/* 국내: 활성 */}
        <button
          className="flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-bold border-b-2 transition-colors"
          style={{ color: MARKER_COLOR, borderColor: MARKER_COLOR }}
        >
          국내
        </button>

        {/* 해외: 시각적 비활성 */}
        <button
          aria-disabled="true"
          onClick={handleOverseasClick}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-semibold border-b-2 border-transparent transition-colors"
          style={{ opacity: 0.45, cursor: 'not-allowed', filter: 'grayscale(1)', color: '#374151' }}
        >
          해외
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ background: '#e5e7eb', color: '#6b7280' }}
          >
            준비중
          </span>
        </button>
      </div>

      {/* ── 💻 데스크탑 국내/해외 플로팅 알약 (md 이상) ─────────────────── */}
      {/* fixed + left-1/2 + -translate-x-1/2 → 뷰포트 정중앙 고정 */}
      <div
        className="hidden md:flex fixed top-4 left-1/2 -translate-x-1/2 z-50 items-center gap-0.5 rounded-full p-1 shadow-xl"
        style={{
          background: 'rgba(255,255,255,0.96)',
          backdropFilter: 'blur(8px)',
        }}
      >
        {/* 국내: 활성 */}
        <button
          className="px-5 py-1.5 rounded-full text-sm font-bold transition-all shadow-sm"
          style={{ background: MARKER_COLOR + '18', color: MARKER_COLOR }}
        >
          국내
        </button>

        {/* 해외: 시각적 비활성 */}
        <button
          aria-disabled="true"
          onClick={handleOverseasClick}
          className="px-5 py-1.5 rounded-full text-sm font-semibold transition-all flex items-center gap-1.5"
          style={{ opacity: 0.45, cursor: 'not-allowed', filter: 'grayscale(1)', color: '#374151' }}
        >
          해외
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ background: '#e5e7eb', color: '#6b7280' }}
          >
            준비중
          </span>
        </button>
      </div>

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
        ref={panelWrapperRef}
        className={[
          // 모바일 z-40 / 데스크탑 md:z-20
          'z-40 md:z-20 transition-all duration-300 ease-in-out',
          // 모바일: 바텀 시트 (transform은 JS applyMobileTransform으로 제어)
          'fixed bottom-0 left-0 right-0 overscroll-y-none',
          // 데스크탑: 좌측 플로팅 패널
          'md:absolute md:top-4 md:bottom-4 md:left-4 md:right-auto md:w-[360px]',
          // 데스크탑 전용 translate-x (모바일에서는 JS inline style이 우선)
          sheetState !== 'closed'
            ? 'md:translate-x-0 md:pointer-events-auto'
            : 'md:translate-y-0 md:-translate-x-[calc(100%+1rem)] md:pointer-events-none',
        ].join(' ')}
        style={{ willChange: 'transform' }}
      >
        {/* 모바일 핸들바 + 전체 상단 스와이프 영역 */}
        <div
          className="md:hidden flex justify-center items-center py-2 cursor-pointer bg-white rounded-t-2xl touch-none select-none"
          onClick={() => {
            const pos = listScrollRef.current?.scrollTop ?? 0
            const next: SheetState = sheetState !== 'closed' ? 'closed' : 'expanded'
            setSheetState(next)
            requestAnimationFrame(() => { if (listScrollRef.current) listScrollRef.current.scrollTop = pos })
          }}
          onTouchStart={onHandleTouchStart}
          onTouchMove={onHandleTouchMove}
          onTouchEnd={onHandleTouchEnd}
        >
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        <div
          className="panel w-full md:!h-full flex flex-col overflow-hidden md:rounded-2xl"
          style={{ height: 'calc(100dvh - env(safe-area-inset-top, 0px) - 64px)' }}
        >

          {/* 목록 / 즐겨찾기 탭 헤더 */}
          {view === 'list' && !showAddPanel && (
            <div className="flex border-b border-border-default flex-shrink-0">
              {([
                { key: 'list',      label: '목록' },
                { key: 'favorites', label: '즐겨찾기' },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setMainTab(key)}
                  className={`flex-1 py-3 text-label font-semibold transition-colors border-b-2 -mb-px ${
                    mainTab === key
                      ? 'border-brand-primary text-brand-primary'
                      : 'border-transparent text-text-tertiary hover:text-text-secondary'
                  }`}
                >
                  {label}
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
                                    setAddCorkageType('impossible'); setAddCorkageFee('')
                                    setAddCoverChargeAmount('')
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
                              setAddCorkageType('impossible'); setAddCorkageFee('')
                              setAddCoverChargeAmount('')
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
                          <div className="flex gap-2">
                            {(['impossible', 'free', 'paid'] as const).map((v) => (
                              <button
                                key={v}
                                onClick={() => setAddCorkageType(v)}
                                className={`flex-1 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                                  addCorkageType === v ? 'text-white border-transparent' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                                }`}
                                style={addCorkageType === v ? { backgroundColor: TYPE_COLOR.restaurant } : {}}
                              >
                                {v === 'impossible' ? '불가' : v === 'free' ? '프리' : '유료'}
                              </button>
                            ))}
                          </div>
                          {addCorkageType === 'paid' && (
                            <input
                              type="number"
                              value={addCorkageFee}
                              onChange={(e) => setAddCorkageFee(e.target.value)}
                              placeholder="병당 금액 입력 (원)"
                              min="0"
                              className="mt-2 w-full text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-orange-300"
                            />
                          )}
                        </div>
                      </>
                    )}

                    {/* 바: 커버차지 금액 입력 */}
                    {addType === 'bar' && (
                      <div>
                        <p className="text-xs font-semibold text-gray-500 mb-2">커버차지</p>
                        <input
                          type="number"
                          value={addCoverChargeAmount}
                          onChange={(e) => setAddCoverChargeAmount(e.target.value)}
                          placeholder="금액 입력 (원)"
                          min="0"
                          className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-gray-400"
                        />
                        <p className="text-[11px] text-gray-400 mt-1">0 또는 비워두면 커버차지 없음으로 처리됩니다</p>
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
              {/* 장소 수 + 뷰모드 탭 + 정렬 */}
              <div className="px-4 pt-2 pb-0 flex-shrink-0 space-y-2">
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
                        if (key === 'distance' && !userLocation) requestUserLocation()
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
                      onClick={() => {
                        if (!currentUser) { showLoginRequired(); return }
                        setShowAddPanel(true)
                      }}
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
                    // places 테이블 직접 컬럼 기준 정책 배지
                    const policyBadges: { label: string; color: string; bg: string }[] = []
                    if (place.type === 'restaurant') {
                      if (place.corkage_type === 'free')
                        policyBadges.push({ label: '콜키지 프리', color: '#c2410c', bg: '#fff7ed' })
                      else if (place.corkage_type === 'paid')
                        policyBadges.push({ label: '콜키지 유료', color: '#b45309', bg: '#fffbeb' })
                    }
                    if (place.type === 'bar' && place.cover_charge != null && place.cover_charge > 0)
                      policyBadges.push({ label: '커버차지', color: MARKER_COLOR, bg: `${MARKER_COLOR}15` })
                    return (
                      <li key={place.id}>
                        <button
                          onClick={() => openDetail(place.id, LIST_CLICK_ZOOM)}
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
                              <span
                                key={b.label}
                                className="text-[10px] font-semibold rounded-full px-1.5 py-0.5"
                                style={{ color: b.color, backgroundColor: b.bg }}
                              >
                                {b.label}
                              </span>
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
                  onClick={() => {
                    if (!currentUser) { showLoginRequired(); return }
                    setShowAddPanel(true)
                  }}
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
                                onClick={() => { if (!isFavoriteEditMode) openDetail(place.id, LIST_CLICK_ZOOM) }}
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
              <div
                className="px-4 py-3 border-b border-gray-100 flex-shrink-0 flex items-center gap-3 touch-none select-none"
                onTouchStart={onHandleTouchStart}
                onTouchMove={onHandleTouchMove}
                onTouchEnd={onHandleTouchEnd}
              >
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

              {/* ─── 면책 조항 (헤더 바로 아래 고정) ──────────────────── */}
              <p className="px-4 py-2 text-[10px] text-gray-400 leading-relaxed border-b border-gray-50 flex-shrink-0">
                자세한 사항은 네이버 지도 또는 연락을 통해 직접 확인하시길 바랍니다. 본 지도는 위치 정보만 제공하며, 이로 인한 손해를 책임지지 않습니다.
              </p>

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
                    className={`flex items-center justify-center gap-2 active:scale-95 transition-all flex-1 min-h-[44px] ${
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
                    className="btn-secondary flex items-center justify-center gap-2 active:scale-95 transition-all flex-1 min-h-[44px]"
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

                {/* 콜키지 정보 (식당 전용) — 로그인 유저는 수정 가능 */}
                {selectedPlace.type === 'restaurant' && (
                  <div className="card p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-label font-semibold text-text-secondary">콜키지</p>
                      {currentUser && (
                        <button
                          onClick={() => setShowCorkageEdit((v) => !v)}
                          className="text-[11px] font-semibold text-text-tertiary hover:text-brand-primary transition-colors"
                        >
                          {showCorkageEdit ? '취소' : '수정'}
                        </button>
                      )}
                    </div>

                    {!showCorkageEdit ? (
                      <>
                        {selectedPlace.corkage_type === 'impossible' && (
                          <span className="inline-flex items-center gap-1 tag">🚫 콜키지 불가</span>
                        )}
                        {selectedPlace.corkage_type === 'free' && (
                          <span className="inline-flex items-center gap-1 tag tag-active">🍾 콜키지 프리</span>
                        )}
                        {selectedPlace.corkage_type === 'paid' && (
                          <span className="inline-flex items-center gap-1 tag tag-active">
                            🍾 {selectedPlace.corkage_fee && selectedPlace.corkage_fee > 0
                              ? `콜키지 병당 ${selectedPlace.corkage_fee.toLocaleString()}원`
                              : '콜키지 유료'}
                          </span>
                        )}
                        {!selectedPlace.corkage_type && (
                          <span className="text-caption text-text-disabled">정보 없음{currentUser ? ' — 수정 버튼으로 입력하세요' : ''}</span>
                        )}
                      </>
                    ) : (
                      <div className="space-y-2 mt-1">
                        <div className="flex gap-2">
                          {(['impossible', 'free', 'paid'] as const).map((v) => (
                            <button
                              key={v}
                              onClick={() => setEditCorkageType(v)}
                              className={`flex-1 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                                editCorkageType === v
                                  ? 'text-white border-transparent'
                                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                              }`}
                              style={editCorkageType === v ? { backgroundColor: TYPE_COLOR.restaurant } : {}}
                            >
                              {v === 'impossible' ? '불가' : v === 'free' ? '프리' : '유료'}
                            </button>
                          ))}
                        </div>
                        {editCorkageType === 'paid' && (
                          <input
                            type="number"
                            value={editCorkageFee}
                            onChange={(e) => setEditCorkageFee(e.target.value)}
                            placeholder="병당 금액 (원)"
                            min="0"
                            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-orange-300"
                          />
                        )}
                        <button
                          onClick={handleSaveCorkage}
                          disabled={isSavingPlaceEdit}
                          className="btn-primary w-full py-2 text-xs disabled:opacity-50"
                          style={{ backgroundColor: TYPE_COLOR.restaurant }}
                        >
                          {isSavingPlaceEdit ? '저장 중...' : '저장'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* 커버차지 정보 (바 전용) — 로그인 유저는 수정 가능 */}
                {selectedPlace.type === 'bar' && (
                  <div className="card p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-label font-semibold text-text-secondary">커버차지</p>
                      {currentUser && (
                        <button
                          onClick={() => setShowCoverEdit((v) => !v)}
                          className="text-[11px] font-semibold text-text-tertiary hover:text-brand-primary transition-colors"
                        >
                          {showCoverEdit ? '취소' : '수정'}
                        </button>
                      )}
                    </div>

                    {!showCoverEdit ? (
                      <>
                        {selectedPlace.cover_charge != null && selectedPlace.cover_charge > 0 ? (
                          <span className="inline-flex items-center gap-1 tag tag-active">
                            🎵 커버차지 {selectedPlace.cover_charge.toLocaleString()}원
                          </span>
                        ) : (
                          <span className="text-caption text-text-disabled">없음{currentUser ? ' — 수정 버튼으로 입력하세요' : ''}</span>
                        )}
                      </>
                    ) : (
                      <div className="space-y-2 mt-1">
                        <input
                          type="number"
                          value={editCoverCharge}
                          onChange={(e) => setEditCoverCharge(e.target.value)}
                          placeholder="금액 입력 (원), 0이면 없음으로 처리"
                          min="0"
                          className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-gray-400"
                        />
                        <button
                          onClick={handleSaveCoverCharge}
                          disabled={isSavingPlaceEdit}
                          className="btn-primary w-full py-2 text-xs disabled:opacity-50"
                          style={{ backgroundColor: MARKER_COLOR }}
                        >
                          {isSavingPlaceEdit ? '저장 중...' : '저장'}
                        </button>
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
                    onClick={(e) => {
                      if (!currentUser) { e.preventDefault(); showLoginRequired() }
                    }}
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
                            onClick={() => { if (!deletingPhotoId) setSelectedPhoto(photo) }}
                          />
                          <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-gradient-to-t from-black/50 to-transparent flex items-end justify-between">
                            <p className="text-[9px] text-white truncate">{photo.nickname}</p>
                          </div>
                          {/* 삭제 버튼: 본인·익명 → 우상단 */}
                          {deletingPhotoId !== photo.id && canDelete(photo.user_id) && (
                            <button
                              onClick={() => handleDeletePhoto(photo)}
                              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              title="삭제"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                              </svg>
                            </button>
                          )}
                          {/* 신고 버튼: 익명·타인 → 좌상단 */}
                          {deletingPhotoId !== photo.id && canReport(photo.user_id) && (
                            <button
                              onClick={() => handleReport(photo.id, 'photo')}
                              className="absolute top-1 left-1 w-5 h-5 rounded-full bg-black/60 text-orange-300 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              title="신고"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
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
                  <p className="text-sm font-bold text-gray-700 mb-2.5">한 줄 평</p>

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
                                  <span className="text-sm font-semibold text-gray-700">{c.nickname}</span>
                                  <span className="text-xs text-gray-400">
                                    {new Date(c.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                                  </span>
                                </div>
                                <p className="text-sm text-gray-600 mt-0.5 leading-relaxed">{c.content}</p>
                              </div>
                              {/* 삭제 버튼: 본인·익명 */}
                              {!c.id.startsWith('__opt__') && deletingCommentId !== c.id && canDelete(c.user_id) && (
                                <button
                                  onClick={() => handleDeleteComment(c)}
                                  className="shrink-0 self-start mt-0.5 p-1 rounded text-gray-300 hover:text-red-400 transition-colors"
                                  title="삭제"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                                  </svg>
                                </button>
                              )}
                              {/* 신고 버튼: 익명·타인 */}
                              {!c.id.startsWith('__opt__') && deletingCommentId !== c.id && canReport(c.user_id) && (
                                <button
                                  onClick={() => handleReport(c.id, 'comment')}
                                  className="shrink-0 self-start mt-0.5 p-1 rounded text-gray-200 hover:text-orange-400 transition-colors"
                                  title="신고"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
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
                                      className={`flex items-center gap-1 text-xs transition-colors ${
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
                                      className={`flex items-center gap-1 text-xs transition-colors ${
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

              </div>
            </>
          )}

        </div>
      </div>

      {/* ── 활동 내역 바텀 시트 ────────────────────────────────────────── */}
      {showActivitySheet && (
        <div className="fixed inset-0 z-50 flex flex-col" onClick={() => setShowActivitySheet(false)}>
          {/* 배경 */}
          <div className="flex-1 bg-black/40" />
          {/* 시트 */}
          <div
            className="bg-white rounded-t-3xl max-h-[80dvh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 핸들 */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-300" />
            </div>
            {/* 헤더 */}
            <div className="flex items-center justify-between px-5 pt-2 pb-3">
              <h3 className="text-sm font-bold text-gray-900">내 활동 내역</h3>
              <button
                onClick={() => setShowActivitySheet(false)}
                className="p-1 text-gray-400 hover:text-gray-700 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            {/* 탭 */}
            <div className="flex border-b border-gray-100 px-5 gap-4">
              {(['comment', 'photo'] as const).map((tab) => {
                const count = activityList.filter((i) => i.type === tab).length
                const label = tab === 'comment' ? '코멘트' : '사진'
                const isActive = activityTab === tab
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActivityTab(tab)}
                    className={`pb-2.5 text-xs font-semibold border-b-2 transition-colors ${isActive ? 'border-[#BF3A21] text-[#BF3A21]' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                  >
                    {label}
                    {!isLoadingActivity && (
                      <span className={`ml-1 text-[10px] ${isActive ? 'text-[#BF3A21]/70' : 'text-gray-300'}`}>
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            {/* 목록 */}
            <div className="flex-1 overflow-y-auto">
              {isLoadingActivity ? (
                <p className="text-center text-sm text-gray-400 py-10">불러오는 중...</p>
              ) : (() => {
                const filtered = activityList.filter((i) => i.type === activityTab)
                if (filtered.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-12 gap-2 text-gray-400">
                      {activityTab === 'comment' ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                        </svg>
                      )}
                      <p className="text-sm">
                        {activityTab === 'comment' ? '아직 남긴 코멘트가 없습니다' : '아직 업로드한 사진이 없습니다'}
                      </p>
                    </div>
                  )
                }
                if (activityTab === 'comment') {
                  return (
                    <ul className="divide-y divide-gray-50">
                      {filtered.map((item) => (
                        <li key={item.id}>
                          <button
                            className="w-full text-left px-5 py-3.5 hover:bg-gray-50 transition-colors"
                            onClick={() => { setShowActivitySheet(false); openDetail(item.place_id, LIST_CLICK_ZOOM) }}
                          >
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="text-xs font-bold" style={{ color: MARKER_COLOR }}>{item.place_name}</span>
                              <span className="text-[10px] text-gray-400">
                                {new Date(item.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                              </span>
                            </div>
                            <p className="text-xs text-gray-600 leading-snug line-clamp-2">{item.content}</p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )
                }
                // 사진 탭: 3열 그리드
                return (
                  <div className="p-3 grid grid-cols-3 gap-1.5">
                    {filtered.map((item) => (
                      <button
                        key={item.id}
                        className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 group"
                        onClick={() => { setShowActivitySheet(false); openDetail(item.place_id, LIST_CLICK_ZOOM) }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.url}
                          alt={item.place_name}
                          className="w-full h-full object-cover transition-transform group-hover:scale-105"
                        />
                        {/* 장소명 오버레이 */}
                        <div className="absolute bottom-0 inset-x-0 px-1.5 pb-1.5 pt-4"
                             style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 100%)' }}>
                          <p className="text-white text-[9px] font-semibold leading-tight line-clamp-1">{item.place_name}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )
              })()}
              <div className="h-4" />
            </div>
          </div>
        </div>
      )}

      {/* ── 닉네임 설정 모달 (첫 로그인 시 중앙 팝업) ─────────────────── */}
      {showNicknameModal && currentUser && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center px-6"
             style={{ background: 'rgba(0,0,0,0.55)' }}>
          <div
            className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 헤더 */}
            <div className="text-center space-y-1.5">
              <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center text-white text-2xl font-bold"
                   style={{ backgroundColor: MARKER_COLOR }}>
                👤
              </div>
              <h2 className="text-base font-bold text-gray-900">닉네임을 설정해 주세요</h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                구글 계정의 실명은 앱에 표시되지 않습니다.<br/>
                코멘트·사진에 사용될 닉네임을 직접 입력해 주세요.
              </p>
            </div>

            {/* 입력 */}
            <div className="space-y-3">
              <input
                type="text"
                value={nicknameSetupValue}
                onChange={(e) => setNicknameSetupValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveNickname()}
                placeholder="닉네임 입력 (최대 20자)"
                maxLength={20}
                autoFocus
                className="w-full text-sm border-2 border-gray-200 rounded-2xl px-4 py-3 outline-none focus:border-[#BF3A21] transition-colors placeholder:text-gray-300"
              />
              <button
                onClick={handleSaveNickname}
                disabled={isSavingNickname || !nicknameSetupValue.trim()}
                className="w-full py-3.5 rounded-2xl text-sm font-bold text-white disabled:opacity-40 active:scale-[0.98] transition-all"
                style={{ backgroundColor: MARKER_COLOR }}
              >
                {isSavingNickname ? '저장 중...' : '닉네임 설정 완료'}
              </button>
            </div>

            {/* 로그아웃 */}
            <button
              onClick={handleLogout}
              className="w-full text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              로그아웃
            </button>
          </div>
        </div>
      )}

      {/* ── 사진 라이트박스 모달 ───────────────────────────────────────── */}
      {selectedPhoto && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.92)' }}
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

          {/* 사진 */}
          <img
            src={selectedPhoto.url}
            alt="사진 확대"
            className="max-w-[90vw] max-h-[80vh] object-contain rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />

          {/* 사진 정보 + 삭제 버튼 행 */}
          <div
            className="mt-3 flex items-center gap-2.5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 닉네임 · 날짜 pill */}
            <div
              className="flex items-center gap-2.5 px-4 py-2 rounded-full"
              style={{ background: 'rgba(255,255,255,0.1)' }}
            >
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                   style={{ backgroundColor: MARKER_COLOR }}>
                {selectedPhoto.nickname[0]?.toUpperCase() ?? '?'}
              </div>
              <span className="text-white text-xs font-semibold">{selectedPhoto.nickname}</span>
              <span className="text-white/50 text-[10px]">·</span>
              <span className="text-white/70 text-[10px]">
                {new Date(selectedPhoto.created_at).toLocaleDateString('ko-KR', {
                  year: 'numeric', month: '2-digit', day: '2-digit',
                }).replace(/\. /g, '.').replace(/\.$/, '')}
              </span>
            </div>

            {/* 삭제 버튼 (익명·본인 글만 렌더링) */}
            {canDelete(selectedPhoto.user_id) && (
              <button
                onClick={() => { setSelectedPhoto(null); handleDeletePhoto(selectedPhoto) }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full text-white/70 hover:text-white hover:bg-red-500/60 transition-colors text-xs font-semibold"
                title="삭제"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                </svg>
                삭제
              </button>
            )}
            {/* 신고 버튼: 익명·타인 */}
            {canReport(selectedPhoto.user_id) && (
              <button
                onClick={() => { setSelectedPhoto(null); handleReport(selectedPhoto.id, 'photo') }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full text-white/70 hover:text-white hover:bg-orange-500/60 transition-colors text-xs font-semibold"
                title="신고"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                  <line x1="4" y1="22" x2="4" y2="15"/>
                </svg>
                신고
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── 우측 상단 통합 컨트롤 패널 ─────────────────────────────────── */}
      {/* top-16(64px) on mobile = safe-area + 토글 py-3*2(24px) + 텍스트(20px) ≈ 44px + 여백 */}
      <div className="absolute top-16 md:top-4 right-4 z-30 flex flex-col items-end gap-2 w-[268px]">

        {/* 프로필 카드 – auth 상태에 따라 내부가 3단계로 변함 */}
        <div className={`panel w-full rounded-2xl overflow-hidden transition-shadow duration-300 ${(!currentUser && (commentPasswordError || photoPasswordError || addCommentPasswordError)) ? 'ring-2 ring-red-500' : ''}`}
             style={{ boxShadow: (!currentUser && (commentPasswordError || photoPasswordError || addCommentPasswordError)) ? '0 0 0 3px rgba(239,68,68,0.25), 0 4px 24px rgba(0,0,0,0.13)' : '0 4px 24px rgba(0,0,0,0.13), 0 1px 4px rgba(0,0,0,0.08)' }}>
          <button
            onClick={() => setShowProfileCard((v) => !v)}
            className="flex items-center gap-2.5 px-3.5 py-2.5 w-full hover:bg-gray-50 transition-colors"
          >
            {/* 아바타 */}
            {(() => {
              const appNick = currentUser?.user_metadata?.app_nickname as string | undefined
              const avatarLabel = currentUser
                ? (appNick ? appNick[0].toUpperCase() : '?')
                : (myNickname ? myNickname[0].toUpperCase() : null)
              const avatarBg = currentUser ? MARKER_COLOR : (myNickname ? MARKER_COLOR : '#d1d5db')
              return (
                <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-white text-[11px] font-bold"
                     style={{ backgroundColor: avatarBg }}>
                  {avatarLabel ?? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                    </svg>
                  )}
                </div>
              )
            })()}
            <div className="flex-1 text-left min-w-0">
              {currentUser ? (() => {
                const appNick = currentUser.user_metadata?.app_nickname as string | undefined
                return appNick ? (
                  <>
                    <p className="text-xs font-bold text-gray-800 truncate leading-tight">{appNick}</p>
                    <p className="text-[10px] text-gray-400 leading-tight mt-0.5">마이페이지</p>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-bold text-amber-600 truncate leading-tight">닉네임 설정 필요</p>
                    <p className="text-[10px] text-gray-400 leading-tight mt-0.5">Google 로그인 완료</p>
                  </>
                )
              })() : (
                <>
                  <p className="text-xs font-bold text-gray-800 truncate leading-tight">
                    {myNickname || <span className="text-gray-400 font-normal">닉네임 설정 안 됨</span>}
                  </p>
                  <p className="text-[10px] text-gray-400 leading-tight mt-0.5">
                    {myCode ? '🔒 비밀번호 설정됨' : '⚠︎ 비밀번호 미설정'}
                  </p>
                </>
              )}
            </div>
            <svg className={`shrink-0 transition-transform duration-200 ${showProfileCard ? 'rotate-180' : ''}`}
                 xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
                 fill="none" stroke="#9ca3af" strokeWidth="2.5">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>

          {showProfileCard && (
            <div className="border-t border-gray-100">

              {/* ══ 케이스 A: 비로그인 ══ 익명 닉네임/비밀번호 + 구글 로그인 버튼 */}
              {!currentUser && (
                <div className="px-3.5 pb-3.5 pt-2.5 space-y-2">
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
                  {/* 구분선 + 구글 로그인 */}
                  <div className="pt-1 border-t border-gray-100">
                    <p className="text-[9px] text-gray-400 text-center mb-2">또는 계정으로 로그인</p>
                    <button
                      onClick={handleGoogleLogin}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold text-gray-700 bg-gray-50 border border-gray-200 hover:bg-white hover:shadow-sm active:scale-[0.98] transition-all"
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" xmlns="http://www.w3.org/2000/svg">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                      </svg>
                      Google로 로그인
                    </button>
                    {/* 법적 고지 */}
                    <p className="text-[9px] text-gray-400 leading-relaxed text-center mt-2">
                      본 서비스는 주류 관련 장소 정보도 다룹니다.<br />
                      주류 판매·광고·중개가 목적이 아닌 개인 운영 커뮤니티입니다.<br />
                      <a href="https://tender-omelet-de8.notion.site/Terms-of-Use-34c39f83940e809c8841ef4d6700f48f?pvs=74"
                         target="_blank" rel="noopener noreferrer"
                         className="underline hover:text-gray-600 transition-colors">이용약관</a>
                      {' · '}
                      <a href="https://tender-omelet-de8.notion.site/Privacy-Policy-34c39f83940e801389e6e957be1dfdd6?source=copy_link"
                         target="_blank" rel="noopener noreferrer"
                         className="underline hover:text-gray-600 transition-colors">개인정보처리방침</a>
                    </p>
                  </div>
                </div>
              )}

              {/* ══ 케이스 B: 로그인 + 닉네임 미설정 ══ → 모달로 분리, 여기엔 간단한 안내만 */}
              {currentUser && !(currentUser.user_metadata?.app_nickname as string | undefined) && (
                <div className="px-3.5 pb-3 pt-2.5 space-y-2">
                  <p className="text-[10px] text-amber-600 font-semibold">닉네임 설정이 필요합니다</p>
                  <button
                    onClick={() => setShowNicknameModal(true)}
                    className="w-full py-2 rounded-xl text-xs font-bold text-white active:scale-[0.98] transition-all"
                    style={{ backgroundColor: MARKER_COLOR }}
                  >
                    닉네임 설정하기
                  </button>
                  <button
                    onClick={handleLogout}
                    className="w-full text-[10px] text-gray-400 hover:text-red-500 transition-colors py-0.5"
                  >
                    로그아웃
                  </button>
                </div>
              )}

              {/* ══ 케이스 C: 로그인 완료 (닉네임 설정됨) ══ 대시보드 */}
              {currentUser && !!(currentUser.user_metadata?.app_nickname as string | undefined) && (
                <div className="py-3 space-y-1">
                  {/* 통계 그리드 */}
                  <div className="px-3.5 pb-2">
                    {isLoadingStats ? (
                      <p className="text-[10px] text-gray-400 text-center py-2">불러오는 중...</p>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { label: '코멘트',  value: userStats?.comments ?? 0, onClick: async () => { setActivityTab('comment'); setShowActivitySheet(true); await loadActivity() } },
                          { label: '사진',    value: userStats?.photos   ?? 0, onClick: async () => { setActivityTab('photo');   setShowActivitySheet(true); await loadActivity() } },
                          { label: '즐겨찾기', value: favoritedIds.size,        onClick: () => setMainTab('favorites') },
                        ].map(({ label, value, onClick }) => (
                          <div
                            key={label}
                            onClick={onClick ? (e: React.MouseEvent) => { e.stopPropagation(); onClick() } : undefined}
                            className="text-center bg-gray-50 rounded-xl py-2.5 cursor-pointer hover:bg-gray-100 active:scale-[0.97] transition-all border border-gray-100"
                          >
                            <p className="text-base font-bold text-gray-900">{value}</p>
                            <p className="text-[9px] text-gray-400 mt-0.5">{label}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* 구분선 + 로그아웃 */}
                  <div className="px-3.5 pt-1.5">
                    <div className="border-t border-gray-100 mb-2" />
                    <button
                      onClick={handleLogout}
                      className="w-full py-2 text-xs font-semibold text-red-400 hover:text-red-600 bg-red-50 hover:bg-red-100 transition-colors rounded-xl"
                    >
                      로그아웃
                    </button>
                    {/* 법적 고지 */}
                    <p className="text-[9px] text-gray-400 leading-relaxed text-center mt-2">
                      본 서비스는 주류 관련 장소 정보도 다룹니다.<br />
                      주류 판매·광고·중개가 목적이 아닌 개인 운영 커뮤니티입니다.<br />
                      <a href="https://tender-omelet-de8.notion.site/Terms-of-Use-34c39f83940e809c8841ef4d6700f48f?pvs=74"
                         target="_blank" rel="noopener noreferrer"
                         className="underline hover:text-gray-600 transition-colors">이용약관</a>
                      {' · '}
                      <a href="https://tender-omelet-de8.notion.site/Privacy-Policy-34c39f83940e801389e6e957be1dfdd6?source=copy_link"
                         target="_blank" rel="noopener noreferrer"
                         className="underline hover:text-gray-600 transition-colors">개인정보처리방침</a>
                    </p>
                  </div>
                </div>
              )}

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
            {(filterState.type !== 'all' || filterState.corkage || filterState.categories.length > 0 || !!filterState.query || selectedTagFilters.length > 0) && (
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
              <SearchFilter
                onChange={setFilterState}
                tags={uniqueGeneralTags}
                selectedTags={selectedTagFilters}
                onTagChange={setSelectedTagFilters}
              />
            </div>
          )}
        </div>
        {/* /내부 컨텐츠 div */}
      </div>
      {/* /플로팅 패널 외부 래퍼 */}


      {/* ── GPS 플로팅 액션 버튼 ────────────────────────────────────────── */}
      {/* 모바일: fixed z-50 → 바텀시트(z-40)/피크카드(z-[55]) 계층에서 항상 가시 */}
      <button
        onClick={() => {
          requestUserLocation((loc) => {
            naverMapRef.current?.panTo(new window.naver.maps.LatLng(loc.lat, loc.lng))
          })
        }}
        className="fixed right-4 z-50 bg-white p-3 rounded-full shadow-lg hover:bg-gray-50 active:scale-95 transition-all md:absolute md:z-20 md:bottom-6 md:right-6"
        style={{ bottom: 72 }}
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
        onClick={() => setSheetState((v) => v !== 'closed' ? 'closed' : 'expanded')}
        className="hidden md:flex items-center justify-center absolute top-1/2 -translate-y-1/2 z-30 bg-white shadow-md rounded-r-xl rounded-l-none p-3 min-h-[44px] min-w-[28px] hover:bg-gray-50 transition-[left] duration-300 ease-in-out"
        style={{ left: sheetState !== 'closed' ? 'calc(1rem + 360px)' : '0' }}
        aria-label={sheetState !== 'closed' ? '패널 닫기' : '패널 열기'}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          {sheetState !== 'closed' ? <path d="M15 18l-6-6 6-6"/> : <path d="M9 18l6-6-6-6"/>}
        </svg>
      </button>

    </div>
  )
}
