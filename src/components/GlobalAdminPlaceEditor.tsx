'use client'

import { useState } from 'react'
import type { GlobalPlace } from '@/src/lib/global'

// 관리자 전용 장소 정보 편집 — 온/오프 토글 · 공식사이트 · 독점정보 · 투어/현장상품.
// 흡연·커버차지는 후기 집계로 변하는 값이라 여기서 제외(관리자가 손대지 않음).
// 저장은 PATCH /api/global/places/[id] (서버에서 관리자 재검증 + service-role).

const TOGGLES_BY_TYPE: Record<string, [string, string][]> = {
  distillery: [['booking_required', '예약 필수'], ['handfill', '핸드필 가능']],
  liquor_shop: [['has_tasting', '시음 가능'], ['tax_free', '면세'], ['has_handfill', '핸드필 취급']],
  bar: [['booking_required', '예약 필수']],
  restaurant: [['booking_required', '예약 필수']],
}

interface TourRow { name: string; price: string; booking_required: boolean; includes: string }
interface OfferRow { name: string; category: string; note: string }

const BRAND = 'var(--color-brand-primary)'

export default function GlobalAdminPlaceEditor({
  place,
  onClose,
  onDone,
}: {
  place: GlobalPlace
  onClose: () => void
  onDone: () => void
}) {
  const attrs = (place.attributes ?? {}) as Record<string, unknown>
  const toggleDefs = TOGGLES_BY_TYPE[place.type] ?? []
  const isDistillery = place.type === 'distillery'

  const [officialUrl, setOfficialUrl] = useState(place.official_url ?? '')
  const [exclusiveMd, setExclusiveMd] = useState((attrs.exclusive_md as string) ?? '')
  const [bools, setBools] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(toggleDefs.map(([k]) => [k, attrs[k] === true]))
  )
  const [tours, setTours] = useState<TourRow[]>(() =>
    ((attrs.tour_programs as { name?: string; price?: string | number; booking_required?: boolean; includes?: string[] }[]) ?? []).map((t) => ({
      name: t.name ?? '',
      price: t.price != null ? String(t.price) : '',
      booking_required: t.booking_required === true,
      includes: (t.includes ?? []).join(', '),
    }))
  )
  const [offers, setOffers] = useState<OfferRow[]>(() =>
    ((attrs.onsite_offerings as { name?: string; category?: string; note?: string }[]) ?? []).map((o) => ({
      name: o.name ?? '',
      category: o.category ?? '',
      note: o.note ?? '',
    }))
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const attributes: Record<string, unknown> = { ...bools }
      attributes.exclusive_md = exclusiveMd.trim() || null
      if (isDistillery) {
        attributes.tour_programs = tours
          .filter((t) => t.name.trim())
          .map((t) => ({
            name: t.name.trim(),
            ...(t.price.trim() ? { price: t.price.trim() } : {}),
            ...(t.booking_required ? { booking_required: true } : {}),
            ...(t.includes.trim()
              ? { includes: t.includes.split(',').map((s) => s.trim()).filter(Boolean) }
              : {}),
          }))
        attributes.onsite_offerings = offers
          .filter((o) => o.name.trim())
          .map((o) => ({
            name: o.name.trim(),
            ...(o.category.trim() ? { category: o.category.trim() } : {}),
            ...(o.note.trim() ? { note: o.note.trim() } : {}),
          }))
      }
      const res = await fetch(`/api/global/places/${place.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ official_url: officialUrl.trim() || null, attributes }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || '저장 실패')
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const inputCls = 'w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 outline-none focus:border-gray-400'

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/45">
      <div className="bg-white w-full md:max-w-md rounded-t-2xl md:rounded-2xl shadow-2xl flex flex-col" style={{ maxHeight: '90vh' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="text-sm font-bold text-gray-900">관리자 편집 — {place.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-1" aria-label="닫기">×</button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {/* 토글 */}
          {toggleDefs.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-700 mb-1.5">속성</p>
              <div className="flex flex-wrap gap-1.5">
                {toggleDefs.map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setBools((b) => ({ ...b, [key]: !b[key] }))}
                    className="text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors"
                    style={bools[key] ? { background: BRAND, borderColor: BRAND, color: '#fff' } : { borderColor: '#e5e7eb', color: '#6b7280' }}
                  >
                    {bools[key] ? '● ' : '○ '}{label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 공식 사이트 */}
          <div>
            <p className="text-xs font-bold text-gray-700 mb-1">공식 사이트</p>
            <input value={officialUrl} onChange={(e) => setOfficialUrl(e.target.value)} placeholder="https://..." className={inputCls} />
          </div>

          {/* 공식·독점 정보 / 예약 안내 */}
          <div>
            <p className="text-xs font-bold text-gray-700 mb-1">공식·독점 정보 / 예약 안내</p>
            <textarea value={exclusiveMd} onChange={(e) => setExclusiveMd(e.target.value)} rows={4} placeholder="예약 방법·독점 정보 등" className={inputCls} />
          </div>

          {/* 투어 프로그램 (증류소) */}
          {isDistillery && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-bold text-gray-700">투어 프로그램</p>
                <button onClick={() => setTours((t) => [...t, { name: '', price: '', booking_required: false, includes: '' }])} className="text-[11px] font-semibold" style={{ color: BRAND }}>+ 추가</button>
              </div>
              <div className="space-y-2">
                {tours.map((t, i) => (
                  <div key={i} className="border border-gray-200 rounded-lg p-2 space-y-1.5">
                    <div className="flex gap-1.5">
                      <input value={t.name} onChange={(e) => setTours((arr) => arr.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="투어 이름" className={inputCls} />
                      <button onClick={() => setTours((arr) => arr.filter((_, j) => j !== i))} className="shrink-0 w-8 rounded-lg bg-red-50 text-red-500 text-sm" aria-label="삭제">−</button>
                    </div>
                    <div className="flex gap-1.5">
                      <input value={t.price} onChange={(e) => setTours((arr) => arr.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} placeholder="요금 (예: ¥3,000 / 무료)" className={inputCls} />
                      <button onClick={() => setTours((arr) => arr.map((x, j) => (j === i ? { ...x, booking_required: !x.booking_required } : x)))} className="shrink-0 text-[11px] font-semibold px-2.5 rounded-lg border" style={t.booking_required ? { background: BRAND, borderColor: BRAND, color: '#fff' } : { borderColor: '#e5e7eb', color: '#6b7280' }}>예약필수</button>
                    </div>
                    <input value={t.includes} onChange={(e) => setTours((arr) => arr.map((x, j) => (j === i ? { ...x, includes: e.target.value } : x)))} placeholder="포함 내역 (쉼표로 구분: 테이스팅, 기념품, 구매권)" className={inputCls} />
                  </div>
                ))}
                {tours.length === 0 && <p className="text-[11px] text-gray-400">투어 없음 — “+ 추가”로 등록</p>}
              </div>
            </div>
          )}

          {/* 현장 상품·식음 (증류소) */}
          {isDistillery && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-bold text-gray-700">현장 상품·식음</p>
                <button onClick={() => setOffers((o) => [...o, { name: '', category: '', note: '' }])} className="text-[11px] font-semibold" style={{ color: BRAND }}>+ 추가</button>
              </div>
              <div className="space-y-2">
                {offers.map((o, i) => (
                  <div key={i} className="flex gap-1.5">
                    <input value={o.name} onChange={(e) => setOffers((arr) => arr.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="이름" className={inputCls} />
                    <input value={o.category} onChange={(e) => setOffers((arr) => arr.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))} placeholder="분류" className="w-20 text-xs border border-gray-200 rounded-lg px-2 py-2" />
                    <button onClick={() => setOffers((arr) => arr.filter((_, j) => j !== i))} className="shrink-0 w-8 rounded-lg bg-red-50 text-red-500 text-sm" aria-label="삭제">−</button>
                  </div>
                ))}
                {offers.length === 0 && <p className="text-[11px] text-gray-400">없음 — “+ 추가”로 등록</p>}
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex gap-2 flex-shrink-0">
          <button onClick={onClose} disabled={busy} className="flex-1 py-2.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 disabled:opacity-50">취소</button>
          <button onClick={save} disabled={busy} className="flex-1 py-2.5 text-xs font-bold rounded-lg text-white disabled:opacity-50" style={{ background: BRAND }}>{busy ? '저장 중…' : '저장'}</button>
        </div>
      </div>
    </div>
  )
}
