'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/src/lib/supabase-browser'
import type { User } from '@supabase/supabase-js'

interface Place {
  id: string
  name: string
  address: string
  type: string
  naver_place_id: string | null
  favorites_count: number | null
  district: string | null
  city: string | null
  // places 테이블 신규 컬럼
  corkage_type:  'impossible' | 'free' | 'paid' | null
  corkage_fee:   number | null
  cover_charge:  number | null
  contributor_nickname: string | null
}

interface Tag {
  id: string
  label: string
  count: number
  type: 'payment' | 'general' | 'category'
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
  const supabase  = useRef(createClient()).current

  // ─── 인증 상태 ───────────────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [loginToast,  setLoginToast]  = useState(false)

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
  const [photos,        setPhotos]        = useState<PlacePhoto[]>([])
  const [isUploading,   setIsUploading]   = useState(false)
  const [lightboxPhoto, setLightboxPhoto] = useState<PlacePhoto | null>(null)

  // ─── 코멘트 ──────────────────────────────────────────────────────────────
  const [comments,        setComments]        = useState<Comment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(true)
  const [nickname,        setNickname]        = useState('')
  const [commentContent,  setCommentContent]  = useState('')
  const [isSubmitting,    setIsSubmitting]    = useState(false)
  const [myNickname,      setMyNickname]      = useState<string | null>(null)

  // ─── 소셜 리액션 (재방문 의사) ──────────────────────────────────────────
  const [reactionCounts,   setReactionCounts]   = useState({ visit_again: 0, no_visit: 0 })
  const [myReaction,       setMyReaction]       = useState<'visit_again' | 'no_visit' | null>(null)
  const [isReacting,       setIsReacting]       = useState(false)

  // ─── 신고 (장소/댓글/사진 공용) ────────────────────────────────────────
  const [reportTarget,       setReportTarget]       = useState<{ id: string; type: 'place' | 'comment' | 'photo' } | null>(null)
  const [reportReason,       setReportReason]       = useState('')
  const [isSubmittingReport, setIsSubmittingReport] = useState(false)
  const [reportDone,         setReportDone]         = useState(false)

  const openReport = (id: string, type: 'place' | 'comment' | 'photo') => {
    setReportTarget({ id, type })
    setReportReason('')
    setReportDone(false)
  }
  const closeReport = () => { setReportTarget(null); setReportReason(''); setReportDone(false) }

  const handleSubmitReport = async () => {
    if (!reportTarget) return
    const reason = reportReason.trim()
    if (!reason) return
    setIsSubmittingReport(true)
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reported_item_id: reportTarget.id, item_type: reportTarget.type, reason }),
      })
      if (res.ok) {
        setReportDone(true)
        setReportReason('')
        setTimeout(closeReport, 1500)
      }
    } finally {
      setIsSubmittingReport(false)
    }
  }

  // ─── 카테고리 태그 (식당 대분류) ─────────────────────────────────────────
  const categoryTag = initialTags.find(t => t.type === 'category')

  // ─── localStorage (닉네임만) ─────────────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem('tastamp_nickname')
    if (saved) { setMyNickname(saved); setNickname(saved) }
  }, [place.id])

  // ─── 인증 구독 + 즐겨찾기 상태 초기화 ──────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const user = session?.user ?? null
      setCurrentUser(user)
      setAuthLoading(false)
      if (user) {
        // 로그인 유저 닉네임을 폼에 미리 세팅
        const appNick = user.user_metadata?.app_nickname as string | undefined
        if (appNick) setNickname(appNick)
        // DB에서 이 장소의 즐겨찾기 여부 조회
        const { data } = await supabase
          .from('favorites')
          .select('id')
          .eq('user_id', user.id)
          .eq('place_id', place.id)
          .maybeSingle()
        setIsFavorited(!!data)
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null
      setCurrentUser(user)
      setAuthLoading(false)
      if (!user) setIsFavorited(false)
    })
    return () => subscription.unsubscribe()
  }, [place.id, supabase])

  // ─── 리액션 초기 로드 ───────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/places/${place.id}/reactions`)
      .then(r => r.json())
      .then(data => {
        setReactionCounts({ visit_again: data.visit_again ?? 0, no_visit: data.no_visit ?? 0 })
        setMyReaction(data.my_reaction ?? null)
      })
      .catch(() => {})
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
    if (!currentUser) {
      setLoginToast(true)
      setTimeout(() => setLoginToast(false), 3500)
      return
    }
    if (isFaving) return
    setIsFaving(true)
    const newFaved = !isFavorited
    // 낙관적 업데이트
    setIsFavorited(newFaved)
    setFavCount(c => newFaved ? c + 1 : Math.max(0, c - 1))
    try {
      const res = await fetch(`/api/places/${place.id}/favorite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: newFaved ? 'add' : 'remove' }),
      })
      if (!res.ok) throw new Error()
    } catch {
      // 실패 시 롤백
      setIsFavorited(!newFaved)
      setFavCount(c => newFaved ? Math.max(0, c - 1) : c + 1)
    } finally { setIsFaving(false) }
  }

  // ─── 리액션 토글 ────────────────────────────────────────────────────────
  const handleReaction = async (type: 'visit_again' | 'no_visit') => {
    if (!currentUser) {
      setLoginToast(true)
      setTimeout(() => setLoginToast(false), 3500)
      return
    }
    if (isReacting) return
    // 같은 타입 재클릭 → 취소, 다른 타입 → 변경
    const next = myReaction === type ? null : type
    setIsReacting(true)
    // 낙관적 업데이트
    setReactionCounts(prev => {
      const updated = { ...prev }
      if (myReaction)  updated[myReaction]  = Math.max(0, updated[myReaction]  - 1)
      if (next)        updated[next]        = updated[next] + 1
      return updated
    })
    setMyReaction(next)
    try {
      const res = await fetch(`/api/places/${place.id}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reaction_type: next }),
      })
      if (!res.ok) throw new Error()
    } catch {
      // 실패 시 롤백
      setReactionCounts(prev => {
        const rolled = { ...prev }
        if (next)       rolled[next]       = Math.max(0, rolled[next]       - 1)
        if (myReaction) rolled[myReaction] = rolled[myReaction] + 1
        return rolled
      })
      setMyReaction(myReaction)
    } finally { setIsReacting(false) }
  }

  // ─── 구글 로그인 핸들러 ──────────────────────────────────────────────────
  const handleGoogleLogin = async () => {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${siteUrl}/auth/callback` },
    })
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
    // 로그인 체크 (label onClick에서 1차 차단, 여기서 2차 안전망)
    if (!currentUser) { setLoginToast(true); setTimeout(() => setLoginToast(false), 3500); e.target.value = ''; return }
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

      {/* ── 비로그인 즐겨찾기 토스트 ─────────────────────────────────────── */}
      {loginToast && (
        <div
          className="fixed bottom-8 left-1/2 z-50 flex items-center gap-3 rounded-2xl px-4 py-3 shadow-2xl"
          style={{ transform: 'translateX(-50%)', background: '#1C1412', color: '#fff', minWidth: '240px' }}
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

      {/* ── 사진 Lightbox 모달 ────────────────────────────────────────────── */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex flex-col items-center justify-center"
          onClick={() => setLightboxPhoto(null)}
        >
          {/* 닫기 버튼 */}
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors text-white"
            onClick={(e) => { e.stopPropagation(); setLightboxPhoto(null) }}
            aria-label="닫기"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>

          {/* 이미지 */}
          <img
            src={lightboxPhoto.url}
            alt={`${lightboxPhoto.nickname}님의 사진`}
            className="max-w-full max-h-full object-contain select-none"
            style={{ maxHeight: 'calc(100dvh - 96px)' }}
            onClick={(e) => e.stopPropagation()}
          />

          {/* 닉네임 */}
          <p className="mt-3 text-white/60 text-xs font-medium">
            {lightboxPhoto.nickname}
          </p>
        </div>
      )}

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
        <div className="bg-white rounded-2xl p-4">
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
            <span className="leading-snug flex-1">{place.address}</span>
            <button
              onClick={() => openReport(place.id, 'place')}
              className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-full text-label text-text-tertiary hover:text-red-400 hover:bg-red-50 transition-colors ml-1"
              title="장소 신고">
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
              </svg>
              신고
            </button>
          </div>
          {(place.city || place.district) && (
            <p className="mt-1 text-xs text-gray-400 pl-[18px]">
              {[place.city, place.district].filter(Boolean).join(' · ')}
            </p>
          )}
          {place.contributor_nickname && (
            <p className="mt-1.5 text-caption text-text-disabled pl-[18px]">
              Added by {place.contributor_nickname}
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

        {/* ③ 소셜 리액션 */}
        <div className="bg-white rounded-2xl p-4">
          <SectionTitle>재방문 의사</SectionTitle>
          <div className="flex gap-3">
            <button
              onClick={() => handleReaction('visit_again')}
              disabled={isReacting}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold border-2 transition-all active:scale-95 disabled:opacity-60 ${
                myReaction === 'visit_again'
                  ? 'text-white border-transparent'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-[#22c55e] hover:text-[#22c55e]'
              }`}
              style={myReaction === 'visit_again' ? { backgroundColor: '#22c55e', borderColor: '#22c55e' } : {}}
            >
              <span className="text-base leading-none">👍</span>
              <span>있어요{reactionCounts.visit_again > 0 && <span className="ml-1 opacity-80 font-semibold">({reactionCounts.visit_again})</span>}</span>
            </button>
            <button
              onClick={() => handleReaction('no_visit')}
              disabled={isReacting}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold border-2 transition-all active:scale-95 disabled:opacity-60 ${
                myReaction === 'no_visit'
                  ? 'text-white border-transparent'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-[#ef4444] hover:text-[#ef4444]'
              }`}
              style={myReaction === 'no_visit' ? { backgroundColor: '#ef4444', borderColor: '#ef4444' } : {}}
            >
              <span className="text-base leading-none">👎</span>
              <span>없어요{reactionCounts.no_visit > 0 && <span className="ml-1 opacity-80 font-semibold">({reactionCounts.no_visit})</span>}</span>
            </button>
          </div>
        </div>

        {/* ④ 도메인 특화 정보 */}

        {/* 리쿼샵: 결제수단 */}
        {place.type === 'whisky' && (
          <div className="bg-white rounded-2xl p-4">
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
        {place.type === 'restaurant' && place.corkage_type && (
          <div className="bg-white rounded-2xl p-4">
            <SectionTitle>콜키지</SectionTitle>
            {place.corkage_type === 'impossible' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-gray-100 text-gray-500">
                🚫 콜키지 불가
              </span>
            )}
            {place.corkage_type === 'free' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-orange-50 text-orange-600 border border-orange-200">
                🍾 콜키지 프리
              </span>
            )}
            {place.corkage_type === 'paid' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-orange-50 text-orange-600 border border-orange-200">
                🍾 {place.corkage_fee && place.corkage_fee > 0
                  ? `콜키지 병당 ${place.corkage_fee.toLocaleString()}원`
                  : '콜키지 유료'}
              </span>
            )}
          </div>
        )}

        {/* 바: 커버차지 */}
        {place.type === 'bar' && place.cover_charge != null && place.cover_charge > 0 && (
          <div className="bg-white rounded-2xl p-4">
            <SectionTitle>커버차지</SectionTitle>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-red-50 text-[#BF3A21] border border-[#BF3A21]/30">
              🎵 커버차지 {place.cover_charge.toLocaleString()}원
            </span>
          </div>
        )}

        {/* ⑤ 일반 태그 */}
        <div className="bg-white rounded-2xl p-4">
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

        {/* ⑥ 사진 */}
        <div className="bg-white rounded-2xl p-4">
          <SectionTitle>사진</SectionTitle>
          <input type="file" id="photo-upload" accept="image/*" className="hidden"
            onChange={handlePhotoUpload} disabled={isUploading}/>
          <label htmlFor="photo-upload"
            onClick={(e) => {
              if (!currentUser) { e.preventDefault(); setLoginToast(true); setTimeout(() => setLoginToast(false), 3500) }
            }}
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
                <div key={photo.id}
                  className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 cursor-pointer active:opacity-80 transition-opacity"
                  onClick={() => setLightboxPhoto(photo)}
                >
                  <img src={photo.url} alt={`${photo.nickname}님의 사진`} className="w-full h-full object-cover"/>
                  <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/50 to-transparent flex items-end justify-between">
                    <p className="text-[11px] text-white font-medium truncate">{photo.nickname}</p>
                    <button
                      onClick={e => { e.stopPropagation(); openReport(photo.id, 'photo') }}
                      className="shrink-0 p-1 text-white/60 hover:text-red-300 transition-colors"
                      title="사진 신고">
                      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ⑦ 코멘트 */}
        <div className="bg-white rounded-2xl p-4">
          <SectionTitle>한 줄 평</SectionTitle>

          {/* 작성 폼 */}
          <div className="mb-5 space-y-2">
            {/* 닉네임: 인증 확인 중 숨김 / 로그인 유저는 배지 / 비로그인은 입력 */}
            {!authLoading && (
              currentUser ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0"
                    style={{ backgroundColor: BRAND }}>
                    {((currentUser.user_metadata?.app_nickname as string | undefined) || '?')[0].toUpperCase()}
                  </div>
                  <span className="text-xs text-gray-600 font-medium">
                    {(currentUser.user_metadata?.app_nickname as string | undefined) || '익명'}
                  </span>
                  <span className="text-[11px] text-gray-400 ml-auto">로그인된 계정으로 등록됩니다</span>
                </div>
              ) : (
                <input type="text" value={nickname} onChange={e => setNickname(e.target.value)}
                  placeholder="닉네임" maxLength={20} disabled={!!myNickname}
                  className={`w-full text-sm border rounded-xl px-3 py-2 outline-none transition-colors ${
                    myNickname ? 'border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed'
                               : 'border-gray-200 focus:border-[#BF3A21]'}`}/>
              )
            )}
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
                          <span className="text-[11px] text-gray-400">{formatDate(c.created_at)}</span>
                        </div>
                        <p className="text-sm text-gray-700 mt-0.5 leading-snug break-words">{c.content}</p>
                      </div>
                    </div>
                    {c.nickname !== myNickname && (
                      <button onClick={() => openReport(c.id, 'comment')}
                        className="shrink-0 p-1.5 text-text-disabled hover:text-red-400 transition-colors"
                        title="댓글 신고">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
                        </svg>
                      </button>
                    )}
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
        <p className="text-[11px] text-gray-400 text-center px-4 pb-6 leading-relaxed">
          자세한 사항은 네이버 지도 또는 연락을 통해 직접 확인하시길 바랍니다.<br/>
          본 지도는 위치 정보만 제공하며, 이로 인한 손해를 책임지지 않습니다.
        </p>

        {/* 신고 모달 (장소/댓글/사진 공용) */}
        {reportTarget && (
          <div className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center"
            onClick={closeReport}>
            <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl p-6 mx-0 sm:mx-4"
              onClick={e => e.stopPropagation()}>
              {reportDone ? (
                <div className="text-center py-4">
                  <p className="text-2xl mb-2">✅</p>
                  <p className="text-sm font-semibold text-gray-700">신고가 접수되었습니다.</p>
                  <p className="text-xs text-gray-400 mt-1">검토 후 조치하겠습니다.</p>
                </div>
              ) : (
                <>
                  <h3 className="text-sm font-bold text-gray-800 mb-1">
                    {{ place: '장소', comment: '댓글', photo: '사진' }[reportTarget.type]} 신고
                  </h3>
                  <p className="text-xs text-gray-400 mb-3">잘못된 정보나 부적절한 내용을 신고해주세요.</p>
                  <textarea
                    value={reportReason}
                    onChange={e => setReportReason(e.target.value)}
                    maxLength={500}
                    rows={4}
                    placeholder="신고 사유를 입력해 주세요 (최대 500자)"
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none outline-none focus:border-[#BF3A21] transition-colors"
                  />
                  <div className="flex items-center justify-between mt-1 mb-4">
                    <span className="text-xs text-gray-400">{reportReason.length}/500</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={closeReport}
                      className="flex-1 py-2 rounded-full text-xs font-bold text-gray-500 border border-gray-200 hover:bg-gray-50 transition-colors">
                      취소
                    </button>
                    <button
                      onClick={handleSubmitReport}
                      disabled={!reportReason.trim() || isSubmittingReport}
                      className="flex-1 py-2 rounded-full text-xs font-bold text-white disabled:opacity-40 transition-opacity"
                      style={{ backgroundColor: BRAND }}>
                      {isSubmittingReport ? '제출 중...' : '신고 제출'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
