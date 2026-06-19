'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/src/lib/supabase-browser'
import PhotoLightbox from './PhotoLightbox'
import DeleteAccountButton from './DeleteAccountButton'
import {
  GLOBAL_TYPE_LABEL,
  BOTTLE_CONTEXT_LABEL,
  RATING_STARS,
  RATING_LABEL,
  countryLabel,
} from '@/src/lib/global'

// 내 기록 모아보기 (§8.5) — 국내판 마이페이지 형식 4탭: 장소 | 리뷰 | 사진 | 바틀 구매.
// /global/me 페이지와 탐색 화면 오른쪽 플로팅 패널에서 공용.

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
interface MyPhoto {
  id: string
  url: string
  caption: string | null
  place: { id: string; name: string; type: string } | null
}

type Status = 'loading' | 'unauth' | 'ready' | 'error'
type Tab = 'places' | 'reviews' | 'photos' | 'bottles'

const PURCHASE_CONTEXTS = ['shop_purchase', 'distillery_direct', 'distillery_tasting']

export default function GlobalMyRecords({
  onPlaceClick,
  onAddPlace,
  onClose,
  collapsed = false,
  onToggle,
}: {
  onPlaceClick?: (id: string) => void
  onAddPlace?: () => void
  onClose?: () => void
  collapsed?: boolean // 데스크탑: 접힌 상태(계정 헤더만)
  onToggle?: () => void
}) {
  const supabase = createClient()
  const [status, setStatus] = useState<Status>('loading')
  const [tab, setTab] = useState<Tab>('places')
  const [places, setPlaces] = useState<MyPlace[]>([])
  const [reviews, setReviews] = useState<MyReview[]>([])
  const [logs, setLogs] = useState<MyLog[]>([])
  const [photos, setPhotos] = useState<MyPhoto[]>([])
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [nickname, setNickname] = useState<string | null>(null)
  const [authed, setAuthed] = useState(false)

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
      setPhotos(json.photos ?? [])
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [])

  // 계정(닉네임)은 접힘 헤더에 항상 표시 — 데이터는 펼쳤을 때만 로드
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user
      setAuthed(!!u)
      setNickname(
        (u?.user_metadata?.app_nickname as string | undefined)?.trim() ||
          u?.email?.split('@')[0] ||
          null
      )
    })
  }, [supabase])

  useEffect(() => {
    if (!collapsed) load()
  }, [load, collapsed])

  const login = async () => {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${siteUrl}/auth/callback?next=/global` },
    })
  }

  const allPhotos = useMemo(() => {
    const out: { url: string; placeId: string | null; placeName: string; caption: string | null }[] = []
    // 독립 사진(설명 포함) 먼저
    for (const p of photos)
      out.push({ url: p.url, placeId: p.place?.id ?? null, placeName: p.place?.name ?? '장소 미상', caption: p.caption })
    for (const r of reviews)
      for (const u of r.photo_urls ?? [])
        out.push({ url: u, placeId: r.place?.id ?? null, placeName: r.place?.name ?? '장소 미상', caption: null })
    for (const b of logs) {
      const ph = b.photo_urls?.length ? b.photo_urls : b.photo_url ? [b.photo_url] : []
      for (const u of ph)
        out.push({ url: u, placeId: b.place?.id ?? null, placeName: b.place?.name ?? '장소 미상', caption: null })
    }
    return out
  }, [reviews, logs, photos])

  const bottlePurchases = useMemo(() => logs.filter((b) => PURCHASE_CONTEXTS.includes(b.context)), [logs])

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

  const goPlace = (id: string | null) => {
    if (!id) return
    onPlaceClick?.(id)
  }

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'places', label: '장소', count: places.length },
    { key: 'reviews', label: '리뷰', count: reviews.length },
    { key: 'photos', label: '사진', count: allPhotos.length },
    { key: 'bottles', label: '바틀 구매', count: bottlePurchases.length },
  ]

  // 계정 헤더 (접힘·펼침 공통) — 국내판 마이페이지 패턴
  const avatar = (
    <div
      className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0"
      style={{ background: 'var(--color-brand-primary)' }}
    >
      {nickname ? nickname[0].toUpperCase() : '?'}
    </div>
  )
  const chevron = (up: boolean) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" className="flex-shrink-0">
      <path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )

  // ── 접힌 상태: 계정 헤더만 (기본값, 데스크탑) ──
  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        className="w-full self-start flex items-center gap-3 px-4 py-3 bg-white rounded-2xl shadow-xl"
      >
        {avatar}
        <div className="flex-1 text-left min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">
            {authed ? (nickname ?? '내 기록') : '로그인이 필요합니다'}
          </p>
          <p className="text-[11px] text-gray-400">마이페이지</p>
        </div>
        {chevron(false)}
      </button>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* 계정 헤더 */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border-default flex-shrink-0">
        {avatar}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">
            {authed ? (nickname ?? '내 기록') : '로그인이 필요합니다'}
          </p>
          <p className="text-[11px] text-gray-400">마이페이지</p>
        </div>
        {onToggle ? (
          <button onClick={onToggle} aria-label="접기" className="px-1">
            {chevron(true)}
          </button>
        ) : (
          onClose && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-1" aria-label="닫기">
              ×
            </button>
          )
        )}
      </div>

      {status === 'loading' && <p className="text-sm text-gray-500 py-16 text-center">불러오는 중…</p>}

      {status === 'unauth' && (
        <div className="py-16 text-center px-5">
          <p className="text-sm font-medium text-gray-800">로그인하면 내 기록을 모아볼 수 있습니다.</p>
          <button onClick={login} className="mt-4 px-5 py-2.5 text-xs font-bold rounded-lg text-white" style={{ background: 'var(--color-brand-primary)' }}>
            Google로 로그인
          </button>
        </div>
      )}

      {status === 'error' && (
        <div className="py-16 text-center px-5">
          <p className="text-sm font-medium text-gray-800">일시 오류가 발생했습니다.</p>
          <button onClick={load} className="mt-4 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700">
            재시도
          </button>
        </div>
      )}

      {status === 'ready' && (
        <>
          {/* 4탭 */}
          <div className="flex border-b border-border-default flex-shrink-0">
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

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {tab === 'places' &&
              (places.length === 0 ? (
                <Empty msg="등록한 장소가 없습니다." cta="장소 등록하기" onCta={onAddPlace} />
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
                      {r.photo_urls.length > 0 && (
                        <div className="flex gap-1.5 mt-2">
                          {r.photo_urls.map((url, i) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={i} src={url} alt="" onClick={() => setLightbox(url)} className="w-16 h-16 object-cover rounded-lg cursor-pointer" />
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
              ))}

            {tab === 'photos' &&
              (allPhotos.length === 0 ? (
                <Empty msg="올린 사진이 없습니다." />
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {allPhotos.map((ph, i) => (
                    <button key={i} onClick={() => setLightbox(ph.url)} className="relative aspect-square">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ph.url} alt="" className="w-full h-full object-cover rounded-lg" />
                      <span className="absolute bottom-0 inset-x-0 text-[9px] text-white bg-black/40 px-1 py-0.5 rounded-b-lg truncate">
                        {ph.caption || ph.placeName}
                      </span>
                    </button>
                  ))}
                </div>
              ))}

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
                          <img src={photo} alt="" onClick={() => setLightbox(photo)} className="w-full h-28 object-cover cursor-pointer" />
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

            <p className="text-[11px] text-gray-400 mt-7">리캡 리포트·일정 플래너는 멤버십 기능으로 준비중입니다.</p>
          </div>
        </>
      )}

      {authed && (
        <div className="px-5 pt-2 pb-4 border-t border-gray-100 flex-shrink-0">
          <DeleteAccountButton />
        </div>
      )}

      {lightbox && <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />}
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
