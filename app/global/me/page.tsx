'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/src/lib/supabase-browser'
import {
  GLOBAL_TYPE_LABEL,
  BOTTLE_CONTEXT_LABEL,
  RATING_STARS,
  RATING_LABEL,
  countryLabel,
} from '@/src/lib/global'

// 내 기록 모아보기 (§8.5) — 국내판 마이페이지 형식: 장소 | 리뷰 | 사진 | 바틀 구매.
// 차트·하이라이트가 붙는 리캡 리포트는 Phase 2 (§11).

interface MyPlace {
  id: string
  name: string
  type: string
  country: string
  region: string | null
  created_at: string
}

interface MyReview {
  id: string
  rating: string | null
  comment: string | null
  visited_at: string
  photo_urls: string[]
  place: { id: string; name: string; type: string } | null
}

interface MyLog {
  id: string
  free_label: string | null
  context: string
  price: number | null
  currency: string | null
  photo_url: string | null
  photo_urls: string[]
  logged_at: string
  visibility: string
  product: { display_name: string } | null
  place: { id: string; name: string; type: string } | null
}

type Status = 'loading' | 'unauth' | 'ready' | 'error'
type Tab = 'places' | 'reviews' | 'photos' | 'bottles'

// 구매성 기록만 "바틀 구매" 탭에 (좋았던 한 잔/메뉴는 후기 파생이라 제외)
const PURCHASE_CONTEXTS = ['shop_purchase', 'distillery_direct', 'distillery_tasting']

export default function GlobalMePage() {
  const router = useRouter()
  const supabase = createClient()
  const [status, setStatus] = useState<Status>('loading')
  const [tab, setTab] = useState<Tab>('places')
  const [places, setPlaces] = useState<MyPlace[]>([])
  const [reviews, setReviews] = useState<MyReview[]>([])
  const [logs, setLogs] = useState<MyLog[]>([])

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await fetch('/api/global/me')
      if (!res.ok) throw new Error()
      const json = await res.json()
      if (!json.authenticated) {
        setStatus('unauth')
        return
      }
      setPlaces(json.places ?? [])
      setReviews(json.reviews ?? [])
      setLogs(json.bottleLogs ?? [])
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const login = async () => {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${siteUrl}/auth/callback?next=/global/me` },
    })
  }

  // 사진 탭: 모든 사진을 출처와 함께 평탄화
  const allPhotos = useMemo(() => {
    const out: { url: string; placeId: string | null; placeName: string; date: string }[] = []
    for (const r of reviews) {
      for (const u of r.photo_urls ?? [])
        out.push({ url: u, placeId: r.place?.id ?? null, placeName: r.place?.name ?? '장소 미상', date: r.visited_at })
    }
    for (const b of logs) {
      const ph = b.photo_urls?.length ? b.photo_urls : b.photo_url ? [b.photo_url] : []
      for (const u of ph)
        out.push({ url: u, placeId: b.place?.id ?? null, placeName: b.place?.name ?? '장소 미상', date: b.logged_at })
    }
    return out
  }, [reviews, logs])

  const bottlePurchases = useMemo(
    () => logs.filter((b) => PURCHASE_CONTEXTS.includes(b.context)),
    [logs]
  )

  const deleteReview = async (id: string) => {
    if (!confirm('이 후기를 삭제할까요? 연결된 메뉴/한 잔 기록도 함께 삭제됩니다.')) return
    try {
      const res = await fetch(`/api/global/reviews/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      load()
    } catch {
      alert('삭제에 실패했습니다.')
    }
  }

  const deleteLog = async (id: string) => {
    if (!confirm('이 기록을 삭제할까요?')) return
    try {
      const res = await fetch(`/api/global/bottle-logs/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      load()
    } catch {
      alert('삭제에 실패했습니다.')
    }
  }

  const goPlace = (id: string | null) => id && router.push(`/global?place=${id}`)

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'places', label: '장소', count: places.length },
    { key: 'reviews', label: '리뷰', count: reviews.length },
    { key: 'photos', label: '사진', count: allPhotos.length },
    { key: 'bottles', label: '바틀 구매', count: bottlePurchases.length },
  ]

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-xl mx-auto px-5 py-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/global')} className="text-gray-400 hover:text-gray-600 text-lg" aria-label="뒤로">
            ←
          </button>
          <h1 className="text-base font-bold text-gray-900">내 기록</h1>
        </div>

        {status === 'loading' && <p className="text-sm text-gray-500 py-16 text-center">불러오는 중…</p>}

        {status === 'unauth' && (
          <div className="py-16 text-center">
            <p className="text-sm font-medium text-gray-800">로그인하면 내 기록을 모아볼 수 있습니다.</p>
            <button onClick={login} className="mt-4 px-5 py-2.5 text-xs font-bold rounded-lg text-white" style={{ background: 'var(--color-brand-primary)' }}>
              Google로 로그인
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="py-16 text-center">
            <p className="text-sm font-medium text-gray-800">일시 오류가 발생했습니다.</p>
            <button onClick={load} className="mt-4 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700">
              재시도
            </button>
          </div>
        )}

        {status === 'ready' && (
          <>
            {/* 4탭 (국내판 형식) */}
            <div className="flex border-b border-border-default mt-4">
              {TABS.map(({ key, label, count }) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className="flex-1 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors"
                  style={
                    tab === key
                      ? { borderColor: 'var(--color-brand-primary)', color: 'var(--color-brand-primary)' }
                      : { borderColor: 'transparent', color: '#9ca3af' }
                  }
                >
                  {label} {count > 0 && <span className="text-gray-400">{count}</span>}
                </button>
              ))}
            </div>

            <div className="mt-4">
              {/* 장소 탭 */}
              {tab === 'places' &&
                (places.length === 0 ? (
                  <Empty msg="등록한 장소가 없습니다." cta="장소 등록하기" onCta={() => router.push('/global/add')} />
                ) : (
                  <ul className="space-y-2">
                    {places.map((p) => (
                      <li key={p.id}>
                        <button onClick={() => goPlace(p.id)} className="w-full text-left border border-gray-100 rounded-xl px-3.5 py-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-gray-900">{p.name}</span>
                            <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: '#f3f4f6', color: '#4b5563' }}>
                              {GLOBAL_TYPE_LABEL[p.type] ?? p.type}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {countryLabel(p.country)}
                            {p.region ? ` · ${p.region}` : ''}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                ))}

              {/* 리뷰 탭 */}
              {tab === 'reviews' &&
                (reviews.length === 0 ? (
                  <Empty msg="작성한 리뷰가 없습니다." />
                ) : (
                  <ul className="space-y-2.5">
                    {reviews.map((r) => (
                      <li key={r.id} className="border border-gray-100 rounded-xl px-3.5 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <button onClick={() => goPlace(r.place?.id ?? null)} className="text-xs font-bold text-gray-900 underline">
                            {r.place?.name ?? '장소 미상'}
                          </button>
                          <p className="text-[11px] text-gray-400 flex-shrink-0">방문 {r.visited_at}</p>
                        </div>
                        {r.rating && (
                          <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-brand-primary)' }}>
                            {'★'.repeat(RATING_STARS[r.rating] ?? 0)}
                            <span className="text-gray-500 ml-1">{RATING_LABEL[r.rating]}</span>
                          </p>
                        )}
                        {r.comment && <p className="text-xs text-gray-800 mt-1">{r.comment}</p>}
                        <div className="text-right mt-1">
                          <button onClick={() => deleteReview(r.id)} className="text-[11px] text-gray-400 hover:text-red-500 underline">
                            삭제
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ))}

              {/* 사진 탭 */}
              {tab === 'photos' &&
                (allPhotos.length === 0 ? (
                  <Empty msg="올린 사진이 없습니다." />
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    {allPhotos.map((ph, i) => (
                      <button key={i} onClick={() => goPlace(ph.placeId)} className="relative aspect-square">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={ph.url} alt="" className="w-full h-full object-cover rounded-lg" />
                        <span className="absolute bottom-0 inset-x-0 text-[9px] text-white bg-black/40 px-1 py-0.5 rounded-b-lg truncate">
                          {ph.placeName}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}

              {/* 바틀 구매 탭 */}
              {tab === 'bottles' &&
                (bottlePurchases.length === 0 ? (
                  <Empty msg="구매 기록이 없습니다." />
                ) : (
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {bottlePurchases.map((b) => {
                      const photo = b.photo_urls?.[0] ?? b.photo_url
                      return (
                        <li key={b.id} className="border border-gray-100 rounded-xl overflow-hidden">
                          {photo && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={photo} alt="" className="w-full h-28 object-cover" />
                          )}
                          <div className="px-3 py-2">
                            <p className="text-xs font-bold text-gray-800">{b.product?.display_name ?? b.free_label ?? '보틀명 미상'}</p>
                            <p className="text-[11px] text-gray-500 mt-0.5">
                              {BOTTLE_CONTEXT_LABEL[b.context] ?? b.context}
                              {b.price != null && ` · ${b.price} ${b.currency ?? ''}`}
                            </p>
                            <div className="flex items-center justify-between mt-1">
                              <button onClick={() => goPlace(b.place?.id ?? null)} className="text-[11px] text-gray-400 underline">
                                {b.place?.name ?? '장소 미상'} · {b.logged_at}
                              </button>
                              <button onClick={() => deleteLog(b.id)} className="text-[11px] text-gray-400 hover:text-red-500 underline">
                                삭제
                              </button>
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                ))}
            </div>

            <p className="text-[11px] text-gray-400 mt-7">
              리캡 리포트·일정 플래너는 멤버십 기능으로 준비중입니다.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function Empty({ msg, cta, onCta }: { msg: string; cta?: string; onCta?: () => void }) {
  return (
    <div className="py-12 text-center">
      <p className="text-xs text-gray-400">{msg}</p>
      {cta && onCta && (
        <button onClick={onCta} className="mt-3 text-xs font-medium underline" style={{ color: 'var(--color-brand-primary)' }}>
          {cta}
        </button>
      )}
    </div>
  )
}
