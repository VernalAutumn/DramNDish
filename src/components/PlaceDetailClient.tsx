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
  type: 'payment' | 'general' | 'category' | 'corkage' | 'cover_charge'
}

interface Comment {
  id: string
  nickname: string
  content: string
  created_at: string
}

interface PlacePhoto {
  id: string
  url: string
  nickname: string
  created_at: string
}

const TYPE_LABEL: Record<string, string> = {
  whisky:     '리쿼샵',
  bar:        '바',
  restaurant: '식당',
}

const TYPE_COLOR: Record<string, string> = {
  whisky:     '#BF3A21',
  bar:        '#BF3A21',
  restaurant: '#F97316',
}

const BRAND = '#BF3A21'
const DEFAULT_PAYMENT_TAGS = ['카드', '현금', '온누리']

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">{children}</h3>
}

export default function PlaceDetailClient({
  place,
  initialTags,
}: {
  place: Place
  initialTags: Tag[]
}) {
  const typeColor = TYPE_COLOR[place.type] ?? BRAND

  // ─── 즐겨찾기 ────────────────────────────────────────────────────────────
  const [favCount,    setFavCount]    = useState(place.favorites_count ?? 0)
  const [isFavorited, setIsFavorited] = useState(false)
  const [isFaving,    setIsFaving]    = useState(false)

  // ─── 결제수단 태그 ───────────────────────────────────────────────────────
  const [paymentTags,      setPaymentTags]      = useState<Tag[]>(initialTags.filter(t => t.type === 'payment'))
  const [showPaymentInput, setShowPaymentInput] = useState(false)
  const [newPaymentLabel,  setNewPaymentLabel]  = useState('')
  const [isAddingPayment,  setIsAddingPayment]  = useState(false)
  const paymentInputRef = useRef<HTMLInputElement>(null)

  // ─── 일반 태그 ───────────────────────────────────────────────────────────
  const [tags,         setTags]         = useState<Tag[]>(initialTags.filter(t => t.type === 'general'))
  const [showTagInput, setShowTagInput] = useState(false)
  const [newTagLabel,  setNewTagLabel]  = useState('')
  const [isAddingTag,  setIsAddingTag]  = useState(false)
  const tagInputRef = useRef<HTMLInputElement>(null)

  // ─── 사진 ────────────────────────────────────────────────────────────────
  const [photos,      setPhotos]      = useState<PlacePhoto[]>([])
  const [isUploading, setIsUploading] = useState(false)

  // ─── 코멘트 ──────────────────────────────────────────────────────────────
  const [comments,        setComments]        = useState<Comment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(true)
  const [nickname,        setNickname]        = useState('')
  const [commentContent,  setCommentContent]  = useState('')
  const [isSubmitting,    setIsSubmitting]    = useState(false)
  const [myNickname,      setMyNickname]      = useState<string | null>(null)

  // ─── 특수 태그 (등록 시 기록된 정보) ────────────────────────────────────
  const corkageTag     = initialTags.find(t => t.type === 'corkage')
  const coverChargeTag = initialTags.find(t => t.type === 'cover_charge')
  const categoryTag    = initialTags.find(t => t.type === 'category')

  // ─── localStorage ────────────────────────────────────────────────────────
  useEffect(() => {
    setIsFavorited(localStorage.getItem(`favorited_${place.id}`) === 'true')
    const saved = localStorage.getItem('tastamp_nickname')
    if (saved) { setMyNickname(saved); setNickname(saved) }
  }, [place.id])

  useEffect(() => { if (showPaymentInput) paymentInputRef.current?.focus() }, [showPaymentInput])
  useEffect(() => { if (showTagInput)     tagInputRef.current?.focus()     }, [showTagInput])

  // ─── 결제수단 병합 (DB + 기본 제안) ─────────────────────────────────────
  const paymentTagsDisplay = useMemo(() => {
    const dbLabels = new Set(paymentTags.map(t => t.label))
    const suggestions = DEFAULT_PAYMENT_TAGS
      .filter(label => !dbLabels.has(label))
      .map(label => ({ id: `__pay__${label}`, label, count: 0, type: 'payment' as const }))
    return [...paymentTags.slice().sort((a, b) => b.count - a.count), ...suggestions]
  }, [paymentTags])

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
    setFavCount(c => newFaved ? c + 1 : Math.max(0, c - 1))
    localStorage.setItem(`favorited_${place.id}`, String(newFaved))
    try {
      await fetch(`/api/places/${place.id}/favorite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: newFaved ? 'add' : 'remove' }),
      })
    } catch {
      setIsFavorited(!newFaved)
      setFavCount(c => newFaved ? Math.max(0, c - 1) : c + 1)
      localStorage.setItem(`favorited_${place.id}`, String(!newFaved))
    } finally { setIsFaving(false) }
  }

  // ─── 결제수단 투표 ───────────────────────────────────────────────────────
  const handlePaymentVote = async (label: string) => {
    const existing = paymentTags.find(t => t.label === label)
    if (existing) setPaymentTags(prev => prev.map(t => t.id === existing.id ? { ...t, count: t.count + 1 } : t))
    const res = await fetch(`/api/places/${place.id}/tags`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, type: 'payment' }),
    })
    if (!res.ok) {
      if (existing) setPaymentTags(prev => prev.map(t => t.id === existing.id ? { ...t, count: t.count - 1 } : t))
      return
    }
    const data: Tag = await res.json()
    setPaymentTags(prev => {
      const inState = prev.find(t => t.label === label)
      if (inState) return prev.map(t => t.label === label ? data : t)
      return [...prev, data]
    })
  }

  // ─── 결제수단 직접 추가 ──────────────────────────────────────────────────
  const handleAddPayment = async () => {
    const label = newPaymentLabel.trim()
    if (!label || isAddingPayment) return
    setIsAddingPayment(true)
    try {
      const res  = await fetch(`/api/places/${place.id}/tags`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, type: 'payment' }),
      })
      const data = await res.json()
      if (res.ok) {
        setPaymentTags(prev => {
          const exists = prev.find(t => t.label === label)
          if (exists) return prev.map(t => t.label === label ? data : t)
          return [...prev, data]
        })
        setNewPaymentLabel(''); setShowPaymentInput(false)
      }
    } finally { setIsAddingPayment(false) }
  }

  // ─── 일반 태그 투표 ──────────────────────────────────────────────────────
  const handleTagVote = async (tag: Tag) => {
    setTags(prev => prev.map(t => t.id === tag.id ? { ...t, count: t.count + 1 } : t))
    const res = await fetch(`/api/places/${place.id}/tags`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: tag.label, type: 'general' }),
    })
    if (!res.ok) {
      setTags(prev => prev.map(t => t.id === tag.id ? { ...t, count: t.count - 1 } : t))
    } else {
      const data = await res.json()
      setTags(prev => prev.map(t => t.id === tag.id ? data : t))
    }
  }

  // ─── 일반 태그 추가 ──────────────────────────────────────────────────────
  const handleAddTag = async () => {
    const label = newTagLabel.trim()
    if (!label || isAddingTag) return
    setIsAddingTag(true)
    try {
      const res  = await fetch(`/api/places/${place.id}/tags`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, type: 'general' }),
      })
      const data = await res.json()
      if (res.ok) {
        setTags(prev => {
          const exists = prev.find(t => t.label === label)
          if (exists) return prev.map(t => t.label === label ? data : t)
          return [...prev, data]
        })
        setNewTagLabel(''); setShowTagInput(false)
      }
    } finally { setIsAddingTag(false) }
  }

  // ─── 사진 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/places/${place.id}/photos`)
      .then(r => r.json())
      .then(data => setPhotos(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [place.id])

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    formData.append('nickname', myNickname || '익명')
    setIsUploading(true)
    try {
      const res = await fetch(`/api/places/${place.id}/photos`, { method: 'POST', body: formData })
      if (!res.ok) throw new Error()
      const newPhoto = await res.json()
      setPhotos(prev => [newPhoto, ...prev])
    } catch { alert('사진 업로드 중 오류가 발생했습니다.') }
    finally { setIsUploading(false); e.target.value = '' }
  }

  // ─── 코멘트 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/places/${place.id}/comments`)
      .then(r => r.json())
      .then(data => setComments(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setCommentsLoading(false))
  }, [place.id])

  const handleSubmitComment = async () => {
    const nick    = nickname.trim()
    const content = commentContent.trim()
    if (!nick || !content || isSubmitting) return
    setIsSubmitting(true)
    // 낙관적 업데이트
    const optimistic: Comment = { id: `__opt__${Date.now()}`, nickname: nick, content, created_at: new Date().toISOString() }
    setComments(prev => [optimistic, ...prev])
    setCommentContent('')
    try {
      const res  = await fetch(`/api/places/${place.id}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nick, content }),
      })
      const data = await res.json()
      if (res.ok) {
        setComments(prev => prev.map(c => c.id === optimistic.id ? data : c))
        if (!myNickname) { localStorage.setItem('tastamp_nickname', nick); setMyNickname(nick) }
      } else {
        setComments(prev => prev.filter(c => c.id !== optimistic.id))
        setCommentContent(content)
        alert(data.error ?? '저장에 실패했습니다.')
      }
    } catch {
      setComments(prev => prev.filter(c => c.id !== optimistic.id))
      setCommentContent(content)
    } finally { setIsSubmitting(false) }
  }

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm('이 코멘트를 삭제할까요?')) return
    setComments(prev => prev.filter(c => c.id !== commentId))
    const res = await fetch(`/api/places/${place.id}/comments`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commentId }),
    })
    if (!res.ok) {
      fetch(`/api/places/${place.id}/comments`)
        .then(r => r.json()).then(data => setComments(Array.isArray(data) ? data : []))
    }
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`
  }

  const mapUrl = place.naver_place_id
    ? `https://map.naver.com/p/entry/place/${place.naver_place_id}`
    : `https://map.naver.com/v5/search/${encodeURIComponent(place.name)}`

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
        <span className="shrink-0 ml-auto px-2.5 py-0.5 rounded-full text-xs font-bold text-white"
          style={{ backgroundColor: typeColor }}>
          {TYPE_LABEL[place.type] ?? place.type}
        </span>
      </header>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-3">

        {/* ① 기본 정보 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-gray-900 leading-tight">{place.name}</h2>
              {categoryTag && (
                <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-bold text-white"
                  style={{ backgroundColor: typeColor }}>
                  {categoryTag.label}
                </span>
              )}
            </div>
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

        {/* ② 액션 버튼 */}
        <div className="grid grid-cols-2 gap-3">
          <button onClick={handleFavorite} disabled={isFaving}
            className={`flex flex-col items-center gap-1.5 rounded-2xl p-4 shadow-sm active:scale-95 transition-all disabled:opacity-60 ${isFavorited ? 'text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
            style={isFavorited ? { backgroundColor: BRAND } : {}}>
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
              fill={isFavorited ? 'white' : 'none'} stroke={isFavorited ? 'white' : BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            <span className="text-xs font-bold">즐겨찾기{favCount > 0 && <span className="ml-1 opacity-80">({favCount})</span>}</span>
          </button>
          <a href={mapUrl} target="_blank" rel="noopener noreferrer"
            className="flex flex-col items-center gap-1.5 bg-white rounded-2xl p-4 shadow-sm hover:bg-gray-50 active:scale-95 transition-all text-gray-700">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <span className="text-xs font-bold">지도 보기</span>
          </a>
        </div>

        {/* ③ 도메인 특화 정보 */}

        {/* 리쿼샵: 결제수단 */}
        {place.type === 'whisky' && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <SectionTitle>결제수단</SectionTitle>
              <button onClick={() => setShowPaymentInput(v => !v)}
                className="text-xs font-medium hover:opacity-70 transition-opacity" style={{ color: BRAND }}>
                {showPaymentInput ? '취소' : '+ 직접 추가'}
              </button>
            </div>
            {showPaymentInput && (
              <div className="flex gap-2 mb-3">
                <input ref={paymentInputRef} type="text" value={newPaymentLabel}
                  onChange={e => setNewPaymentLabel(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddPayment()}
                  placeholder="예: 지역화폐, 제로페이" maxLength={20}
                  className="flex-1 text-sm border border-gray-200 rounded-full px-3 py-1.5 outline-none focus:border-[#BF3A21] transition-colors"/>
                <button onClick={handleAddPayment} disabled={!newPaymentLabel.trim() || isAddingPayment}
                  className="px-3 py-1.5 rounded-full text-xs font-bold text-white disabled:opacity-40"
                  style={{ backgroundColor: BRAND }}>
                  {isAddingPayment ? '...' : '추가'}
                </button>
              </div>
            )}
            <p className="text-xs text-gray-400 mb-2.5">클릭하여 결제 가능 수단 등록</p>
            <div className="flex flex-wrap gap-2">
              {paymentTagsDisplay.map(tag => {
                const isInDB = !tag.id.startsWith('__pay__')
                return (
                  <button key={tag.id} onClick={() => handlePaymentVote(tag.label)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border active:scale-95 transition-all ${
                      isInDB ? 'bg-red-50 text-[#BF3A21] border-[#BF3A21] hover:opacity-80'
                             : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-[#BF3A21] hover:text-[#BF3A21] hover:bg-red-50'}`}>
                    <span>{tag.label}</span>
                    {isInDB && tag.count > 0 && <span className="opacity-60">+{tag.count}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* 식당: 콜키지 */}
        {place.type === 'restaurant' && corkageTag && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <SectionTitle>콜키지</SectionTitle>
            <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold ${
              corkageTag.label === '불가'
                ? 'bg-gray-100 text-gray-500'
                : 'bg-orange-50 text-orange-600 border border-orange-200'
            }`}>
              {corkageTag.label === '불가' ? '콜키지 불가' : `콜키지 ${corkageTag.label}`}
            </span>
          </div>
        )}

        {/* 바: 커버차지 */}
        {place.type === 'bar' && coverChargeTag && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <SectionTitle>커버차지</SectionTitle>
            <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold ${
              coverChargeTag.label.startsWith('없음')
                ? 'bg-gray-100 text-gray-500'
                : 'bg-red-50 text-[#BF3A21] border border-[#BF3A21]/30'
            }`}>
              커버차지 {coverChargeTag.label}
            </span>
          </div>
        )}

        {/* ④ 일반 태그 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <SectionTitle>태그</SectionTitle>
            <button onClick={() => setShowTagInput(v => !v)}
              className="text-xs font-medium hover:opacity-70 transition-opacity" style={{ color: BRAND }}>
              {showTagInput ? '취소' : '+ 태그 추가'}
            </button>
          </div>
          {showTagInput && (
            <div className="flex gap-2 mb-3">
              <input ref={tagInputRef} type="text" value={newTagLabel}
                onChange={e => setNewTagLabel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                placeholder="태그 입력 후 Enter" maxLength={20}
                className="flex-1 text-sm border border-gray-200 rounded-full px-3 py-1.5 outline-none focus:border-[#BF3A21] transition-colors"/>
              <button onClick={handleAddTag} disabled={!newTagLabel.trim() || isAddingTag}
                className="px-3 py-1.5 rounded-full text-xs font-bold text-white disabled:opacity-40"
                style={{ backgroundColor: BRAND }}>
                {isAddingTag ? '...' : '추가'}
              </button>
            </div>
          )}
          {sortedTags.length === 0 ? (
            <p className="text-xs text-gray-400">아직 태그가 없습니다. 첫 태그를 달아보세요!</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {sortedTags.map(tag => (
                <button key={tag.id} onClick={() => handleTagVote(tag)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border bg-red-50 text-[#BF3A21] border-[#BF3A21] hover:opacity-80 active:scale-95 transition-all">
                  <span>{tag.label}</span>
                  <span className="opacity-70">+{tag.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ⑤ 사진 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <SectionTitle>사진</SectionTitle>
          <input type="file" id="photo-upload" accept="image/*" className="hidden"
            onChange={handlePhotoUpload} disabled={isUploading}/>
          <label htmlFor="photo-upload"
            className={`w-full h-20 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer ${
              isUploading ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                          : 'border-gray-200 text-gray-400 hover:border-[#BF3A21] hover:text-[#BF3A21]'}`}>
            {isUploading ? (
              <span className="text-xs font-medium">업로드 중...</span>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                </svg>
                <span className="text-xs font-medium">사진 추가</span>
              </>
            )}
          </label>
          {photos.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-1.5">
              {photos.map(photo => (
                <div key={photo.id} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100">
                  <img src={photo.url} alt={`${photo.nickname}님의 사진`} className="w-full h-full object-cover"/>
                  <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/50 to-transparent">
                    <p className="text-[10px] text-white font-medium truncate">{photo.nickname}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ⑥ 코멘트 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <SectionTitle>한 줄 평</SectionTitle>

          {/* 작성 폼 */}
          <div className="mb-5 space-y-2">
            <input type="text" value={nickname} onChange={e => setNickname(e.target.value)}
              placeholder="닉네임" maxLength={20} disabled={!!myNickname}
              className={`w-full text-sm border rounded-xl px-3 py-2 outline-none transition-colors ${
                myNickname ? 'border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed'
                           : 'border-gray-200 focus:border-[#BF3A21]'}`}/>
            <textarea value={commentContent} onChange={e => setCommentContent(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleSubmitComment() }}
              placeholder="이 장소에 대한 코멘트를 남겨보세요 (최대 200자)"
              maxLength={200} rows={3}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none outline-none focus:border-[#BF3A21] transition-colors"/>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">{commentContent.length}/200</span>
              <button onClick={handleSubmitComment}
                disabled={!nickname.trim() || !commentContent.trim() || isSubmitting}
                className="px-4 py-1.5 rounded-full text-xs font-bold text-white disabled:opacity-40 transition-opacity"
                style={{ backgroundColor: BRAND }}>
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
                      <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
                        style={{ backgroundColor: BRAND }}>
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
                    {myNickname && c.nickname === myNickname && (
                      <button onClick={() => handleDeleteComment(c.id)}
                        className="shrink-0 p-1 text-gray-300 hover:text-red-400 transition-colors">
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

        {/* 면책 조항 */}
        <p className="text-[10px] text-gray-400 text-center px-4 pb-4 leading-relaxed">
          자세한 사항은 네이버 지도 또는 연락을 통해 직접 확인하시길 바랍니다.<br/>
          본 지도는 위치 정보만 제공하며, 이로 인한 손해를 책임지지 않습니다.
        </p>

      </div>
    </div>
  )
}
