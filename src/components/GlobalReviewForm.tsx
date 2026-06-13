'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import PhotoPicker from './PhotoPicker'
import { uploadGlobalPhotos } from '@/src/lib/global-upload'
import { COMPANION_LABEL, defaultCurrency, GlobalReview, GlobalBottleLog } from '@/src/lib/global'

// 동적 후기 폼 (작성·수정 공용).
//  [공통 필수]  별점(1~3성) + 한줄평
//  유형별 보틀 모듈·동반·비용·흡연/커버는 전부 선택.
//  editReview 가 있으면 수정 모드(PATCH) — 기존 사진은 유지/삭제, 새 사진 추가.

type Rating = 'meh' | 'fine' | 'revisit'

const STAR_OPTIONS: { key: Rating; stars: string; label: string }[] = [
  { key: 'meh', stars: '★', label: '별로' },
  { key: 'fine', stars: '★★', label: '무난' },
  { key: 'revisit', stars: '★★★', label: '최고' },
]

interface ProductHit {
  id: string
  display_name: string
}

// 기존 사진 썸네일(유지/삭제)
function ExistingPhotos({ urls, onRemove }: { urls: string[]; onRemove: (u: string) => void }) {
  if (urls.length === 0) return null
  return (
    <div className="flex gap-2 flex-wrap">
      {urls.map((u) => (
        <div key={u} className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={u} alt="" className="w-16 h-16 object-cover rounded-lg" />
          <button
            type="button"
            onClick={() => onRemove(u)}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-800 text-white text-[10px] leading-none"
            aria-label="사진 제거"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

export default function GlobalReviewForm({
  placeId,
  placeType,
  placeCountry,
  currentUser,
  onClose,
  onDone,
  editReview,
  editBottle,
}: {
  placeId: string
  placeType: string
  placeCountry: string
  currentUser: User
  onClose: () => void
  onDone: () => void
  editReview?: GlobalReview
  editBottle?: GlobalBottleLog
}) {
  const isEdit = !!editReview
  const isBar = placeType === 'bar'
  const isRestaurant = placeType === 'restaurant'
  const isShop = placeType === 'liquor_shop' || placeType === 'distillery'
  const showSpend = isBar || isRestaurant

  const bottleTitle = isBar ? '가장 좋았던 한 잔' : isRestaurant ? '가장 좋았던 메뉴' : '구매 인증'

  const [rating, setRating] = useState<Rating | null>((editReview?.rating as Rating) ?? null)
  const [comment, setComment] = useState(editReview?.comment ?? '')
  const [visitedAt, setVisitedAt] = useState(editReview?.visited_at ?? new Date().toISOString().slice(0, 10))

  // 보틀 모듈
  const [bottleName, setBottleName] = useState(editBottle?.free_label ?? editBottle?.product?.display_name ?? '')
  const [bottleProductId, setBottleProductId] = useState<string | null>(null)
  const [bottlePrice, setBottlePrice] = useState(editBottle?.price != null ? String(editBottle.price) : '')
  const [bottleFiles, setBottleFiles] = useState<File[]>([])
  const [existingBottlePhotos, setExistingBottlePhotos] = useState<string[]>(editBottle?.photo_urls ?? [])
  const [bottleContext, setBottleContext] = useState(
    editBottle?.context === 'distillery_tasting' ? 'distillery_tasting' : 'distillery_direct'
  )
  const [hits, setHits] = useState<ProductHit[]>([])

  // 분위기 사진
  const [reviewFiles, setReviewFiles] = useState<File[]>([])
  const [existingReviewPhotos, setExistingReviewPhotos] = useState<string[]>(editReview?.photo_urls ?? [])

  // 선택 입력
  const [showMore, setShowMore] = useState(false)
  const [companion, setCompanion] = useState<string | null>(editReview?.companion_type ?? null)
  const [partySize, setPartySize] = useState(editReview?.party_size != null ? String(editReview.party_size) : '')
  const [spend, setSpend] = useState('')
  const [currency, setCurrency] = useState(
    editBottle?.currency ?? defaultCurrency(placeCountry)
  )
  const [barSmoking, setBarSmoking] = useState<'yes' | 'no' | null>(
    editReview?.bar_smoking == null ? null : editReview.bar_smoking ? 'yes' : 'no'
  )
  const [barCover, setBarCover] = useState<'yes' | 'no' | null>(
    editReview?.bar_cover_charge == null ? null : editReview.bar_cover_charge ? 'yes' : 'no'
  )

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (bottleProductId || bottleName.trim().length < 1) {
      setHits([])
      return
    }
    const t = setTimeout(() => {
      fetch(`/api/global/products?q=${encodeURIComponent(bottleName.trim())}`)
        .then((r) => r.json())
        .then((j) => setHits(j.products ?? []))
        .catch(() => setHits([]))
    }, 250)
    return () => clearTimeout(t)
  }, [bottleName, bottleProductId])

  const submit = async () => {
    setError(null)
    if (!rating) {
      setError('별점을 선택해주세요.')
      return
    }
    if (!comment.trim()) {
      setError(rating === 'meh' ? '아쉬웠던 점을 적어주세요.' : '한줄평을 입력해주세요.')
      return
    }

    setBusy(true)
    try {
      const newReviewUrls = reviewFiles.length > 0 ? await uploadGlobalPhotos(reviewFiles, currentUser.id) : []
      const newBottleUrls = bottleFiles.length > 0 ? await uploadGlobalPhotos(bottleFiles, currentUser.id) : []
      const reviewUrls = [...existingReviewPhotos, ...newReviewUrls].slice(0, 5)
      const bottleUrls = [...existingBottlePhotos, ...newBottleUrls].slice(0, isShop ? 5 : 2)

      const hasBottle = !!(bottleName.trim() || bottleProductId)
      const payload = {
        visited_at: visitedAt,
        rating,
        comment: comment.trim(),
        photo_urls: reviewUrls,
        companion_type: showSpend ? companion : null,
        party_size: showSpend && companion !== 'solo' && partySize ? Number(partySize) : null,
        spend_amount: showSpend && spend ? Number(spend) : null,
        spend_currency: showSpend && spend ? currency || null : null,
        bar_smoking: isBar && barSmoking ? barSmoking === 'yes' : null,
        bar_cover_charge: isBar && barCover ? barCover === 'yes' : null,
        bottle: hasBottle
          ? {
              name: bottleName.trim() || undefined,
              product_id: bottleProductId || undefined,
              price: bottlePrice || undefined,
              currency: currency || undefined,
              photo_urls: bottleUrls,
              context: placeType === 'distillery' ? bottleContext : undefined,
            }
          : undefined,
      }

      const res = await fetch(
        isEdit ? `/api/global/reviews/${editReview!.id}` : `/api/global/places/${placeId}/reviews`,
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      const json = await res.json().catch(() => ({}))
      if (res.status === 401) {
        setError('로그인이 필요합니다.')
        return
      }
      if (!res.ok) {
        setError(json.error ?? '저장에 실패했습니다.')
        return
      }
      if (json.warning) alert(json.warning)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/45">
      <div className="bg-white w-full md:max-w-md rounded-t-2xl md:rounded-2xl shadow-2xl flex flex-col" style={{ maxHeight: '88vh' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="text-sm font-bold text-gray-900">{isEdit ? '후기 수정' : '후기 쓰기'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-1" aria-label="닫기">
            ×
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 flex-shrink-0">방문일</label>
            <input
              type="date"
              value={visitedAt}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setVisitedAt(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5"
            />
          </div>

          <div className="flex gap-2">
            {STAR_OPTIONS.map(({ key, stars, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setRating(key)}
                className="flex-1 py-2.5 rounded-xl border text-center"
                style={
                  rating === key
                    ? { borderColor: 'var(--color-brand-primary)', background: 'rgba(191,58,33,0.06)' }
                    : { borderColor: '#e5e7eb' }
                }
              >
                <span className="block text-sm" style={{ color: rating === key ? 'var(--color-brand-primary)' : '#9ca3af' }}>
                  {stars}
                </span>
                <span className="block text-[11px] font-medium text-gray-700 mt-0.5">{label}</span>
              </button>
            ))}
          </div>

          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder={rating === 'meh' ? '아쉬웠던 점을 적어주세요' : '한줄평을 남겨주세요'}
            className="w-full text-xs border border-gray-200 rounded-lg p-2.5 resize-none"
          />

          {/* 보틀 모듈 */}
          <div className="border border-gray-200 rounded-xl p-3 space-y-2 bg-gray-50">
            <p className="text-xs font-bold text-gray-700">
              {bottleTitle} <span className="text-gray-400 font-normal">(선택)</span>
            </p>

            {placeType === 'distillery' && (
              <div className="flex gap-2">
                {(
                  [
                    { k: 'distillery_direct', l: '현장 구매' },
                    { k: 'distillery_tasting', l: '시음' },
                  ] as const
                ).map(({ k, l }) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setBottleContext(k)}
                    className="flex-1 py-1.5 text-[11px] font-medium rounded-lg border"
                    style={
                      bottleContext === k
                        ? { borderColor: 'var(--color-brand-primary)', color: 'var(--color-brand-primary)', background: '#fff' }
                        : { borderColor: '#e5e7eb', color: '#6b7280', background: '#fff' }
                    }
                  >
                    {l}
                  </button>
                ))}
              </div>
            )}

            <div className="relative">
              <input
                value={bottleName}
                onChange={(e) => {
                  setBottleName(e.target.value)
                  setBottleProductId(null)
                }}
                placeholder={isShop ? '바틀명 (예: 야마자키 12년, 닛프배)' : '메뉴/한 잔 이름'}
                className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
              />
              {bottleProductId && (
                <p className="text-[10px] mt-1" style={{ color: 'var(--color-brand-primary)' }}>
                  제품 DB와 연결됨 — 정식 명칭으로 저장됩니다.
                </p>
              )}
              {hits.length > 0 && (
                <ul className="absolute left-0 right-0 top-full mt-1 z-10 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setBottleProductId(h.id)
                          setBottleName(h.display_name)
                          setHits([])
                        }}
                        className="w-full text-left text-xs px-3 py-2 hover:bg-gray-50"
                      >
                        {h.display_name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex gap-2">
              <input
                value={bottlePrice}
                onChange={(e) => setBottlePrice(e.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
                placeholder="가격"
                className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
              />
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
                placeholder="통화"
                className="w-16 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 text-center"
              />
            </div>

            <ExistingPhotos urls={existingBottlePhotos} onRemove={(u) => setExistingBottlePhotos((p) => p.filter((x) => x !== u))} />
            <PhotoPicker files={bottleFiles} setFiles={setBottleFiles} label="사진 (선택)" max={isShop ? 5 : 2} />
          </div>

          {/* 분위기 사진 */}
          <ExistingPhotos urls={existingReviewPhotos} onRemove={(u) => setExistingReviewPhotos((p) => p.filter((x) => x !== u))} />
          <PhotoPicker files={reviewFiles} setFiles={setReviewFiles} label="매장·분위기 사진 (선택)" max={5} />

          {(showSpend || isBar) && (
            <>
              <button type="button" onClick={() => setShowMore((v) => !v)} className="text-[11px] font-medium underline text-gray-500">
                {showMore ? '선택 입력 접기' : '자세히 (방문자·비용 등 — 선택)'}
              </button>
              {showMore && (
                <div className="space-y-3">
                  {showSpend && (
                    <>
                      <div>
                        <p className="text-[11px] text-gray-500 mb-1">함께 방문</p>
                        <div className="flex gap-1.5">
                          {Object.entries(COMPANION_LABEL).map(([k, l]) => (
                            <button
                              key={k}
                              type="button"
                              onClick={() => setCompanion(companion === k ? null : k)}
                              className="flex-1 text-[11px] font-medium py-1.5 rounded-lg border"
                              style={
                                companion === k
                                  ? { borderColor: 'var(--color-brand-primary)', color: 'var(--color-brand-primary)', background: '#fff' }
                                  : { borderColor: '#e5e7eb', color: '#6b7280' }
                              }
                            >
                              {l}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {companion !== 'solo' && (
                          <input
                            value={partySize}
                            onChange={(e) => setPartySize(e.target.value.replace(/[^0-9]/g, ''))}
                            inputMode="numeric"
                            placeholder="인원"
                            className="w-20 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
                          />
                        )}
                        <input
                          value={spend}
                          onChange={(e) => setSpend(e.target.value.replace(/[^0-9.]/g, ''))}
                          inputMode="decimal"
                          placeholder="1인당 소모 비용"
                          className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
                        />
                      </div>
                    </>
                  )}

                  {isBar && (
                    <div className="space-y-2">
                      {(
                        [
                          { key: 'smoking', label: '흡연', val: barSmoking, set: setBarSmoking, yes: '흡연 가능', no: '금연' },
                          { key: 'cover', label: '커버차지', val: barCover, set: setBarCover, yes: '있었음', no: '없었음' },
                        ] as const
                      ).map((row) => (
                        <div key={row.key} className="flex items-center gap-2">
                          <span className="text-[11px] text-gray-500 w-14 flex-shrink-0">{row.label}</span>
                          {(
                            [
                              { v: 'yes', l: row.yes },
                              { v: 'no', l: row.no },
                            ] as const
                          ).map(({ v, l }) => (
                            <button
                              key={v}
                              type="button"
                              onClick={() => row.set(row.val === v ? null : v)}
                              className="flex-1 text-[11px] font-medium py-1.5 rounded-lg border"
                              style={
                                row.val === v
                                  ? { borderColor: 'var(--color-brand-primary)', color: 'var(--color-brand-primary)', background: '#fff' }
                                  : { borderColor: '#e5e7eb', color: '#6b7280' }
                              }
                            >
                              {l}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex gap-2 flex-shrink-0">
          <button onClick={onClose} disabled={busy} className="flex-1 py-2.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-700">
            취소
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="flex-1 py-2.5 text-xs font-bold rounded-lg text-white disabled:opacity-50"
            style={{ background: 'var(--color-brand-primary)' }}
          >
            {busy ? '저장 중…' : isEdit ? '수정 완료' : '후기 등록'}
          </button>
        </div>
      </div>
    </div>
  )
}
