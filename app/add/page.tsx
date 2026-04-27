'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/src/lib/supabase-browser'
import type { User } from '@supabase/supabase-js'

// ── 상수 ──────────────────────────────────────────────────────────────────
const MARKER_COLOR = '#BF3A21'

const TYPE_COLOR: Record<string, string> = {
  whisky:     '#BF3A21',
  bar:        '#8B4513',
  restaurant: '#F97316',
}

const ADD_TYPE_OPTIONS = [
  { value: 'whisky',     label: '리쿼샵' },
  { value: 'bar',        label: '바'     },
  { value: 'restaurant', label: '식당'   },
] as const

const DEFAULT_PAYMENT_TAGS = ['카드', '현금', '온누리']
const FOOD_CATEGORIES = ['한식', '일식', '중식', '양식', '아시안', '기타'] as const

function inferTypeFromCategory(category: string): 'whisky' | 'bar' | 'restaurant' | null {
  const c = category.toLowerCase()
  if (c.includes('주점') || c.includes('바') || c.includes('bar') || c.includes('클럽') || c.includes('나이트')) return 'bar'
  if (c.includes('주류') || c.includes('와인') || c.includes('위스키') || c.includes('리쿼')) return 'whisky'
  if (c.includes('음식점') || c.includes('식당') || c.includes('카페') || c.includes('레스토랑') ||
      c.includes('한식') || c.includes('일식') || c.includes('중식') || c.includes('양식') || c.includes('분식')) return 'restaurant'
  return null
}

// ── 타입 ──────────────────────────────────────────────────────────────────
interface SearchResult {
  name: string
  address: string
  city: string | null
  district: string | null
  naver_place_id: string | null
  coords: { lat: number; lng: number }
  category: string
}

// ── 컴포넌트 ──────────────────────────────────────────────────────────────
export default function AddPage() {
  const router = useRouter()
  const supabase = useRef(createClient()).current
  const searchInputRef = useRef<HTMLInputElement>(null)

  // ── 인증 ─────────────────────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [myNickname,  setMyNickname]  = useState<string | null>(null)
  const [myCode,      setMyCode]      = useState('')

  useEffect(() => {
    const savedNick = localStorage.getItem('tastamp_nickname')
    const savedCode = localStorage.getItem('tastamp_code')
    if (savedNick) setMyNickname(savedNick)
    if (savedCode) setMyCode(savedCode)

    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUser(session?.user ?? null)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user ?? null)
      setAuthLoading(false)
    })
    return () => subscription.unsubscribe()
  }, [supabase])

  // ── 폼 상태 ──────────────────────────────────────────────────────────────
  const [addType,             setAddType]             = useState<'whisky' | 'bar' | 'restaurant'>('whisky')
  const [addQuery,            setAddQuery]            = useState('')
  const [searchResults,       setSearchResults]       = useState<SearchResult[]>([])
  const [isSearching,         setIsSearching]         = useState(false)
  const [isAdding,            setIsAdding]            = useState<string | null>(null)
  const [addError,            setAddError]            = useState<string | null>(null)
  const [selectedSearchResult, setSelectedSearchResult] = useState<SearchResult | null>(null)
  const [addPaymentTags,      setAddPaymentTags]      = useState<Set<string>>(new Set())
  // 식당 전용
  const [addCategory,         setAddCategory]         = useState('')
  const [addCorkageType,      setAddCorkageType]      = useState<'impossible' | 'free' | 'paid'>('impossible')
  const [addCorkageFee,       setAddCorkageFee]       = useState('')
  // 바 전용
  const [addCoverChargeAmount, setAddCoverChargeAmount] = useState('')
  // 공통
  const [addComment,             setAddComment]             = useState('')
  const [addCommentPasswordError, setAddCommentPasswordError] = useState(false)

  // ── 네이버 검색 ──────────────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    const q = addQuery.trim()
    if (!q || isSearching) return
    setIsSearching(true)
    setSearchResults([])
    setAddError(null)
    try {
      const res  = await fetch(`/api/naver/search?query=${encodeURIComponent(q)}`)
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
  }, [addQuery, isSearching])

  // ── 장소 등록 ────────────────────────────────────────────────────────────
  const handleAddPlace = useCallback(async (result: SearchResult) => {
    if (isAdding) return
    // 비로그인 유저가 코멘트를 남기려는데 비밀번호가 없는 경우에만 차단
    if (!currentUser && addComment.trim() && !myCode) {
      setAddCommentPasswordError(true)
      alert('비밀번호를 설정해 주세요.')
      return
    }
    setAddCommentPasswordError(false)
    setIsAdding(result.name)
    setAddError(null)

    // 닉네임: 로그인 유저는 app_nickname 우선, 없으면 '익명'
    //         비로그인 유저는 myNickname(localStorage) 사용
    const appNick = currentUser?.user_metadata?.app_nickname as string | undefined
    const resolvedNickname = currentUser
      ? (appNick || '익명')
      : (myNickname || '익명')

    try {
      const res = await fetch('/api/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:           result.name,
          address:        result.address,
          type:           addType,
          naver_place_id: result.naver_place_id,
          district:       result.district,
          city:           result.city,
          lat:            result.coords.lat,
          lng:            result.coords.lng,
          // 로그인 유저 ID를 submitted_by 로 항상 전달
          ...(currentUser ? { submitted_by: currentUser.id } : {}),
          ...(addType === 'restaurant' ? {
            corkage_type: addCorkageType,
            corkage_fee:  addCorkageType === 'paid' ? (parseInt(addCorkageFee, 10) || 0) : 0,
          } : {}),
          ...(addType === 'bar' ? {
            cover_charge: parseInt(addCoverChargeAmount, 10) || 0,
          } : {}),
          ...(addComment.trim() ? {
            comment:  addComment.trim(),
            nickname: resolvedNickname,
            // 로그인 유저는 code 불필요, 비로그인은 myCode 전달
            ...(currentUser ? {} : { code: myCode }),
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
      }

      await Promise.all(
        tagsToPost.map((tag) =>
          fetch(`/api/places/${data.id}/tags`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(tag),
          })
        )
      )

      // 등록 완료 → 상세 페이지로 이동
      router.push(`/place/${data.id}`)
    } catch {
      setAddError('등록 중 네트워크 오류가 발생했습니다.')
    } finally {
      setIsAdding(null)
    }
  }, [
    isAdding, currentUser, addComment, myCode, addType, addCorkageType,
    addCorkageFee, addCoverChargeAmount, myNickname, addPaymentTags,
    addCategory, router,
  ])

  return (
    <div className="flex flex-col h-dvh bg-white">

      {/* 헤더 */}
      <div
        className="flex items-center gap-2 px-4 border-b border-gray-100 flex-shrink-0"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)', paddingBottom: '12px' }}
      >
        <button
          onClick={() => router.back()}
          className="shrink-0 p-1 -ml-1 text-gray-500 hover:text-gray-800 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <h1 className="text-sm font-bold text-gray-900">장소 추가</h1>
      </div>

      {/* 폼 본문 */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-100 pb-[env(safe-area-inset-bottom,0px)]">

        {/* ① 검색 */}
        <div className="px-4 py-4 space-y-3">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">상호명 검색</p>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2">검색 후 결과를 선택하세요</p>
            <div className="flex gap-2">
              <input
                ref={searchInputRef}
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
            <p className="text-[10px] text-gray-400 leading-relaxed mt-1.5">
              네이버 검색 API 정책으로 인해 검색 결과는 최대 5개까지만 노출됩니다.<br />
              찾으시는 장소가 없다면 보다 정확한 검색어(예: 상호명 + 지점명) 또는 네이버 지도에서 확인 후 입력해 주세요.
            </p>
          </div>

          {/* 검색 결과 */}
          {addError && (
            <p className="text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{addError}</p>
          )}
          {searchResults.length > 0 && (
            <ul className="space-y-1.5">
              {searchResults.map((r) => {
                const resultKey   = `${r.coords.lat}-${r.coords.lng}`
                const selectedKey = selectedSearchResult
                  ? `${selectedSearchResult.coords.lat}-${selectedSearchResult.coords.lng}`
                  : null
                const isSelected = resultKey === selectedKey
                return (
                  <li key={resultKey}>
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
                            setAddCorkageType('impossible')
                            setAddCorkageFee('')
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
                        <span className={`text-sm font-semibold truncate ${isSelected ? 'text-[#BF3A21]' : 'text-gray-800'}`}>
                          {r.name}
                        </span>
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

            {/* 분류 선택 */}
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
                      setAddCorkageType('impossible')
                      setAddCorkageFee('')
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
                <p className="text-xs text-gray-500 mb-2">해당하는 결제 수단을 선택하세요</p>
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
                  <p className="text-xs font-semibold text-gray-500 mb-2">
                    대분류 <span className="text-red-400">*</span>
                  </p>
                  <div className="flex gap-1.5 flex-wrap">
                    {FOOD_CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setAddCategory(cat)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                          addCategory === cat
                            ? 'text-white border-transparent'
                            : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
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
                          addCorkageType === v
                            ? 'text-white border-transparent'
                            : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
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

            {/* 바: 커버차지 */}
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

            {/* 닉네임: 인증 확인 중에는 숨김, 로그인 유저는 배지, 비로그인은 입력 */}
            {!authLoading && (
              currentUser ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                    style={{ backgroundColor: '#BF3A21' }}>
                    {((currentUser.user_metadata?.app_nickname as string | undefined) || '?')[0].toUpperCase()}
                  </div>
                  <span className="text-xs text-gray-600 font-medium">
                    {(currentUser.user_metadata?.app_nickname as string | undefined) || '익명'}
                  </span>
                  <span className="text-[10px] text-gray-400 ml-auto">로그인된 계정으로 등록됩니다</span>
                </div>
              ) : (
                <div>
                  <input
                    type="text"
                    value={myNickname ?? ''}
                    onChange={(e) => setMyNickname(e.target.value)}
                    placeholder="닉네임 (선택)"
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-gray-400"
                  />
                </div>
              )
            )}

            <textarea
              value={addComment}
              onChange={(e) => {
                setAddComment(e.target.value)
                if (e.target.value.trim() === '' || myCode) setAddCommentPasswordError(false)
              }}
              placeholder="이 장소에 대한 첫 코멘트를 남겨보세요 (선택, 200자 이내)"
              maxLength={200}
              rows={3}
              className={`w-full text-sm border rounded-xl px-3 py-2 outline-none resize-none transition-colors placeholder:text-gray-300 ${
                addCommentPasswordError
                  ? 'border-red-400 focus:border-red-500'
                  : 'border-gray-200 focus:border-gray-400'
              }`}
            />

            {/* 비로그인: 비밀번호 입력 (코멘트 남길 때만 필요) */}
            {!authLoading && !currentUser && addComment.trim() && (
              <div>
                <input
                  type="password"
                  value={myCode}
                  onChange={(e) => {
                    setMyCode(e.target.value)
                    if (e.target.value) setAddCommentPasswordError(false)
                  }}
                  placeholder="코멘트 삭제용 비밀번호 (선택)"
                  maxLength={20}
                  className={`w-full text-sm border rounded-xl px-3 py-2 outline-none transition-colors ${
                    addCommentPasswordError
                      ? 'border-red-400 focus:border-red-500'
                      : 'border-gray-200 focus:border-gray-400'
                  }`}
                />
              </div>
            )}

            {addCommentPasswordError && (
              <p className="text-xs text-red-500 -mt-1.5">
                비밀번호를 입력해 주세요.
              </p>
            )}
          </div>
        )}

        {/* ④ 등록 버튼 */}
        {selectedSearchResult && (
          <div className="px-4 py-4">
            <button
              onClick={() => handleAddPlace(selectedSearchResult)}
              disabled={!!isAdding}
              className="w-full py-3 rounded-2xl text-sm font-bold text-white disabled:opacity-50 active:scale-[0.98] transition-all"
              style={{ backgroundColor: TYPE_COLOR[addType] }}
            >
              {isAdding ? '등록 중...' : `"${selectedSearchResult.name}" 등록`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
