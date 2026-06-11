'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// dramndish Global(해외) — 국내 지도와 분리된 전용 페이지.
// 백엔드: global 스키마 (supabase/DRAMNDISH_README.md)
// 지도+플로팅 리스트(§8.1)는 다음 슬라이스 — 여기선 목록과 상태 처리(§9)만.

const BRAND_COLOR = '#BF3A21'

interface OverseasPlace {
  id: string
  name: string
  name_local: string | null
  type: string
  subkind: string | null
  country: string
  region: string | null
  address: string | null
  google_maps_url: string | null
  official_url: string | null
}

const TYPE_LABEL: Record<string, string> = {
  liquor_shop: '리쿼샵',
  bar: '바',
  restaurant: '음식점',
  distillery: '증류소',
}

type Status = 'loading' | 'ready' | 'empty' | 'not_ready' | 'error'

export default function GlobalPage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('loading')
  const [places, setPlaces] = useState<OverseasPlace[]>([])

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await fetch('/api/global/places')
      if (res.status === 503) {
        // global 스키마 미적용/미노출 — 일시 오류와 구분 (§9 데이터 정직성)
        setStatus('not_ready')
        return
      }
      if (!res.ok) throw new Error()
      const json = await res.json()
      const list: OverseasPlace[] = json.places ?? []
      setPlaces(list)
      setStatus(list.length === 0 ? 'empty' : 'ready')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="min-h-screen bg-white">
      {/* ── 📱 모바일 국내/해외 탑 앱바 (md 미만) — 지도 화면과 대칭 ──── */}
      <div
        className="md:hidden fixed top-0 left-0 right-0 z-30 flex bg-white border-b border-gray-100"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <button
          onClick={() => router.push('/')}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-semibold border-b-2 border-transparent transition-colors"
          style={{ opacity: 0.85, color: '#374151' }}
        >
          국내
        </button>
        <button
          className="flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-bold border-b-2 transition-colors"
          style={{ color: BRAND_COLOR, borderColor: BRAND_COLOR }}
        >
          해외
          <span
            className="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
            style={{ background: '#e5e7eb', color: '#6b7280' }}
          >
            베타 준비중
          </span>
        </button>
      </div>

      {/* ── 💻 데스크탑 국내/해외 플로팅 알약 (md 이상) ────────────────── */}
      <div
        className="hidden md:flex fixed top-4 left-1/2 -translate-x-1/2 z-50 items-center gap-0.5 rounded-full p-1 shadow-xl"
        style={{ background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(8px)' }}
      >
        <button
          onClick={() => router.push('/')}
          className="px-5 py-1.5 rounded-full text-sm font-semibold transition-all flex items-center gap-1.5"
          style={{ opacity: 0.85, color: '#374151' }}
        >
          국내
        </button>
        <button
          className="px-5 py-1.5 rounded-full text-sm font-bold transition-all shadow-sm flex items-center gap-1.5"
          style={{ background: BRAND_COLOR + '18', color: BRAND_COLOR }}
        >
          해외
          <span
            className="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
            style={{ background: '#e5e7eb', color: '#6b7280' }}
          >
            베타 준비중
          </span>
        </button>
      </div>

      {/* ── 본문 — §9 상태별 명시 렌더 ─────────────────────────────────── */}
      <main className="max-w-2xl mx-auto px-5 pb-16 pt-20 md:pt-24">
        <h1 className="text-lg font-bold text-gray-900">해외 장소</h1>
        <p className="text-xs text-gray-500 mt-1">
          위스키 여행자를 위한 해외 리쿼샵·바·증류소 정보를 준비하고 있습니다.
        </p>

        <div className="mt-6">
          {status === 'loading' && (
            <p className="text-sm text-gray-500 py-12 text-center">불러오는 중…</p>
          )}

          {status === 'not_ready' && (
            <div className="py-12 text-center">
              <p className="text-sm font-medium text-gray-800">
                해외 데이터베이스가 아직 적용되지 않았습니다.
              </p>
              <p className="text-xs text-gray-500 mt-2">
                Supabase에 global 스키마 마이그레이션을 실행하고
                Exposed schemas에 추가해야 합니다.
                (supabase/DRAMNDISH_README.md 참고)
              </p>
              <button
                onClick={load}
                className="mt-4 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700"
              >
                다시 확인
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="py-12 text-center">
              <p className="text-sm font-medium text-gray-800">일시 오류가 발생했습니다.</p>
              <button
                onClick={load}
                className="mt-4 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700"
              >
                재시도
              </button>
            </div>
          )}

          {status === 'empty' && (
            <p className="text-sm text-gray-500 py-12 text-center">
              등록된 해외 장소가 아직 없습니다.
            </p>
          )}

          {status === 'ready' && (
            <ul className="flex flex-col gap-3">
              {places.map((p) => (
                <li key={p.id} className="border border-gray-200 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-gray-900">{p.name}</span>
                    <span
                      className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                      style={{ background: '#f3f4f6', color: '#4b5563' }}
                    >
                      {TYPE_LABEL[p.type] ?? p.type}
                      {p.subkind === 'ib_shop' && ' · IB 직영점'}
                    </span>
                  </div>
                  {p.name_local && (
                    <p className="text-xs text-gray-400 mt-0.5">{p.name_local}</p>
                  )}
                  <p className="text-xs text-gray-600 mt-1.5">
                    {p.country}
                    {p.region ? ` · ${p.region}` : ''}
                    {p.address ? ` · ${p.address}` : ''}
                  </p>
                  {p.google_maps_url && (
                    <a
                      href={p.google_maps_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block text-xs font-medium mt-2 underline"
                      style={{ color: BRAND_COLOR }}
                    >
                      구글 지도에서 보기
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  )
}
