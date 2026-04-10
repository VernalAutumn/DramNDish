'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import Link from 'next/link'

interface Place {
  id: string
  name: string
  address: string
  type: string
  naver_place_id: string | null
  favorites_count: number | null
  district: string | null
  city: string | null
}

interface Tag {
  id: string
  label: string
  count: number
  type: 'payment' | 'general'
}

interface Comment {
  id: string
  nickname: string
  content: string
  created_at: string
}

const TYPE_LABEL: Record<string, string> = {
  whisky:     '리쿼샵',
  bar:        '바',
  restaurant: '맛집',
}

const BRAND = '#BF3A21'
const DEFAULT_PAYMENT_TAGS = ['카드', '현금', '온누리']

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-bold text-gray-800 mb-3">{children}</h3>
}

export default function PlaceDetailClient({
  place,
  initialTags,
}: {
  place: Place
  initialTags: Tag[]
}) {
  // 즐겨찾기
  const [favCount,    setFavCount]    = useState(place.favorites_count ?? 0)
  const [isFavorited, setIsFavorited] = useState(false)
  const [isFaving,    setIsFaving]    = useState(false)

  // 탭
  const [activeTab, setActiveTab] = useState<'payment' | 'general'>('payment')

  // 결제수단 태그 (payment)
  const [paymentTags,      setPaymentTags]      = useState<Tag[]>(initialTags.filter(t => t.type === 'payment'))
  const [showPaymentInput, setShowPaymentInput] = useState(false)
  const [newPaymentLabel,  setNewPaymentLabel]  = useState('')
  const [isAddingPayment,  setIsAddingPayment]  = useState(false)
  const paymentInputRef = useRef<HTMLInputElement>(null)

  // 일반 태그 (general)
  const [tags,         setTags]         = useState<Tag[]>(initialTags.filter(t => t.type === 'general'))
  const [showTagInput, setShowTagInput] = useState(false)
  const [newTagLabel,  setNewTagLabel]  = useState('')
  const [isAddingTag,  setIsAddingTag]  = useState(false)
  const tagInputRef = useRef<HTMLInputElement>(null)

  // 코멘트
  const [comments,       setComments]       = useState<Comment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(true)
  const [nickname,       setNickname]       = useState('')
  const [commentContent, setCommentContent] = useState('')
  const [isSubmitting,   setIsSubmitting]   = useState(false)
  const [myNickname,     setMyNickname]     = useState<string | null>(null)

  // ─── localStorage 초기화 ─────────────────────────────────────────────────
  useEffect(() => {
    setIsFavorited(localStorage.getItem(`favorited_${place.id}`) === 'true')
    const saved = localStorage.getItem('tastamp_nickname')
    if (saved) { setMyNickname(saved); setNickname(saved) }
  }, [place.id])

  useEffect(() => {
    if (showPaymentInput) paymentInputRef.current?.focus()
  }, [showPaymentInput])

  useEffect(() => {
    if (showTagInput) tagInputRef.current?.focus()
  }, [showTagInput])

  // ─── 결제수단: DB 태그 + 기본 제안 병합 ──────────────────────────────────
  const paymentTagsDisplay = useMemo(() => {
    const dbLabels = new Set(paymentTags.map(t => t.label))
    const suggestions = DEFAULT_PAYMENT_TAGS
      .filter(label => !dbLabels.has(label))
      .map(label => ({ id: `__pay__${label}`, label, count: 0, type: 'payment' as const }))
    return [
      ...paymentTags.slice().sort((a, b) => b.count - a.count),
      ...suggestions,
    ]
  }, [paymentTags])

  // ─── 일반 태그 목록 (count 내림차순) ─────────────────────────────────────
  const sortedTags = useMemo(
    () => tags.slice().sort((a, b) => b.count - a.count),
    [tags]
  )

  // ─── 즐겨찾기 토글 ───────────────────────────────────────────────────────
  const handleFavorite = async () => {
    if (isFaving) return
    setIsFaving(true)
    const newFaved = !isFavorited
    setIsFavorited(newFaved)
    setFavCount((c) => newFaved ? c + 1 : Math.max(0, c - 1))
    localStorage.setItem(`favorited_${place.id}`, String(newFaved))
    try {
      await fetch(`/api/places/${place.id}/favorite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: newFaved ? 'add' : 'remove' }),
      })
    } catch {
      setIsFavorited(!newFaved)
      setFavCount((c) => newFaved ? Math.max(0, c - 1) : c + 1)
      localStorage.setItem(`favorited_${place.id}`, String(!newFaved))
    } finally {
      setIsFaving(false)
    }
  }

  // ─── 결제수단 클릭: 신규면 생성, 기존이면 count +1 ──────────────────────
  const handlePaymentVote = async (label: string) => {
    const existing = paymentTags.find(t => t.label === label)

    // 낙관적 업데이트 (기존 태그만)
    if (existing) {
      setPaymentTags(prev => prev.map(t => t.id === existing.id ? { ...t, count: t.count + 1 } : t))
    }

    const res = await fetch(`/api/places/${place.id}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, type: 'payment' }),
    })

    if (!res.ok) {
      if (existing) {
        setPaymentTags(prev => prev.map(t => t.id === existing.id ? { ...t, count: t.count - 1 } : t))
      }
      console.error('[handlePaymentVote]', await res.json())
      return
    }

    const data: Tag = await res.json()
    setPaymentTags(prev => {
      const inState = prev.find(t => t.label === label)
      if (inState) return prev.map(t => t.label === label ? data : t)
      return [...prev, data]
    })
  }

  // ─── 결제수단 직접 추가 ───────────────────────────────────────────────────
  const handleAddPayment = async () => {
    const label = newPaymentLabel.trim()
    if (!label || isAddingPayment) return
    setIsAddingPayment(true)
    try {
      const res  = await fetch(`/api/places/${place.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, type: 'payment' }),
      })
      const data = await res.json()
      if (res.ok) {
        setPaymentTags(prev => {
          const exists = prev.find(t => t.label === label)
          if (exists) return prev.map(t => t.label === label ? data : t)
          return [...prev, data]
        })
        setNewPaymentLabel('')
        setShowPaymentInput(false)
      } else {
        console.error('[handleAddPayment]', data)
      }
    } finally {
      setIsAddingPayment(false)
    }
  }

  // ─── 태그 count +1 ───────────────────────────────────────────────────────
  const handleTagVote = async (tag: Tag) => {
    // 낙관적 업데이트
    setTags((prev) => prev.map((t) => t.id === tag.id ? { ...t, count: t.count + 1 } : t))

    const res = await fetch(`/api/places/${place.id}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: tag.label, type: 'general' }),
    })
    if (!res.ok) {
      // 롤백
      setTags((prev) => prev.map((t) => t.id === tag.id ? { ...t, count: t.count - 1 } : t))
      console.error('[handleTagVote]', await res.json())
    } else {
      const data = await res.json()
      setTags((prev) => prev.map((t) => t.id === tag.id ? data : t))
    }
  }

  // ─── 태그 신규 추가 ──────────────────────────────────────────────────────
  const handleAddTag = async () => {
    const label = newTagLabel.trim()
    if (!label || isAddingTag) return
    setIsAddingTag(true)
    try {
      const res  = await fetch(`/api/places/${place.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, type: 'general' }),
      })
      const data = await res.json()
      if (res.ok) {
        setTags((prev) => {
          const exists = prev.find((t) => t.label === label)
          if (exists) return prev.map((t) => t.label === label ? data : t)
          return [...prev, data]
        })
        setNewTagLabel('')
        setShowTagInput(false)
      } else {
        console.error('[handleAddTag]', data)
      }
    } finally {
      setIsAddingTag(false)
    }
  }

  // ─── 코멘트 목록 불러오기 ────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/places/${place.id}/comments`)
      .then(r => r.json())
      .then(data => setComments(Array.isArray(data) ? data : []))
      .catch(e => console.error('[comments fetch]', e))
      .finally(() => setCommentsLoading(false))
  }, [place.id])

  // ─── 코멘트 저장 ─────────────────────────────────────────────────────────
  const handleSubmitComment = async () => {
    const nick    = nickname.trim()
    const content = commentContent.trim()
    if (!nick || !content || isSubmitting) return
    setIsSubmitting(true)
    try {
      const res  = await fetch(`/api/places/${place.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nick, content }),
      })
      const data = await res.json()
      if (res.ok) {
        setComments(prev => [data, ...prev])
        setCommentContent('')
        // 닉네임 최초 저장
        if (!myNickname) {
          localStorage.setItem('tastamp_nickname', nick)
          setMyNickname(nick)
        }
      } else {
        console.error('[comments POST]', data)
        alert(data.error ?? '저장에 실패했습니다.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  // ─── 코멘트 삭제 ─────────────────────────────────────────────────────────
  const handleDeleteComment = async (commentId: string) => {
    if (!confirm('이 코멘트를 삭제할까요?')) return
    // 낙관적 제거
    setComments(prev => prev.filter(c => c.id !== commentId))
    const res = await fetch(`/api/places/${place.id}/comments`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commentId }),
    })
    if (!res.ok) {
      const err = await res.json()
      console.error('[comments DELETE]', err)
      // 롤백: 다시 불러오기
      fetch(`/api/places/${place.id}/comments`)
        .then(r => r.json())
        .then(data => setComments(Array.isArray(data) ? data : []))
    }
  }

  // ─── 날짜 포맷 ───────────────────────────────────────────────────────────
  const formatDate = (iso: string) => {
    const d = new Date(iso)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const h = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${y}.${m}.${day} ${h}:${min}`
  }

  const mapUrl = place.naver_place_id
    ? `https://map.naver.com/p/entry/place/${place.naver_place_id}`
    : `https://map.naver.com/p/search/${encodeURIComponent(place.address)}`

  // ─── 렌더 ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">

      {/* 헤더 */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <Link href="/" className="shrink-0 p-1 -ml-1 text-gray-500 hover:text-gray-800 transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </Link>
        <h1 className="text-base font-bold text-gray-900 truncate">{place.name}</h1>
      </header>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-3">

        {/* ── 기본 정보 ─────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-xl font-bold text-gray-900 leading-tight">{place.name}</h2>
            <span
              className="shrink-0 mt-0.5 px-2.5 py-0.5 rounded-full text-xs font-bold text-white"
              style={{ backgroundColor: BRAND }}
            >
              {TYPE_LABEL[place.type] ?? place.type}
            </span>
          </div>
          <div className="mt-3 flex items-start gap-2 text-sm text-gray-600">
            <svg className="shrink-0 mt-0.5" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <span className="leading-snug">{place.address}</span>
          </div>
          {(place.city || place.district) && (
            <p className="mt-1 text-xs text-gray-400 pl-[18px]">
              {[place.city, place.district].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        {/* ── 액션 버튼 ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">

          {/* 즐겨찾기 */}
          <button
            onClick={handleFavorite}
            disabled={isFaving}
            className={`flex flex-col items-center gap-1.5 rounded-2xl p-4 shadow-sm active:scale-95 transition-all disabled:opacity-60 ${
              isFavorited ? 'text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
            style={isFavorited ? { backgroundColor: BRAND } : {}}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
              fill={isFavorited ? 'white' : 'none'}
              stroke={isFavorited ? 'white' : BRAND}
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            <span className="text-xs font-bold">
              즐겨찾기{favCount > 0 && <span className="ml-1 opacity-80">({favCount})</span>}
            </span>
          </button>

          {/* 네이버 지도 */}
          <a
            href={mapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-1.5 bg-white rounded-2xl p-4 shadow-sm hover:bg-gray-50 active:scale-95 transition-all text-gray-700"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <span className="text-xs font-bold">지도 보기</span>
          </a>

        </div>

        {/* ── 결제수단 / 태그 탭 ─────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">

          {/* 탭 헤더 */}
          <div className="flex border-b border-gray-100">
            {(['payment', 'general'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab)
                  setShowPaymentInput(false)
                  setShowTagInput(false)
                  setNewPaymentLabel('')
                  setNewTagLabel('')
                }}
                className={`flex-1 py-3 text-sm font-semibold transition-colors border-b-2 -mb-px ${
                  activeTab === tab
                    ? 'border-[#BF3A21] text-[#BF3A21]'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                {tab === 'payment' ? '결제수단' : '태그'}
              </button>
            ))}
          </div>

          <div className="p-5">

            {/* ── 결제수단 탭 ──────────────────────────────────── */}
            {activeTab === 'payment' && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-gray-400">클릭하여 결제 가능 수단 등록</p>
                  <button
                    onClick={() => setShowPaymentInput(v => !v)}
                    className="text-xs font-medium hover:opacity-70 transition-opacity"
                    style={{ color: BRAND }}
                  >
                    {showPaymentInput ? '취소' : '+ 직접 추가'}
                  </button>
                </div>

                {showPaymentInput && (
                  <div className="flex gap-2 mb-3">
                    <input
                      ref={paymentInputRef}
                      type="text"
                      value={newPaymentLabel}
                      onChange={(e) => setNewPaymentLabel(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddPayment()}
                      placeholder="예: 지역화폐, 제로페이"
                      maxLength={20}
                      className="flex-1 text-sm border border-gray-200 rounded-full px-3 py-1.5 outline-none focus:border-[#BF3A21] transition-colors"
                    />
                    <button
                      onClick={handleAddPayment}
                      disabled={!newPaymentLabel.trim() || isAddingPayment}
                      className="px-3 py-1.5 rounded-full text-xs font-bold text-white disabled:opacity-40"
                      style={{ backgroundColor: BRAND }}
                    >
                      {isAddingPayment ? '...' : '추가'}
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {paymentTagsDisplay.map((tag) => {
                    const isInDB = !tag.id.startsWith('__pay__')
                    return (
                      <button
                        key={tag.id}
                        onClick={() => handlePaymentVote(tag.label)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border active:scale-95 transition-all ${
                          isInDB
                            ? 'bg-red-50 text-[#BF3A21] border-[#BF3A21] hover:opacity-80'
                            : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-[#BF3A21] hover:text-[#BF3A21] hover:bg-red-50'
                        }`}
                      >
                        <span>{tag.label}</span>
                        {isInDB && tag.count > 0 && (
                          <span className="opacity-60">+{tag.count}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {/* ── 태그 탭 ──────────────────────────────────────── */}
            {activeTab === 'general' && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-gray-400">클릭하여 +1 투표</p>
                  <button
                    onClick={() => setShowTagInput(v => !v)}
                    className="text-xs font-medium hover:opacity-70 transition-opacity"
                    style={{ color: BRAND }}
                  >
                    {showTagInput ? '취소' : '+ 태그 추가'}
                  </button>
                </div>

                {showTagInput && (
                  <div className="flex gap-2 mb-3">
                    <input
                      ref={tagInputRef}
                      type="text"
                      value={newTagLabel}
                      onChange={(e) => setNewTagLabel(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                      placeholder="태그 입력 후 Enter"
                      maxLength={20}
                      className="flex-1 text-sm border border-gray-200 rounded-full px-3 py-1.5 outline-none focus:border-[#BF3A21] transition-colors"
                    />
                    <button
                      onClick={handleAddTag}
                      disabled={!newTagLabel.trim() || isAddingTag}
                      className="px-3 py-1.5 rounded-full text-xs font-bold text-white disabled:opacity-40"
                      style={{ backgroundColor: BRAND }}
                    >
                      {isAddingTag ? '...' : '추가'}
                    </button>
                  </div>
                )}

                {sortedTags.length === 0 ? (
                  <p className="text-xs text-gray-400">아직 태그가 없습니다. 첫 태그를 달아보세요!</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {sortedTags.map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => handleTagVote(tag)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border bg-red-50 text-[#BF3A21] border-[#BF3A21] hover:opacity-80 active:scale-95 transition-all"
                      >
                        <span>{tag.label}</span>
                        <span className="opacity-70">+{tag.count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

          </div>
        </div>

        {/* ── 사진 ──────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <SectionTitle>사진</SectionTitle>
          <button
            onClick={() => alert('사진 업로드 기능은 준비 중입니다.')}
            className="w-full h-20 border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-[#BF3A21] hover:text-[#BF3A21] transition-colors group"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
              className="group-hover:stroke-[#BF3A21] transition-colors">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <span className="text-xs font-medium">사진 추가</span>
          </button>
        </div>

        {/* ── 코멘트 ────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <SectionTitle>코멘트</SectionTitle>

          {/* 작성 폼 */}
          <div className="mb-5 space-y-2">
            {/* 닉네임 */}
            <input
              type="text"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              placeholder="닉네임"
              maxLength={20}
              disabled={!!myNickname}
              className={`w-full text-sm border rounded-xl px-3 py-2 outline-none transition-colors ${
                myNickname
                  ? 'border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed'
                  : 'border-gray-200 focus:border-[#BF3A21]'
              }`}
            />
            {/* 내용 */}
            <textarea
              value={commentContent}
              onChange={e => setCommentContent(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleSubmitComment() }}
              placeholder="이 장소에 대한 코멘트를 남겨보세요 (최대 200자)"
              maxLength={200}
              rows={3}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none outline-none focus:border-[#BF3A21] transition-colors"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">{commentContent.length}/200</span>
              <button
                onClick={handleSubmitComment}
                disabled={!nickname.trim() || !commentContent.trim() || isSubmitting}
                className="px-4 py-1.5 rounded-full text-xs font-bold text-white disabled:opacity-40 transition-opacity"
                style={{ backgroundColor: BRAND }}
              >
                {isSubmitting ? '저장 중...' : '등록'}
              </button>
            </div>
          </div>

          {/* 코멘트 목록 */}
          {commentsLoading ? (
            <p className="text-xs text-gray-400 text-center py-4">불러오는 중...</p>
          ) : comments.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">첫 코멘트를 남겨보세요!</p>
          ) : (
            <ul className="divide-y divide-gray-50 -mx-5 px-5">
              {comments.map(c => (
                <li key={c.id} className="py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {/* 아바타 */}
                      <div
                        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
                        style={{ backgroundColor: BRAND }}
                      >
                        {c.nickname.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-800">{c.nickname}</span>
                          <span className="text-[10px] text-gray-400">{formatDate(c.created_at)}</span>
                        </div>
                        <p className="text-sm text-gray-700 mt-0.5 leading-snug break-words">{c.content}</p>
                      </div>
                    </div>
                    {/* 본인 코멘트 삭제 버튼 */}
                    {myNickname && c.nickname === myNickname && (
                      <button
                        onClick={() => handleDeleteComment(c.id)}
                        className="shrink-0 p-1 text-gray-300 hover:text-red-400 transition-colors"
                        title="삭제"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                          <path d="M10 11v6M14 11v6"/>
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

      </div>
    </div>
  )
}
