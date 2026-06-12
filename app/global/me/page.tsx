'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/src/lib/supabase-browser'
import {
  GLOBAL_TYPE_LABEL,
  BOTTLE_CONTEXT_LABEL,
  RATING_STARS,
  RATING_LABEL,
} from '@/src/lib/global'

// 내 기록 모아보기 (§8.5) — 한 화면에 사진·코멘트·보틀 기록.
// 차트·하이라이트가 붙는 리캡 리포트는 Phase 2 (§11) — 여기선 모아보기만.

interface MyReview {
  id: string
  rating: string | null
  comment: string | null
  visited_at: string
  photo_urls: string[]
  created_at: string
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

export default function GlobalMePage() {
  const router = useRouter()
  const supabase = createClient()
  const [status, setStatus] = useState<Status>('loading')
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

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-xl mx-auto px-5 py-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/global')} className="text-gray-400 hover:text-gray-600 text-lg" aria-label="뒤로">
            ←
          </button>
          <h1 className="text-base font-bold text-gray-900">내 기록</h1>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          해외에서 남긴 보틀·잔 기록과 후기를 한곳에서 봅니다.
        </p>

        {status === 'loading' && <p className="text-sm text-gray-500 py-16 text-center">불러오는 중…</p>}

        {status === 'unauth' && (
          <div className="py-16 text-center">
            <p className="text-sm font-medium text-gray-800">로그인하면 내 기록을 모아볼 수 있습니다.</p>
            <button
              onClick={login}
              className="mt-4 px-5 py-2.5 text-xs font-bold rounded-lg text-white"
              style={{ background: 'var(--color-brand-primary)' }}
            >
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
          <div className="mt-5 space-y-7">
            {/* 보틀 / 잔 기록 */}
            <section>
              <h2 className="text-[13px] font-bold text-gray-900 mb-2">
                보틀·잔 기록 <span className="text-gray-400 font-normal">{logs.length}</span>
              </h2>
              {logs.length === 0 ? (
                <p className="text-xs text-gray-400">
                  아직 기록이 없습니다 — 장소 상세에서 구매 인증이나 후기를 남겨보세요.
                </p>
              ) : (
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {logs.map((b) => {
                    const photo = b.photo_urls?.[0] ?? b.photo_url
                    return (
                      <li key={b.id} className="border border-gray-100 rounded-xl overflow-hidden">
                        {photo && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photo} alt="" className="w-full h-28 object-cover" />
                        )}
                        <div className="px-3 py-2">
                          <p className="text-xs font-bold text-gray-800">
                            {b.product?.display_name ?? b.free_label ?? '보틀명 미상'}
                          </p>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            {BOTTLE_CONTEXT_LABEL[b.context] ?? b.context}
                            {b.price != null && ` · ${b.price} ${b.currency ?? ''}`}
                            {b.visibility === 'private' && ' · 비공개'}
                          </p>
                          <div className="flex items-center justify-between mt-1">
                            <button
                              onClick={() => b.place && router.push(`/global?place=${b.place.id}`)}
                              className="text-[11px] text-gray-400 underline"
                            >
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
              )}
            </section>

            {/* 후기 */}
            <section>
              <h2 className="text-[13px] font-bold text-gray-900 mb-2">
                후기 <span className="text-gray-400 font-normal">{reviews.length}</span>
              </h2>
              {reviews.length === 0 ? (
                <p className="text-xs text-gray-400">아직 후기가 없습니다.</p>
              ) : (
                <ul className="space-y-2.5">
                  {reviews.map((r) => (
                    <li key={r.id} className="border border-gray-100 rounded-xl px-3.5 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          onClick={() => r.place && router.push(`/global?place=${r.place.id}`)}
                          className="text-xs font-bold text-gray-900 underline"
                        >
                          {r.place?.name ?? '장소 미상'}
                          {r.place && (
                            <span className="text-gray-400 font-normal no-underline">
                              {' '}
                              ({GLOBAL_TYPE_LABEL[r.place.type] ?? r.place.type})
                            </span>
                          )}
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
                      {r.photo_urls.length > 0 && (
                        <div className="flex gap-1.5 mt-2">
                          {r.photo_urls.map((url, i) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={i} src={url} alt="" className="w-16 h-16 object-cover rounded-lg" />
                          ))}
                        </div>
                      )}
                      <div className="text-right mt-1">
                        <button onClick={() => deleteReview(r.id)} className="text-[11px] text-gray-400 hover:text-red-500 underline">
                          삭제
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Phase 2 예고 — 게이팅 안내만 (§10) */}
            <p className="text-[11px] text-gray-400">
              리캡 리포트·일정 플래너는 멤버십 기능으로 준비중입니다.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
