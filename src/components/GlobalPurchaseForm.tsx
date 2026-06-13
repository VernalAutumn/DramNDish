'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import PhotoPicker from './PhotoPicker'
import { uploadGlobalPhotos } from '@/src/lib/global-upload'
import { defaultCurrency } from '@/src/lib/global'

// 담백한 구매 인증 폼 — 제품명 · 가격 · 사진만. (별점·한줄평 없음)
// 후기와 별개로 산 것만 빠르게 인증. → bottle_logs (review_id 없음).

interface ProductHit {
  id: string
  display_name: string
}

export default function GlobalPurchaseForm({
  placeId,
  placeCountry,
  currentUser,
  onClose,
  onDone,
}: {
  placeId: string
  placeCountry: string
  currentUser: User
  onClose: () => void
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [productId, setProductId] = useState<string | null>(null)
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState(() => defaultCurrency(placeCountry))
  const [files, setFiles] = useState<File[]>([])
  const [hits, setHits] = useState<ProductHit[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (productId || name.trim().length < 1) {
      setHits([])
      return
    }
    const t = setTimeout(() => {
      fetch(`/api/global/products?q=${encodeURIComponent(name.trim())}`)
        .then((r) => r.json())
        .then((j) => setHits(j.products ?? []))
        .catch(() => setHits([]))
    }, 250)
    return () => clearTimeout(t)
  }, [name, productId])

  const submit = async () => {
    setError(null)
    if (!name.trim() && !productId) {
      setError('제품명을 입력해주세요.')
      return
    }
    setBusy(true)
    try {
      const photoUrls = files.length > 0 ? await uploadGlobalPhotos(files, currentUser.id) : []
      const res = await fetch(`/api/global/places/${placeId}/bottle-logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: name.trim(),
          product_id: productId,
          price: price || null,
          currency: price ? currency || null : null,
          photo_urls: photoUrls,
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
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/45">
      <div className="bg-white w-full md:max-w-md rounded-t-2xl md:rounded-2xl shadow-2xl flex flex-col" style={{ maxHeight: '88vh' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="text-sm font-bold text-gray-900">구매 인증</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-1" aria-label="닫기">
            ×
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-3">
          {/* 제품명 + 자동완성 */}
          <div className="relative">
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setProductId(null)
              }}
              placeholder="제품명 (예: 야마자키 12년, 닛프배)"
              className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2"
            />
            {productId && (
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
                        setProductId(h.id)
                        setName(h.display_name)
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
              placeholder="가격 (선택)"
              className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2.5 py-2"
            />
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
              placeholder="통화"
              className="w-16 text-xs border border-gray-200 rounded-lg px-2.5 py-2 text-center"
            />
          </div>

          {/* 사진 (최대 5장) */}
          <PhotoPicker files={files} setFiles={setFiles} label="사진 (선택)" max={5} />

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
            {busy ? '저장 중…' : '인증 등록'}
          </button>
        </div>
      </div>
    </div>
  )
}
