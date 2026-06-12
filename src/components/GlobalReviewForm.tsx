'use client'

import { useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { uploadGlobalPhotos } from '@/src/lib/global-upload'
import { COMPANION_LABEL, defaultCurrency } from '@/src/lib/global'

// 후기 작성 폼 (§8.3 + 사용자 설계 2026-06-13)
//  - 리쿼샵·증류소: 국내판처럼 코멘트만 (간단 모드)
//  - 식당·바: 팝업 상세 폼
//      ★ 3단 (1성 별로 / 2성 무난 / 3성 최고)
//      1성  → 코멘트 필수("아쉬웠던 점을 적어주세요"), 사진 선택
//      2·3성 → 코멘트 필수 + 좋았던 메뉴(사진 1~2장 + 이름) 필수, 가격 입력
//      선택: 방문자 타입(혼자/친구/연인/가족)·인원·소모 비용(현지 통화)

type Rating = 'meh' | 'fine' | 'revisit'

const STAR_OPTIONS: { key: Rating; stars: string; label: string }[] = [
  { key: 'meh', stars: '★', label: '별로' },
  { key: 'fine', stars: '★★', label: '무난' },
  { key: 'revisit', stars: '★★★', label: '최고' },
]

function PhotoPicker({
  files,
  setFiles,
  label,
}: {
  files: File[]
  setFiles: (f: File[]) => void
  label: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-700">{label}</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-gray-300 text-gray-700 flex-shrink-0"
        >
          📷 사진 첨부 ({files.length}/2)
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? [])
          setFiles([...files, ...picked].slice(0, 2))
          e.target.value = ''
        }}
      />
      {files.length > 0 && (
        <div className="flex gap-2 mt-2">
          {files.map((f, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={URL.createObjectURL(f)} alt="" className="w-16 h-16 object-cover rounded-lg" />
              <button
                type="button"
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-800 text-white text-[10px] leading-none"
                aria-label="사진 제거"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
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
}: {
  placeId: string
  placeType: string
  placeCountry: string
  currentUser: User
  onClose: () => void
  onDone: () => void
}) {
  const detailed = placeType === 'restaurant' || placeType === 'bar'
  const favoriteLabel = placeType === 'bar' ? '가장 좋았던 한 잔' : '가장 좋았던 메뉴'

  const [rating, setRating] = useState<Rating | null>(null)
  const [comment, setComment] = useState('')
  const [visitedAt, setVisitedAt] = useState(() => new Date().toISOString().slice(0, 10))

  // 1성용 후기 사진 (선택)
  const [reviewFiles, setReviewFiles] = useState<File[]>([])
  // 2·3성용 좋았던 메뉴
  const [favFiles, setFavFiles] = useState<File[]>([])
  const [favName, setFavName] = useState('')
  const [favPrice, setFavPrice] = useState('')

  // 선택 입력 (자세히)
  const [showMore, setShowMore] = useState(false)
  const [companion, setCompanion] = useState<string | null>(null)
  const [partySize, setPartySize] = useState('')
  const [spend, setSpend] = useState('')
  const [currency, setCurrency] = useState(() => defaultCurrency(placeCountry))

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const good = rating === 'fine' || rating === 'revisit'

  const submit = async () => {
    setError(null)
    if (detailed && !rating) {
      setError('별점을 선택해주세요.')
      return
    }
    if (!comment.trim()) {
      setError(detailed && rating === 'meh' ? '아쉬웠던 점을 적어주세요.' : '코멘트를 입력해주세요.')
      return
    }
    if (detailed && good) {
      if (!favName.trim()) {
        setError(`${favoriteLabel} 이름을 입력해주세요.`)
        return
      }
      if (favFiles.length === 0) {
        setError(`${favoriteLabel} 사진을 1장 이상 올려주세요.`)
        return
      }
    }

    setBusy(true)
    try {
      // 1) 사진 업로드 (Storage) → URL
      const reviewUrls =
        reviewFiles.length > 0 ? await uploadGlobalPhotos(reviewFiles, currentUser.id) : []
      const favUrls =
        detailed && good && favFiles.length > 0
          ? await uploadGlobalPhotos(favFiles, currentUser.id)
          : []

      // 2) 후기 저장
      const res = await fetch(`/api/global/places/${placeId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visited_at: visitedAt,
          rating: detailed ? rating : null,
          comment: comment.trim(),
          photo_urls: reviewUrls,
          companion_type: companion,
          party_size: partySize ? Number(partySize) : null,
          spend_amount: spend ? Number(spend) : null,
          spend_currency: spend ? currency || null : null,
          favorite:
            detailed && good
              ? {
                  name: favName.trim(),
                  price: favPrice ? Number(favPrice) : undefined,
                  currency: currency || undefined,
                  photo_urls: favUrls,
                }
              : undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 401) {
        setError('로그인이 필요합니다.')
        return
      }
      if (!res.ok) {
        setError(json.error ?? '후기 저장에 실패했습니다.')
        return
      }
      if (json.warning) alert(json.warning)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : '후기 저장에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/45"
      onClick={onClose}
    >
      <div
        className="bg-white w-full md:max-w-md rounded-t-2xl md:rounded-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: '88vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="text-sm font-bold text-gray-900">후기 쓰기</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-1" aria-label="닫기">
            ×
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {/* 방문일 */}
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

          {/* ★ 3단 (식당·바) */}
          {detailed && (
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
          )}

          {/* 코멘트 */}
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder={detailed && rating === 'meh' ? '아쉬웠던 점을 적어주세요' : '후기를 남겨주세요'}
            className="w-full text-xs border border-gray-200 rounded-lg p-2.5 resize-none"
          />

          {/* 1성: 사진 선택 / 2·3성: 좋았던 메뉴 필수 */}
          {detailed && rating === 'meh' && (
            <PhotoPicker files={reviewFiles} setFiles={setReviewFiles} label="사진 첨부 (선택)" />
          )}
          {detailed && good && (
            <div className="border border-gray-200 rounded-xl p-3 space-y-2 bg-gray-50">
              <PhotoPicker files={favFiles} setFiles={setFavFiles} label={`${favoriteLabel}의 사진을 올려주세요!`} />
              <input
                value={favName}
                onChange={(e) => setFavName(e.target.value)}
                placeholder={`${favoriteLabel} 이름 (필수)`}
                className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
              />
              <div className="flex gap-2">
                <input
                  value={favPrice}
                  onChange={(e) => setFavPrice(e.target.value.replace(/[^0-9.]/g, ''))}
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
            </div>
          )}

          {/* 선택 입력 — Progressive Disclosure (§8.3) */}
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className="text-[11px] font-medium underline text-gray-500"
          >
            {showMore ? '선택 입력 접기' : '자세히 (방문자·비용 — 선택)'}
          </button>
          {showMore && (
            <div className="space-y-3">
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
                <input
                  value={partySize}
                  onChange={(e) => setPartySize(e.target.value.replace(/[^0-9]/g, ''))}
                  inputMode="numeric"
                  placeholder="인원"
                  className="w-20 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
                />
                <input
                  value={spend}
                  onChange={(e) => setSpend(e.target.value.replace(/[^0-9.]/g, ''))}
                  inputMode="decimal"
                  placeholder="소모 비용 (1인 기준)"
                  className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
                />
                <input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
                  placeholder="통화"
                  className="w-16 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 text-center"
                />
              </div>
            </div>
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
            {busy ? '저장 중…' : '후기 등록'}
          </button>
        </div>
      </div>
    </div>
  )
}
