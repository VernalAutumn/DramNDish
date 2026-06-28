'use client'

import { useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/src/lib/supabase-browser'
import GlobalReviewForm from './GlobalReviewForm'
import GlobalPurchaseForm from './GlobalPurchaseForm'
import GlobalPurchaseTips from './GlobalPurchaseTips'
import GlobalDistilleryBottles from './GlobalDistilleryBottles'
import PhotoLightbox from './PhotoLightbox'
import PhotoPicker from './PhotoPicker'
import { uploadGlobalPhotos } from '@/src/lib/global-upload'
import { isAdminEmail } from '@/src/lib/admin'
import { placeEmbedSrc } from '@/src/lib/google-embed'
import {
  GlobalPlace,
  GlobalReview,
  GlobalBottleLog,
  GlobalObservation,
  GlobalPhoto,
  GLOBAL_TYPE_LABEL,
  BOTTLE_CONTEXT_LABEL,
  OBS_TYPE_LABEL,
  VALUE_BUCKET_LABEL,
  RATING_STARS,
  RATING_LABEL,
  COMPANION_LABEL,
  countryLabel,
  daysSince,
  freshnessColor,
} from '@/src/lib/global'

// 해외 장소 상세 패널 — §8.2 표시 순서.
// 작성 기능: 즐겨찾기 / 신고 / 관찰 입력 (로그인 필수, §9).
// 후기 작성 폼은 사진 업로드(Storage) 슬라이스와 함께 — 다음 단계.

interface DetailData {
  place: GlobalPlace
  reviews: GlobalReview[]
  reviewsFailed: boolean
  bottleLogs: GlobalBottleLog[]
  bottleLogsFailed: boolean
  observations: GlobalObservation[]
  observationsFailed: boolean
  photos: GlobalPhoto[]
  photosFailed: boolean
}

type Status = 'loading' | 'ready' | 'error'

function fmtBool(v: unknown, yes: string, no: string): string {
  if (v === true) return yes
  if (v === false) return no
  return '정보 없음'
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  const isEmpty = value === undefined || value === null || value === '정보 없음'
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-xs text-gray-500 flex-shrink-0">{label}</span>
      <span className={`text-xs text-right ${isEmpty ? 'text-gray-400' : 'text-gray-800 font-medium'}`}>
        {isEmpty ? '정보 없음' : value}
      </span>
    </div>
  )
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mt-5 mb-1.5">
      <h3 className="text-[13px] font-bold text-gray-900">{children}</h3>
      {right}
    </div>
  )
}

// 장소 유형별 관찰 입력에서 고를 수 있는 obs_type
// 핸드필 캐스크 잔량은 "핸드필이 있는 가게"에만 노출 —
// 리쿼샵은 attributes.has_handfill, 증류소는 attributes.handfill 이 true일 때만.
function obsOptionsFor(
  type: string,
  attrs: Record<string, unknown>
): { key: string; label: string; bucket: boolean }[] {
  const opts: { key: string; label: string; bucket: boolean }[] = []
  const hasHandfill =
    (type === 'liquor_shop' && attrs.has_handfill === true) ||
    (type === 'distillery' && attrs.handfill === true)
  if (hasHandfill) {
    opts.push({ key: 'cask_level', label: '핸드필 캐스크 잔량', bucket: true })
  }
  // 보틀 잔량(bottle_level)은 입력받지 않는다 (2026-06-13 운영 결정 — 기존 데이터 표시는 유지).
  // 가격·재고는 "재고" 하나로 통합 — 제품명/가격/수량 3필드 입력 (obs_type='stock'으로 저장).
  opts.push({ key: 'stock', label: '재고', bucket: false })
  if (type === 'distillery') {
    opts.push({ key: 'tour_info', label: '투어 정보', bucket: false })
  }
  return opts
}

export default function GlobalPlaceDetail({
  placeId,
  onClose,
}: {
  placeId: string
  onClose: () => void
}) {
  const [status, setStatus] = useState<Status>('loading')
  const [data, setData] = useState<DetailData | null>(null)
  const [copied, setCopied] = useState(false)
  const [currentUser, setCurrentUser] = useState<User | null>(null)

  // 즐겨찾기
  const [favorited, setFavorited] = useState(false)
  const [favBusy, setFavBusy] = useState(false)

  // 신고 — 장소(§8.2-2)와 후기(§8.2-8) 모두 대상
  const [reportTarget, setReportTarget] = useState<{ type: 'place' | 'review'; id: string } | null>(null)
  const [reportReason, setReportReason] = useState('')
  const [reportBusy, setReportBusy] = useState(false)
  const [reportDone, setReportDone] = useState(false)

  // 사진 확대
  const [lightbox, setLightbox] = useState<string | null>(null)

  // 사진 업로드 (설명과 함께)
  const [showPhotoForm, setShowPhotoForm] = useState(false)
  const [photoFiles, setPhotoFiles] = useState<File[]>([])
  const [photoCaption, setPhotoCaption] = useState('')
  const [photoBusy, setPhotoBusy] = useState(false)

  // 태그
  const [tags, setTags] = useState<{ id: string; label: string; count: number; mine: boolean }[]>([])
  const [newTag, setNewTag] = useState('')
  const [tagBusy, setTagBusy] = useState(false)

  // 후기 수정 (전체 재편집)
  const [editReview, setEditReview] = useState<GlobalReview | null>(null)

  // 담백한 구매 인증
  const [showPurchaseForm, setShowPurchaseForm] = useState(false)

  // 관찰 입력
  const [showObs, setShowObs] = useState(false)
  const [obsBusy, setObsBusy] = useState(false)

  // 후기 작성
  const [showReviewForm, setShowReviewForm] = useState(false)
  const [voteBusy, setVoteBusy] = useState<string | null>(null)

  const supabase = createClient()

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await fetch(`/api/global/places/${placeId}`)
      if (!res.ok) throw new Error()
      setData(await res.json())
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [placeId])

  useEffect(() => {
    load()
  }, [load])

  // 태그 (투표 후 잦은 갱신이라 별도 조회)
  const loadTags = useCallback(async () => {
    try {
      const res = await fetch(`/api/global/places/${placeId}/tags`)
      const json = await res.json()
      setTags(json.tags ?? [])
    } catch {
      /* 태그는 부가 — 실패해도 무시 */
    }
  }, [placeId])

  useEffect(() => {
    loadTags()
  }, [loadTags])

  const voteTag = useCallback(
    async (label: string) => {
      if (!currentUser) {
        alert('로그인이 필요한 기능입니다.')
        return
      }
      if (tagBusy) return
      setTagBusy(true)
      try {
        const res = await fetch(`/api/global/places/${placeId}/tags`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label }),
        })
        if (!res.ok) throw new Error()
        await loadTags()
      } catch {
        alert('태그 처리에 실패했습니다.')
      } finally {
        setTagBusy(false)
      }
    },
    [currentUser, tagBusy, placeId, loadTags]
  )

  const addTag = useCallback(async () => {
    const label = newTag.trim()
    if (!label) return
    setNewTag('')
    await voteTag(label)
  }, [newTag, voteTag])

  // 로그인 상태 + 즐겨찾기 여부
  useEffect(() => {
    let alive = true
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (alive) setCurrentUser(user)
    })
    fetch(`/api/global/places/${placeId}/favorite`)
      .then((r) => r.json())
      .then((j) => {
        if (alive) setFavorited(!!j.favorited)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [placeId, supabase])

  const copyAddress = useCallback(async (address: string) => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert('복사에 실패했습니다. 주소를 직접 선택해 주세요.')
    }
  }, [])

  const toggleFavorite = useCallback(async () => {
    if (!currentUser) {
      alert('로그인이 필요한 기능입니다.')
      return
    }
    if (favBusy) return
    setFavBusy(true)
    const next = !favorited
    setFavorited(next) // 낙관적
    try {
      const res = await fetch(`/api/global/places/${placeId}/favorite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: next ? 'add' : 'remove' }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setFavorited(!next) // 롤백
      alert('즐겨찾기 처리에 실패했습니다.')
    } finally {
      setFavBusy(false)
    }
  }, [currentUser, favBusy, favorited, placeId])

  const submitReport = useCallback(async () => {
    const reason = reportReason.trim()
    if (!reason || !reportTarget) return
    if (!currentUser) {
      alert('로그인이 필요한 기능입니다.')
      return
    }
    setReportBusy(true)
    try {
      const res = await fetch('/api/global/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type: reportTarget.type, target_id: reportTarget.id, reason }),
      })
      if (!res.ok) throw new Error()
      setReportDone(true)
      setReportReason('')
      setTimeout(() => {
        setReportTarget(null)
        setReportDone(false)
      }, 1500)
    } catch {
      alert('신고 접수에 실패했습니다.')
    } finally {
      setReportBusy(false)
    }
  }, [reportReason, reportTarget, currentUser])

  // 본인 작성물 삭제 (§8.2-6·7)
  const deleteReview = useCallback(
    async (reviewId: string) => {
      if (!confirm('이 후기를 삭제할까요? 연결된 메뉴/한 잔 기록도 함께 삭제됩니다.')) return
      try {
        const res = await fetch(`/api/global/reviews/${reviewId}`, { method: 'DELETE' })
        if (!res.ok) throw new Error()
        await load()
      } catch {
        alert('삭제에 실패했습니다.')
      }
    },
    [load]
  )

  const deleteLog = useCallback(
    async (logId: string) => {
      if (!confirm('이 구매 인증을 삭제할까요?')) return
      try {
        const res = await fetch(`/api/global/bottle-logs/${logId}`, { method: 'DELETE' })
        if (!res.ok) throw new Error()
        await load()
      } catch {
        alert('삭제에 실패했습니다.')
      }
    },
    [load]
  )

  const submitPhotos = useCallback(async () => {
    if (!currentUser || photoFiles.length === 0 || photoBusy) return
    setPhotoBusy(true)
    try {
      const urls = await uploadGlobalPhotos(photoFiles, currentUser.id)
      // 여러 장이면 같은 설명으로 각각 등록
      for (const url of urls) {
        const res = await fetch(`/api/global/places/${placeId}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, caption: photoCaption.trim() || null }),
        })
        if (!res.ok) throw new Error()
      }
      setPhotoFiles([])
      setPhotoCaption('')
      setShowPhotoForm(false)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : '사진 등록에 실패했습니다.')
    } finally {
      setPhotoBusy(false)
    }
  }, [currentUser, photoFiles, photoCaption, photoBusy, placeId, load])

  const deletePhoto = useCallback(
    async (photoId: string) => {
      if (!confirm('이 사진을 삭제할까요?')) return
      try {
        const res = await fetch(`/api/global/photos/${photoId}`, { method: 'DELETE' })
        if (!res.ok) throw new Error()
        await load()
      } catch {
        alert('삭제에 실패했습니다.')
      }
    },
    [load]
  )

  // 관리자 모더레이션 삭제 — 작성자가 아니어도 삭제(RLS 우회 API). 일반 유저에겐 버튼이 안 보임.
  const adminDelete = useCallback(
    async (type: string, id: string) => {
      if (!confirm('[관리자] 이 항목을 삭제할까요? 되돌릴 수 없습니다.')) return
      try {
        const res = await fetch(`/api/global/admin/moderate?type=${type}&id=${id}`, { method: 'DELETE' })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || '삭제 실패')
        }
        await load()
      } catch (e) {
        alert(e instanceof Error ? e.message : '삭제에 실패했습니다.')
      }
    },
    [load]
  )

  if (status === 'loading') {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-gray-500">불러오는 중…</p>
      </div>
    )
  }

  if (status === 'error' || !data) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm font-medium text-gray-800">일시 오류가 발생했습니다.</p>
        <button
          onClick={load}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700"
        >
          재시도
        </button>
      </div>
    )
  }

  const { place, reviews, bottleLogs, observations } = data
  const attrs = place.attributes ?? {}

  const rated = reviews.filter((r) => r.rating)
  const ratingCount = (k: string) => rated.filter((r) => r.rating === k).length

  // 후기 카드에 연결된 보틀 기록 (모든 context — 좋았던 메뉴/한 잔 + 구매 인증)
  const bottleLogOf = (reviewId: string) => bottleLogs.find((b) => b.review_id === reviewId)
  // 구매 인증 섹션 = 리쿼샵·증류소 구매 기록 (review 연결 여부 무관 — §8.2-6, 사용자 3번).
  //   바·식당의 좋았던 메뉴/한 잔은 후기 카드에만 표시하므로 여기서 제외.
  const PURCHASE_CONTEXTS = ['shop_purchase', 'distillery_direct', 'distillery_tasting']
  const purchaseLogs = bottleLogs.filter((b) => PURCHASE_CONTEXTS.includes(b.context))

  const onVote = async (review: GlobalReview, kind: 'helpful' | 'not_helpful') => {
    if (!currentUser) {
      alert('로그인이 필요한 기능입니다.')
      return
    }
    if (voteBusy) return
    const myVote = review.votes.find((v) => v.user_id === currentUser.id)?.vote
    setVoteBusy(review.id)
    try {
      const res = await fetch(`/api/global/reviews/${review.id}/vote`, {
        method: myVote === kind ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: myVote === kind ? undefined : JSON.stringify({ vote: kind }),
      })
      if (!res.ok) throw new Error()
      await load()
    } catch {
      alert('투표에 실패했습니다.')
    } finally {
      setVoteBusy(null)
    }
  }

  const isDistillery = place.type === 'distillery'
  const isAdmin = isAdminEmail(currentUser?.email)
  const tourPrograms = attrs.tour_programs as
    | { name?: string; type?: string; season?: string; price?: number | string; booking_required?: boolean; booking_url?: string; duration?: string; includes?: string[] }[]
    | undefined
  const onsiteOfferings = attrs.onsite_offerings as
    | { name?: string; category?: string; note?: string }[]
    | undefined

  // 바 흡연·커버차지: 큐레이션 attributes 우선, 없으면 후기 집계(방문자 보고)로 보강 (§1)
  const smReports = reviews.filter((r) => r.bar_smoking !== null)
  const cvReports = reviews.filter((r) => r.bar_cover_charge !== null)
  const barSmokingValue: React.ReactNode =
    attrs.smoking !== undefined
      ? fmtBool(attrs.smoking, '흡연 가능', '금연')
      : smReports.length > 0
        ? `후기 ${smReports.length}건 중 흡연 가능 ${smReports.filter((r) => r.bar_smoking).length}건`
        : '정보 없음'
  const barCoverValue: React.ReactNode =
    attrs.cover_charge != null
      ? String(attrs.cover_charge)
      : cvReports.length > 0
        ? `후기 ${cvReports.length}건 중 있었음 ${cvReports.filter((r) => r.bar_cover_charge).length}건`
        : '정보 없음'

  // 리쿼샵 시음·면세: 큐레이션 attributes 우선, 없으면 후기 집계(방문자 보고) — 바 방식 차용
  const tsReports = reviews.filter((r) => r.shop_had_tasting !== null)
  const tfReports = reviews.filter((r) => r.shop_tax_free !== null)
  const shopTastingValue: React.ReactNode =
    attrs.has_tasting !== undefined
      ? fmtBool(attrs.has_tasting, '가능', '불가')
      : tsReports.length > 0
        ? `후기 ${tsReports.length}건 중 가능 ${tsReports.filter((r) => r.shop_had_tasting).length}건`
        : '정보 없음'
  const shopTaxFreeValue: React.ReactNode =
    attrs.tax_free !== undefined
      ? fmtBool(attrs.tax_free, '면세 가능', '면세 불가')
      : tfReports.length > 0
        ? `후기 ${tfReports.length}건 중 가능 ${tfReports.filter((r) => r.shop_tax_free).length}건`
        : '정보 없음'

  return (
    <div className="h-full flex flex-col">
      {/* 헤더: 1. 명칭 + 분류 */}
      <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-border-default flex-shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-bold text-gray-900">{place.name}</h2>
            <span
              className="text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0"
              style={{ background: '#f3f4f6', color: '#4b5563' }}
            >
              {GLOBAL_TYPE_LABEL[place.type] ?? place.type}
              {place.subkind === 'ib_shop' && ' · IB 직영점'}
            </span>
          </div>
          {place.name_local && <p className="text-xs text-gray-400 mt-0.5">{place.name_local}</p>}
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-xl leading-none px-1 flex-shrink-0"
          aria-label="닫기"
        >
          ×
        </button>
      </div>

      <div className="overflow-y-auto px-5 pb-8 flex-1">
        {/* 2. 주소 + 신고 */}
        <div className="flex items-start justify-between gap-2 mt-3">
          <p className="text-xs text-gray-600">
            {countryLabel(place.country)}
            {place.region ? ` · ${place.region}` : ''}
            {place.address ? ` · ${place.address}` : ' · 주소 정보 없음'}
          </p>
          <button
            onClick={() => {
              if (!currentUser) {
                alert('로그인이 필요한 기능입니다.')
                return
              }
              setReportTarget({ type: 'place', id: placeId })
            }}
            className="text-[11px] text-gray-500 hover:text-red-500 border border-gray-200 rounded-md px-2 py-1 flex-shrink-0"
          >
            신고
          </button>
        </div>

        {/* 3. 즐겨찾기 + 지도보기 + 주소복사 */}
        <div className="flex gap-2 mt-3">
          <button
            onClick={toggleFavorite}
            disabled={favBusy}
            className="flex-1 py-2 text-xs font-bold rounded-lg border disabled:opacity-60"
            style={
              favorited
                ? { borderColor: 'var(--color-brand-primary)', color: 'var(--color-brand-primary)', background: 'rgba(191,58,33,0.06)' }
                : { borderColor: '#e5e7eb', color: '#374151' }
            }
          >
            {favorited ? '★ 즐겨찾기됨' : '☆ 즐겨찾기'}
          </button>
          {place.google_maps_url ? (
            <a
              href={place.google_maps_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-2 text-xs font-bold rounded-lg text-center text-white"
              style={{ background: 'var(--color-brand-primary)' }}
            >
              지도보기
            </a>
          ) : (
            <button
              disabled
              className="flex-1 py-2 text-xs font-medium rounded-lg border border-gray-200 text-gray-400 cursor-not-allowed"
            >
              지도 링크 없음
            </button>
          )}
          {place.address && (
            <button
              onClick={() => copyAddress(place.address!)}
              className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 text-gray-700"
            >
              {copied ? '복사됨!' : '주소 복사'}
            </button>
          )}
        </div>

        {/* 3.5 위치 — 무료 Embed 미니 지도 (이름으로 검색, 모바일에서도 위치 확인) */}
        {placeEmbedSrc(place) && (
          <div className="mt-3 rounded-lg overflow-hidden border border-gray-200" style={{ height: 160 }}>
            <iframe
              title="위치"
              className="w-full h-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              src={placeEmbedSrc(place)!}
            />
          </div>
        )}

        {/* 4. 재방문 의사 분포 (★ 3단 집계) */}
        <SectionTitle>재방문 의사</SectionTitle>
        {rated.length === 0 ? (
          <p className="text-xs text-gray-400">아직 평가가 없습니다.</p>
        ) : (
          <div className="space-y-1.5">
            {(
              [
                { key: 'revisit', label: '★★★ 최고' },
                { key: 'fine', label: '★★ 무난' },
                { key: 'meh', label: '★ 별로' },
              ] as const
            ).map(({ key, label }) => {
              const n = ratingCount(key)
              const pct = Math.round((n / rated.length) * 100)
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-600 w-24 flex-shrink-0">{label}</span>
                  <div className="flex-1 h-2 rounded-full bg-surface-tertiary overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--color-brand-primary)' }} />
                  </div>
                  <span className="text-[11px] text-gray-500 w-10 text-right">{n}명</span>
                </div>
              )
            })}
          </div>
        )}

        {/* 유형별 정보 (B1 개편: 공식 사이트 공통 + 타입별 핵심만) */}
        <SectionTitle>{GLOBAL_TYPE_LABEL[place.type] ?? '장소'} 정보</SectionTitle>
        <div className="divide-y divide-gray-100">
          {/* 공식 사이트 — 전 타입 공통. 증류소는 예약 필수 뱃지를 링크 옆에 유지. */}
          <InfoRow
            label="공식 사이트"
            value={
              <span className="inline-flex items-center gap-1.5">
                {place.official_url ? (
                  <a
                    href={place.official_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                    style={{ color: 'var(--color-brand-primary)' }}
                  >
                    바로가기
                  </a>
                ) : (
                  <span className="text-gray-400">정보 없음</span>
                )}
                {isDistillery && attrs.booking_required === true && (
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                    style={{ background: '#fef3c7', color: '#b45309' }}
                  >
                    예약 필수
                  </span>
                )}
              </span>
            }
          />

          {place.type === 'liquor_shop' && (
            <>
              {/* 시음·면세: 큐레이션 우선, 없으면 후기 집계 (바 방식 차용) */}
              <InfoRow label="시음" value={shopTastingValue} />
              <InfoRow label="면세" value={shopTaxFreeValue} />
            </>
          )}
          {place.type === 'bar' && (
            <>
              {/* 흡연·커버차지: 큐레이션 값 우선, 없으면 후기 집계(방문자 보고). 전문주종·제휴는 태그로 이전. */}
              <InfoRow label="흡연" value={barSmokingValue} />
              <InfoRow label="커버차지" value={barCoverValue} />
            </>
          )}
          {place.type === 'restaurant' && (
            <InfoRow
              label="타베로그"
              value={
                attrs.tabelog_url ? (
                  <a
                    href={attrs.tabelog_url as string}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                    style={{ color: 'var(--color-brand-primary)' }}
                  >
                    {attrs.tabelog_rating ? `평점 ${attrs.tabelog_rating}` : '링크'}
                  </a>
                ) : (
                  '정보 없음'
                )
              }
            />
          )}
        </div>

        {/* 증류소 한정 보틀 (B4) — 사진+제품명 등록 + 있어요/없어요·꼭사야해/굳이 교차검증 */}
        {isDistillery && (
          <>
            <SectionTitle>증류소 한정</SectionTitle>
            <GlobalDistilleryBottles placeId={place.id} currentUser={currentUser} />
          </>
        )}

        {/* 구매 팁 (방명록) — 증류소 전용 */}
        {isDistillery && (
          <>
            <SectionTitle>구매 팁</SectionTitle>
            <GlobalPurchaseTips placeId={place.id} isAdmin={isAdmin} />
          </>
        )}

        {/* distillery: 투어·현장상품·독점정보 */}
        {isDistillery && (
          <>
            <SectionTitle>투어 프로그램</SectionTitle>
            {!tourPrograms || tourPrograms.length === 0 ? (
              <p className="text-xs text-gray-400">투어 정보 없음 — 공식 사이트를 확인해 주세요.</p>
            ) : (
              <ul className="space-y-2">
                {tourPrograms.map((t, i) => (
                  <li key={i} className="border border-gray-100 rounded-lg px-3 py-2">
                    <p className="text-xs font-bold text-gray-800">{t.name ?? '이름 미상'}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {[t.type, t.season, t.duration, t.price != null ? `${t.price}` : null].filter(Boolean).join(' · ') || '상세 정보 없음'}
                      {t.booking_required && ' · 예약 필수'}
                    </p>
                    {t.includes && t.includes.length > 0 && (
                      <p className="text-[11px] text-gray-600 mt-1">
                        <span className="text-gray-400">포함</span> {t.includes.join(' · ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <SectionTitle>현장 상품·식음</SectionTitle>
            {!onsiteOfferings || onsiteOfferings.length === 0 ? (
              <p className="text-xs text-gray-400">정보 없음</p>
            ) : (
              <ul className="space-y-1">
                {onsiteOfferings.map((o, i) => (
                  <li key={i} className="text-xs text-gray-700">
                    {o.name}
                    {o.category && <span className="text-gray-400"> ({o.category})</span>}
                    {o.note && <span className="text-gray-500"> — {o.note}</span>}
                  </li>
                ))}
              </ul>
            )}

            <SectionTitle>공식·독점 정보</SectionTitle>
            {attrs.exclusive_md ? (
              <p className="text-xs text-gray-700 whitespace-pre-wrap">{attrs.exclusive_md as string}</p>
            ) : (
              <p className="text-xs text-gray-400">정보 없음</p>
            )}
          </>
        )}

        {/* 기준 병가(reference_prices) 제거: MSRP는 제품 속성이고 실거래 시세는
            관찰로 채워지며 외부(위스키베이스)가 온라인 시세를 제공 — 장소별 큐레이션은 중복. */}

        {/* 관찰 데이터 (§8.4) + 입력 — 식당은 잔량·재고·투어 개념이 없어 제외 */}
        {place.type !== 'restaurant' && (
        <>
        <SectionTitle
          right={
            <button
              onClick={() => {
                if (!currentUser) {
                  alert('로그인이 필요한 기능입니다.')
                  return
                }
                setShowObs((v) => !v)
              }}
              className="text-[11px] font-medium px-2 py-0.5 rounded-md border"
              style={{ borderColor: 'var(--color-brand-primary)', color: 'var(--color-brand-primary)' }}
            >
              {showObs ? '닫기' : '+ 관찰 추가'}
            </button>
          }
        >
          최근 관찰 (카더라)
        </SectionTitle>

        {showObs && (
          <ObservationForm
            placeId={placeId}
            placeType={place.type}
            placeAttrs={attrs}
            busy={obsBusy}
            setBusy={setObsBusy}
            onDone={() => {
              setShowObs(false)
              load()
            }}
          />
        )}

        {data.observationsFailed ? (
          <p className="text-xs text-gray-400">관찰 데이터를 불러오지 못했습니다.</p>
        ) : observations.length === 0 ? (
          <p className="text-xs text-gray-400">관찰 데이터 없음 — 다녀오셨다면 위 “관찰 추가”로 알려주세요.</p>
        ) : (
          <ul className="space-y-2">
            {observations.map((o) => {
              const days = daysSince(o.observed_at)
              return (
                <li key={o.id} className="border border-gray-100 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-gray-800">{OBS_TYPE_LABEL[o.obs_type] ?? o.obs_type}</span>
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={
                        o.verification_status === 'confirmed'
                          ? { background: '#d1fae5', color: '#047857' }
                          : { background: '#fef3c7', color: '#b45309' }
                      }
                    >
                      {o.verification_status === 'confirmed' ? '확정' : '미확정'}
                    </span>
                    {o.obs_type === 'cask_level' && <span className="text-[10px] text-gray-400">직원 말 기반 — 카더라</span>}
                  </div>
                  <p className="text-xs text-gray-700 mt-1">
                    {o.value_bucket ? (VALUE_BUCKET_LABEL[o.value_bucket] ?? o.value_bucket) : o.value_text ?? '—'}
                    {o.note && <span className="text-gray-500"> · {o.note}</span>}
                  </p>
                  <p className="text-[11px] mt-1 flex items-center gap-1.5 flex-wrap">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: freshnessColor(days) }} />
                    <span className="text-gray-500">
                      {o.observed_at} ({days === 0 ? '오늘' : `${days}일 전`})
                    </span>
                    {/* 작성자 표기 (§8.4 출처 노출) */}
                    <span className="text-gray-400">· {o.nickname ?? '익명'}</span>
                    {days >= 15 && <span className="text-red-500 font-medium">방문 전 확인 권장</span>}
                    {isAdmin && (
                      <button
                        onClick={() => adminDelete('observation', o.id)}
                        className="ml-auto text-[11px] font-semibold text-red-500 hover:text-red-700 underline"
                      >
                        관리자 삭제
                      </button>
                    )}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
        </>
        )}

        {/* 5. 태그 (§8.2-5) — 1인 1표 투표 */}
        <SectionTitle>태그</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t.id} className="inline-flex items-center">
              <button
                onClick={() => voteTag(t.label)}
                disabled={tagBusy}
                className="text-[11px] font-medium px-2.5 py-1 rounded-full border disabled:opacity-60"
                style={
                  t.mine
                    ? { borderColor: 'var(--color-brand-primary)', color: 'var(--color-brand-primary)', background: 'rgba(191,58,33,0.06)' }
                    : { borderColor: '#e5e7eb', color: '#6b7280' }
                }
              >
                {t.label} {t.count}
              </button>
              {isAdmin && (
                <button
                  onClick={() => adminDelete('tag', t.id)}
                  className="ml-0.5 w-4 h-4 rounded-full bg-red-500/80 text-white text-[9px] leading-none flex items-center justify-center"
                  title="관리자 태그 삭제"
                  aria-label="관리자 태그 삭제"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="flex gap-2 mt-2">
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTag()}
            maxLength={30}
            placeholder="태그 추가 (예: 시음 가능, SMWS)"
            className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
          />
          <button
            onClick={addTag}
            disabled={tagBusy || !newTag.trim()}
            className="px-3 py-1.5 text-xs font-bold rounded-lg text-white disabled:opacity-50"
            style={{ background: 'var(--color-brand-primary)' }}
          >
            추가
          </button>
        </div>

        {/* 6. 사진 — 설명과 함께 올리는 독립 사진 (§8.5 사진 탭) */}
        <SectionTitle
          right={
            <button
              onClick={() => {
                if (!currentUser) {
                  alert('로그인이 필요한 기능입니다.')
                  return
                }
                setShowPhotoForm((v) => !v)
              }}
              className="text-[11px] font-medium px-2 py-0.5 rounded-md border"
              style={{ borderColor: 'var(--color-brand-primary)', color: 'var(--color-brand-primary)' }}
            >
              {showPhotoForm ? '닫기' : '+ 사진'}
            </button>
          }
        >
          사진
        </SectionTitle>

        {showPhotoForm && (
          <div className="border border-gray-200 rounded-lg p-3 mb-2 bg-gray-50 space-y-2">
            <PhotoPicker files={photoFiles} setFiles={setPhotoFiles} label="사진 (최대 5장)" max={5} />
            <input
              value={photoCaption}
              onChange={(e) => setPhotoCaption(e.target.value)}
              maxLength={200}
              placeholder="간단한 설명 (선택)"
              className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
            />
            <button
              onClick={submitPhotos}
              disabled={photoBusy || photoFiles.length === 0}
              className="w-full py-2 text-xs font-bold rounded-lg text-white disabled:opacity-50"
              style={{ background: 'var(--color-brand-primary)' }}
            >
              {photoBusy ? '올리는 중…' : '사진 올리기'}
            </button>
          </div>
        )}

        {data.photosFailed ? (
          <p className="text-xs text-gray-400">사진을 불러오지 못했습니다.</p>
        ) : data.photos.length === 0 ? (
          <p className="text-xs text-gray-400">아직 사진이 없습니다.</p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {data.photos.map((p) => (
              <div key={p.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" onClick={() => setLightbox(p.url)} className="w-full h-28 object-cover rounded-lg cursor-pointer" />
                {p.caption && (
                  <p className="absolute bottom-0 inset-x-0 text-[10px] text-white bg-black/45 px-1.5 py-0.5 rounded-b-lg truncate">
                    {p.caption}
                  </p>
                )}
                {currentUser?.id === p.user_id ? (
                  <button
                    onClick={() => deletePhoto(p.id)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 text-white text-[10px] leading-none"
                    aria-label="사진 삭제"
                  >
                    ×
                  </button>
                ) : isAdmin ? (
                  <button
                    onClick={() => adminDelete('photo', p.id)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500/80 text-white text-[10px] leading-none"
                    aria-label="관리자 사진 삭제"
                    title="관리자 삭제"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {/* 6. 구매 인증 — 리쿼샵·증류소만. 후기 작성 시 함께 남긴 보틀이 여기에도 노출(§8.2-6) */}
        {(place.type === 'liquor_shop' || place.type === 'distillery') && (
        <>
        <SectionTitle
          right={
            <button
              onClick={() => {
                if (!currentUser) {
                  alert('로그인이 필요한 기능입니다.')
                  return
                }
                setShowPurchaseForm(true)
              }}
              className="text-[11px] font-medium px-2 py-0.5 rounded-md border"
              style={{ borderColor: 'var(--color-brand-primary)', color: 'var(--color-brand-primary)' }}
            >
              + 인증
            </button>
          }
        >
          구매 인증
        </SectionTitle>
        {data.bottleLogsFailed ? (
          <p className="text-xs text-gray-400">구매 인증을 불러오지 못했습니다.</p>
        ) : purchaseLogs.length === 0 ? (
          <p className="text-xs text-gray-400">구매 인증이 아직 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {purchaseLogs.map((b) => (
              <li key={b.id} className="border border-gray-100 rounded-lg px-3 py-2">
                {(b.photo_urls?.[0] ?? b.photo_url) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={b.photo_urls?.[0] ?? b.photo_url!}
                    alt=""
                    onClick={() => setLightbox(b.photo_urls?.[0] ?? b.photo_url!)}
                    className="w-full max-h-44 object-cover rounded-md mb-2 cursor-pointer"
                  />
                )}
                <p className="text-xs font-bold text-gray-800">{b.product?.display_name ?? b.free_label ?? '보틀명 미상'}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {BOTTLE_CONTEXT_LABEL[b.context] ?? b.context}
                  {b.price != null && ` · ${b.price} ${b.currency ?? ''}`}
                  {b.price != null && b.fx_to_krw != null && <span> (약 ₩{Math.round(b.price * b.fx_to_krw).toLocaleString()})</span>}
                </p>
                <div className="flex items-center justify-between mt-0.5">
                  <p className="text-[11px] text-gray-400">
                    {b.user ? (b.user.nickname ?? '익명') : '탈퇴한 사용자'} · {b.logged_at}
                  </p>
                  {currentUser?.id === b.user_id ? (
                    <button onClick={() => deleteLog(b.id)} className="text-[11px] text-gray-400 hover:text-red-500 underline">
                      삭제
                    </button>
                  ) : isAdmin ? (
                    <button onClick={() => adminDelete('bottle_log', b.id)} className="text-[11px] font-semibold text-red-500 hover:text-red-700 underline">
                      관리자 삭제
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        </>
        )}

        {/* 7. 후기 — 구글 리뷰식 노출 (공유 없음, 좋아요 대신 유용해요/유용하지않아요) */}
        <SectionTitle
          right={
            <button
              onClick={() => {
                if (!currentUser) {
                  alert('로그인이 필요한 기능입니다.')
                  return
                }
                setShowReviewForm(true)
              }}
              className="text-[11px] font-medium px-2 py-0.5 rounded-md border"
              style={{ borderColor: 'var(--color-brand-primary)', color: 'var(--color-brand-primary)' }}
            >
              + 후기 쓰기
            </button>
          }
        >
          후기
        </SectionTitle>
        {data.reviewsFailed ? (
          <p className="text-xs text-gray-400">후기를 불러오지 못했습니다.</p>
        ) : reviews.length === 0 ? (
          <p className="text-xs text-gray-400">아직 후기가 없습니다 — 첫 후기를 남겨주세요.</p>
        ) : (
          <ul className="space-y-3">
            {reviews.map((r) => {
              const fav = bottleLogOf(r.id)
              const photos = [...(r.photo_urls ?? []), ...(fav?.photo_urls ?? [])].slice(0, 4)
              const helpful = r.votes.filter((v) => v.vote === 'helpful').length
              const notHelpful = r.votes.filter((v) => v.vote === 'not_helpful').length
              const myVote = currentUser ? r.votes.find((v) => v.user_id === currentUser.id)?.vote : undefined
              return (
                <li key={r.id} className="border border-gray-100 rounded-xl px-3.5 py-3">
                  {/* 작성자 · 방문 정보 */}
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-gray-900">{r.user ? (r.user.nickname ?? '익명') : '탈퇴한 사용자'}</p>
                    <p className="text-[11px] text-gray-400">방문 {r.visited_at}</p>
                  </div>
                  {(r.rating || r.companion_type || r.party_size) && (
                    <p className="text-[11px] mt-0.5">
                      {r.rating && (
                        <span style={{ color: 'var(--color-brand-primary)' }}>
                          {'★'.repeat(RATING_STARS[r.rating])}
                          <span className="text-gray-300">{'★'.repeat(3 - RATING_STARS[r.rating])}</span>
                          <span className="text-gray-500 ml-1">{RATING_LABEL[r.rating]}</span>
                        </span>
                      )}
                      {(r.companion_type || r.party_size) && (
                        <span className="text-gray-400">
                          {r.rating && ' · '}
                          {r.companion_type ? COMPANION_LABEL[r.companion_type] : ''}
                          {/* 혼자면 인원(1) 숨김 — 중복 표기 방지 */}
                          {r.companion_type !== 'solo' && r.party_size ? ` ${r.party_size}인` : ''}
                        </span>
                      )}
                    </p>
                  )}

                  {/* 바: 방문 시 흡연·커버차지 (후기 수집값) */}
                  {(r.bar_smoking !== null || r.bar_cover_charge !== null) && (
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {r.bar_smoking !== null && (
                        <span className="mr-2">흡연 {r.bar_smoking ? '가능' : '불가'}</span>
                      )}
                      {r.bar_cover_charge !== null && (
                        <span>커버차지 {r.bar_cover_charge ? '있었음' : '없었음'}</span>
                      )}
                    </p>
                  )}

                  {/* 리쿼샵: 방문 시 시음·면세 (후기 수집값) */}
                  {(r.shop_had_tasting !== null || r.shop_tax_free !== null) && (
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {r.shop_had_tasting !== null && (
                        <span className="mr-2">시음 {r.shop_had_tasting ? '가능' : '불가'}</span>
                      )}
                      {r.shop_tax_free !== null && (
                        <span>면세 {r.shop_tax_free ? '가능' : '불가'}</span>
                      )}
                    </p>
                  )}

                  {/* 코멘트 */}
                  {r.comment && <p className="text-xs text-gray-800 mt-1.5 whitespace-pre-wrap">{r.comment}</p>}

                  {/* 사진 그리드 (후기 사진 + 좋았던 메뉴 사진) */}
                  {photos.length > 0 && (
                    <div className={`grid gap-1.5 mt-2 ${photos.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                      {photos.map((url, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={url} alt="" onClick={() => setLightbox(url)} className="w-full h-28 object-cover rounded-lg cursor-pointer" />
                      ))}
                    </div>
                  )}

                  {/* 연결된 보틀 — 좋았던 메뉴/한 잔 또는 구매 인증 (모든 context) */}
                  {fav && (
                    <p className="text-[11px] text-gray-600 mt-1.5">
                      <span className="font-medium" style={{ color: 'var(--color-brand-primary)' }}>
                        {BOTTLE_CONTEXT_LABEL[fav.context] ?? '보틀'}
                      </span>
                      {' · '}
                      {fav.product?.display_name ?? fav.free_label}
                      {fav.price != null && ` · ${fav.price} ${fav.currency ?? ''}`}
                    </p>
                  )}

                  {/* 유용해요 / 유용하지 않아요 (공유 버튼 없음) */}
                  <div className="flex gap-2 mt-2.5">
                    <button
                      onClick={() => onVote(r, 'helpful')}
                      disabled={voteBusy === r.id}
                      className="text-[11px] font-medium px-2.5 py-1 rounded-full border disabled:opacity-50"
                      style={
                        myVote === 'helpful'
                          ? { borderColor: 'var(--color-brand-primary)', color: 'var(--color-brand-primary)', background: 'rgba(191,58,33,0.06)' }
                          : { borderColor: '#e5e7eb', color: '#6b7280' }
                      }
                    >
                      👍 유용해요{helpful > 0 && ` ${helpful}`}
                    </button>
                    <button
                      onClick={() => onVote(r, 'not_helpful')}
                      disabled={voteBusy === r.id}
                      className="text-[11px] font-medium px-2.5 py-1 rounded-full border disabled:opacity-50"
                      style={
                        myVote === 'not_helpful'
                          ? { borderColor: '#6b7280', color: '#374151', background: '#f3f4f6' }
                          : { borderColor: '#e5e7eb', color: '#6b7280' }
                      }
                    >
                      👎 유용하지 않아요{notHelpful > 0 && ` ${notHelpful}`}
                    </button>
                    {currentUser?.id === r.user_id ? (
                      <span className="ml-auto flex gap-2">
                        <button
                          onClick={() => setEditReview(r)}
                          className="text-[11px] text-gray-400 hover:text-gray-700 underline"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => deleteReview(r.id)}
                          className="text-[11px] text-gray-400 hover:text-red-500 underline"
                        >
                          삭제
                        </button>
                      </span>
                    ) : (
                      <span className="ml-auto flex gap-2">
                        {isAdmin && (
                          <button
                            onClick={() => adminDelete('review', r.id)}
                            className="text-[11px] font-semibold text-red-500 hover:text-red-700 underline"
                          >
                            관리자 삭제
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (!currentUser) {
                              alert('로그인이 필요한 기능입니다.')
                              return
                            }
                            setReportTarget({ type: 'review', id: r.id })
                          }}
                          className="text-[11px] text-gray-400 hover:text-red-500 underline"
                        >
                          신고
                        </button>
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {/* 기여자 표시 (§10) */}
        <p className="text-[11px] text-gray-400 mt-6">
          {place.source === 'seed' ? '운영진이 직접 조사해 등록한 장소입니다.' : `등록: ${place.contributor ? (place.contributor.nickname ?? '익명') : '탈퇴한 사용자'}`}
        </p>
      </div>

      {/* 신고 모달 (장소/후기 공용) */}
      {reportTarget && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 px-6" onClick={() => setReportTarget(null)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            {reportDone ? (
              <p className="text-sm text-center text-gray-800 py-4">신고가 접수되었습니다. 감사합니다.</p>
            ) : (
              <>
                <h3 className="text-sm font-bold text-gray-900">{reportTarget.type === 'place' ? '장소 신고' : '후기 신고'}</h3>
                <p className="text-xs text-gray-500 mt-1">
                  {reportTarget.type === 'place'
                    ? '부적절한 정보·중복·폐업 등 사유를 적어주세요.'
                    : '부적절한 내용·광고·도배 등 사유를 적어주세요.'}
                </p>
                <textarea
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  maxLength={500}
                  rows={3}
                  className="w-full mt-3 text-xs border border-gray-200 rounded-lg p-2 resize-none"
                  placeholder="신고 사유 (1~500자)"
                />
                <div className="flex gap-2 mt-3">
                  <button onClick={() => setReportTarget(null)} className="flex-1 py-2 text-xs font-medium rounded-lg border border-gray-300 text-gray-700">
                    취소
                  </button>
                  <button
                    onClick={submitReport}
                    disabled={reportBusy || !reportReason.trim()}
                    className="flex-1 py-2 text-xs font-bold rounded-lg text-white disabled:opacity-50"
                    style={{ background: 'var(--color-brand-primary)' }}
                  >
                    {reportBusy ? '접수 중…' : '신고하기'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 담백한 구매 인증 모달 (리쿼샵·증류소) */}
      {showPurchaseForm && currentUser && (place.type === 'liquor_shop' || place.type === 'distillery') && (
        <GlobalPurchaseForm
          placeId={placeId}
          placeCountry={place.country}
          currentUser={currentUser}
          onClose={() => setShowPurchaseForm(false)}
          onDone={() => {
            setShowPurchaseForm(false)
            load()
          }}
        />
      )}

      {/* 사진 확대 */}
      {lightbox && <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />}

      {/* 후기 작성 모달 */}
      {showReviewForm && currentUser && (
        <GlobalReviewForm
          placeId={placeId}
          placeType={place.type}
          placeCountry={place.country}
          currentUser={currentUser}
          onClose={() => setShowReviewForm(false)}
          onDone={() => {
            setShowReviewForm(false)
            load()
          }}
        />
      )}

      {/* 후기 수정 모달 (전체 재편집) */}
      {editReview && currentUser && (
        <GlobalReviewForm
          placeId={placeId}
          placeType={place.type}
          placeCountry={place.country}
          currentUser={currentUser}
          editReview={editReview}
          editBottle={bottleLogOf(editReview.id)}
          onClose={() => setEditReview(null)}
          onDone={() => {
            setEditReview(null)
            load()
          }}
        />
      )}
    </div>
  )
}

// ─── 관찰 입력 폼 ───────────────────────────────────────────────────────────
function ObservationForm({
  placeId,
  placeType,
  placeAttrs,
  busy,
  setBusy,
  onDone,
}: {
  placeId: string
  placeType: string
  placeAttrs: Record<string, unknown>
  busy: boolean
  setBusy: (v: boolean) => void
  onDone: () => void
}) {
  const options = obsOptionsFor(placeType, placeAttrs)
  const [obsType, setObsType] = useState(options[0]?.key ?? 'stock')
  const [bucket, setBucket] = useState('half')
  const [valueText, setValueText] = useState('')
  // 재고(stock) 전용 3필드: 제품명 / 가격 / 수량
  const [productName, setProductName] = useState('')
  const [priceText, setPriceText] = useState('')
  const [qtyText, setQtyText] = useState('')
  const [note, setNote] = useState('')
  const [observedAt, setObservedAt] = useState(() => new Date().toISOString().slice(0, 10))

  const current = options.find((o) => o.key === obsType)
  const isBucket = current?.bucket ?? false
  const isStock = !isBucket && obsType === 'stock'

  const submit = async () => {
    if (busy) return
    let composedValue: string | null = null
    if (isStock) {
      if (!productName.trim()) {
        alert('제품 명을 입력해주세요.')
        return
      }
      if (!priceText.trim() && !qtyText.trim()) {
        alert('가격 또는 수량을 입력해주세요.')
        return
      }
      composedValue = [productName.trim(), priceText.trim(), qtyText.trim()]
        .filter(Boolean)
        .join(' · ')
    } else if (!isBucket) {
      if (!valueText.trim()) {
        alert('관찰 값을 입력해주세요.')
        return
      }
      composedValue = valueText.trim()
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/global/places/${placeId}/observations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          obs_type: obsType,
          value_bucket: isBucket ? bucket : null,
          value_text: composedValue,
          note: note.trim() || null,
          observed_at: observedAt,
        }),
      })
      if (res.status === 401) {
        alert('로그인이 필요한 기능입니다.')
        return
      }
      if (!res.ok) throw new Error()
      onDone()
    } catch {
      alert('관찰 등록에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border border-gray-200 rounded-lg p-3 mb-3 bg-gray-50 space-y-2">
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.key}
            onClick={() => setObsType(o.key)}
            className="text-[11px] font-medium px-2 py-1 rounded-full border"
            style={
              obsType === o.key
                ? { borderColor: 'var(--color-brand-primary)', color: 'var(--color-brand-primary)', background: '#fff' }
                : { borderColor: '#e5e7eb', color: '#6b7280', background: '#fff' }
            }
          >
            {o.label}
          </button>
        ))}
      </div>

      {isBucket ? (
        <div className="flex gap-1">
          {(
            [
              { k: 'plenty', l: '넉넉함' },
              { k: 'half', l: '절반' },
              { k: 'low', l: '얼마 없음' },
              { k: 'unknown', l: '모름' },
            ] as const
          ).map(({ k, l }) => (
            <button
              key={k}
              onClick={() => setBucket(k)}
              className="flex-1 text-[11px] font-medium py-1.5 rounded-lg border"
              style={
                bucket === k
                  ? { borderColor: 'var(--color-brand-primary)', color: 'var(--color-brand-primary)', background: '#fff' }
                  : { borderColor: '#e5e7eb', color: '#6b7280', background: '#fff' }
              }
            >
              {l}
            </button>
          ))}
        </div>
      ) : isStock ? (
        <div className="space-y-1.5">
          <input
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder="제품 명 (예: 야마자키 12년)"
            className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
          />
          <input
            value={priceText}
            onChange={(e) => setPriceText(e.target.value)}
            placeholder="가격 (예: 12,000엔)"
            className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
          />
          <input
            value={qtyText}
            onChange={(e) => setQtyText(e.target.value)}
            placeholder="수량 (확인 가능한 정도, 또는 직원 카더라)"
            className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
          />
        </div>
      ) : (
        <input
          value={valueText}
          onChange={(e) => setValueText(e.target.value)}
          placeholder="관찰 내용"
          className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
        />
      )}

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="메모 (선택)"
        className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
      />
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-gray-500 flex-shrink-0">관찰일</label>
        <input
          type="date"
          value={observedAt}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setObservedAt(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5"
        />
        <button
          onClick={submit}
          disabled={busy}
          className="ml-auto px-4 py-1.5 text-xs font-bold rounded-lg text-white disabled:opacity-50"
          style={{ background: 'var(--color-brand-primary)' }}
        >
          {busy ? '등록 중…' : '등록'}
        </button>
      </div>
      {obsType === 'cask_level' && (
        <p className="text-[10px] text-gray-400">※ 캐스크 잔량은 직원 말 기반 “카더라”로 표시됩니다.</p>
      )}
    </div>
  )
}
