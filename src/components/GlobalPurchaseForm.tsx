'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import PhotoPicker from './PhotoPicker'
import { uploadGlobalPhotos } from '@/src/lib/global-upload'
import { defaultCurrency } from '@/src/lib/global'

// 구매 인증 폼 (§8.2-6) — 리쿼샵·증류소 전용.
// 보틀명은 제품 DB 자동완성(§7 약칭 검색) + 미매칭 시 입력 그대로 저장(강제 매핑 금지).

interface ProductHit {
  id: string
  display_name: string
}

export default function GlobalPurchaseForm({
  placeId,
  placeType,
  placeCountry,
  currentUser,
  onClose,
  onDone,
}: {
  placeId: string
  placeType: 'liquor_shop' | 'distillery'
  placeCountry: string
  currentUser: User
  onClose: () => void
  onDone: () => void
}) {
  const [label, setLabel] = useState('')
  const [productId, setProductId] = useState<string | null>(null)
  const [hits, setHits] = useState<ProductHit[]>([])
  const [context, setContext] = useState(
    placeType === 'liquor_shop' ? 'shop_purchase' : 'distillery_direct'
  )
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState(() => defaultCurrency(placeCountry))
  const [files, setFiles] = useState<File[]>([])
  const [loggedAt, setLoggedAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 자동완성 — 제품 선택 후에는 검색하지 않음
  useEffect(() => {
    if (productId || label.trim().length < 1) {
      setHits([])
      return
    }
    const t = setTimeout(() => {
      fetch(`/api/global/products?q=${encodeURIComponent(label.trim())}`)
        .then((r) => r.json())
        .then((j) => setHits(j.products ?? []))
        .catch(() => setHits([]))
    }, 250)
    return () => clearTimeout(t)
  }, [label, productId])

  const submit = async () => {
    setError(null)
    if (!label.trim() && !productId) {
      setError('보틀명을 입력해주세요.')
      return
    }
    setBusy(true)
    try {
      const photoUrls = files.length > 0 ? await uploadGlobalPhotos(files, currentUser.id) : []
      const res = await fetch(`/api/global/places/${placeId}/bottle-logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          product_id: productId,
          context,
          price: price || null,
          currency: price ? currency || null : null,
          photo_urls: photoUrls,
          logged_at: loggedAt,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? '저장에 실패했습니다.')
        return
      }
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/45" onClick={onClose}>
      <div
        className="bg-white w-full md:max-w-md rounded-t-2xl md:rounded-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: '88vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="text-sm font-bold text-gray-900">구매 인증</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-1" aria-label="닫기">
            ×
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-3">
          {/* 증류소: 시음 / 현장 구매 구분 (§8.3) */}
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
                  onClick={() => setContext(k)}
                  className="flex-1 py-2 text-xs font-medium rounded-lg border"
                  style={
                    context === k
                      ? { borderColor: 'var(--color-brand-primary)', color: 'var(--color-brand-primary)', background: 'rgba(191,58,33,0.06)' }
                      : { borderColor: '#e5e7eb', color: '#6b7280' }
                  }
                >
                  {l}
                </button>
              ))}
            </div>
          )}

          {/* 보틀명 + 자동완성 */}
          <div className="relative">
            <input
              value={label}
              onChange={(e) => {
                setLabel(e.target.value)
                setProductId(null)
              }}
              placeholder="보틀명 (예: 야마자키 12년, 닛프배)"
              className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2"
            />
            {productId && (
              <p className="text-[10px] mt-1" style={{ color: 'var(--color-brand-primary)' }}>
                제품 DB와 연결됨 — 표기는 정식 명칭으로 저장됩니다.
              </p>
            )}
            {hits.length > 0 && (
              <ul className="absolute left-0 right-0 top-full mt-1 z-10 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setProductId(h.id)
                        setLabel(h.display_name)
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

          {/* 가격 + 통화 */}
          <div className="flex gap-2">
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              placeholder="가격"
              className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2.5 py-2"
            />
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
              placeholder="통화"
              className="w-16 text-xs border border-gray-200 rounded-lg px-2.5 py-2 text-center"
            />
          </div>

          <PhotoPicker files={files} setFiles={setFiles} label="구매 인증 사진 (선택)" />

          <div className="flex items-center gap-2">
            <label className="text-[11px] text-gray-500 flex-shrink-0">날짜</label>
            <input
              type="date"
              value={loggedAt}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setLoggedAt(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5"
            />
          </div>

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
            {busy ? '저장 중…' : '등록'}
          </button>
        </div>
      </div>
    </div>
  )
}
