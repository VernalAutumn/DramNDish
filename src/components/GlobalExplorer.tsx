'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import GlobalPlaceDetail from './GlobalPlaceDetail'
import GlobalMyRecords from './GlobalMyRecords'
import { GlobalPlace, GLOBAL_TYPE_LABEL, countryLabel } from '@/src/lib/global'

// dramndish Global(해외) 탐색 화면 — §8.1 구조 (국내 NaverMap 방식 참고).
// 전체 배경 = 지도(골격), 좌측 플로팅 리스트, 선택 시 리스트 우측에 상세 패널.
// 지도는 부록 C대로 API 키 연동 전 골격만 — 키가 없으면 명시적 안내 (§9).
// TODO(다음 슬라이스): Google Maps JS API 마커·fitBounds·유효 중심 panTo (§8.1)

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

type Status = 'loading' | 'ready' | 'empty' | 'not_ready' | 'error'

const TYPE_FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'liquor_shop', label: '리쿼샵' },
  { key: 'bar', label: '바' },
  { key: 'restaurant', label: '음식점' },
  { key: 'distillery', label: '증류소' },
] as const

// 장소 카드 — 목록·즐겨찾기 탭 공용
function PlaceCard({
  p,
  active,
  onClick,
}: {
  p: GlobalPlace
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left border rounded-xl px-3.5 py-3 transition-colors"
      style={
        active
          ? { borderColor: 'var(--color-brand-primary)', background: 'rgba(191,58,33,0.04)' }
          : { borderColor: 'var(--color-border-default)', background: '#fff' }
      }
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-bold text-gray-900">{p.name}</span>
        <span
          className="text-[11px] font-medium px-2 py-0.5 rounded-full"
          style={{ background: '#f3f4f6', color: '#4b5563' }}
        >
          {GLOBAL_TYPE_LABEL[p.type] ?? p.type}
          {p.subkind === 'ib_shop' && ' · IB 직영점'}
        </span>
      </div>
      {p.name_local && <p className="text-[11px] text-gray-400 mt-0.5">{p.name_local}</p>}
      <p className="text-xs text-gray-600 mt-1">
        {countryLabel(p.country)}
        {p.region ? ` · ${p.region}` : ''}
      </p>
      {attrBadges(p).length > 0 && (
        <div className="flex gap-1 mt-1.5 flex-wrap">
          {attrBadges(p).map((b) => (
            <span
              key={b}
              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
              style={{ background: '#eef2ff', color: '#4338ca' }}
            >
              {b}
            </span>
          ))}
        </div>
      )}
      <p className="text-[11px] text-gray-400 mt-1.5">
        {p.source === 'seed' ? '운영진 시드' : `등록: ${p.contributor?.nickname ?? '익명'}`}
      </p>
    </button>
  )
}

// 카드에 노출할 유형별 핵심 속성 뱃지 (§8.1) — 값이 있을 때만 (§6)
function attrBadges(p: GlobalPlace): string[] {
  const a = p.attributes ?? {}
  const badges: string[] = []
  if (a.has_tasting === true) badges.push('시음')
  if (a.has_handfill === true || a.handfill === true) badges.push('핸드필')
  if (a.tax_free === true) badges.push('면세')
  if (a.booking_required === true) badges.push('예약 필수')
  if (a.smoking === false) badges.push('금연')
  return badges
}

export default function GlobalExplorer() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<Status>('loading')
  const [places, setPlaces] = useState<GlobalPlace[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showMe, setShowMe] = useState(false) // 모바일: 내 기록 풀스크린 토글
  const [meCollapsed, setMeCollapsed] = useState(true) // 데스크탑: 우측 상시 표시, 기본 접힘(계정 헤더만)

  // /global?place={id} — 등록 직후·공유 링크로 상세 바로 열기
  useEffect(() => {
    const pid = searchParams.get('place')
    if (pid) setSelectedId(pid)
  }, [searchParams])

  // 필터·검색·정렬 (§8.1 상단 바) — 데이터가 작아 클라이언트에서 처리
  const [country, setCountry] = useState('all')
  const [type, setType] = useState('all')
  const [q, setQ] = useState('')

  // 목록 / 즐겨찾기 탭 (국내판 패턴). 본격 모아보기는 마이페이지(§8.5)에서.
  const [mainTab, setMainTab] = useState<'list' | 'favorites'>('list')
  const [favIds, setFavIds] = useState<string[]>([])
  const [favState, setFavState] = useState<'loading' | 'ready' | 'unauth' | 'error'>('loading')

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await fetch('/api/global/places')
      if (res.status === 503) {
        setStatus('not_ready')
        return
      }
      if (!res.ok) throw new Error()
      const json = await res.json()
      const list: GlobalPlace[] = json.places ?? []
      setPlaces(list)
      setStatus(list.length === 0 ? 'empty' : 'ready')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // 즐겨찾기 탭 진입 시마다 새로 조회 (상세 패널에서 토글한 변경 반영)
  useEffect(() => {
    if (mainTab !== 'favorites') return
    let alive = true
    setFavState('loading')
    fetch('/api/global/favorites')
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((j) => {
        if (!alive) return
        if (!j.authenticated) {
          setFavState('unauth')
          return
        }
        setFavIds(j.placeIds ?? [])
        setFavState('ready')
      })
      .catch(() => {
        if (alive) setFavState('error')
      })
    return () => {
      alive = false
    }
  }, [mainTab])

  const countries = useMemo(
    () => Array.from(new Set(places.map((p) => p.country))).sort(),
    [places]
  )

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return places.filter((p) => {
      if (country !== 'all' && p.country !== country) return false
      if (type !== 'all' && p.type !== type) return false
      if (
        needle &&
        ![p.name, p.name_local, p.region, p.address]
          .filter(Boolean)
          .some((s) => (s as string).toLowerCase().includes(needle))
      )
        return false
      return true
    })
  }, [places, country, type, q])

  // 즐겨찾기 탭: 추가순 정렬 유지 (필터 미적용 — 내가 찜한 건 전부 보이게)
  const favoritePlaces = useMemo(() => {
    const byId = new Map(places.map((p) => [p.id, p]))
    return favIds.map((id) => byId.get(id)).filter(Boolean) as GlobalPlace[]
  }, [favIds, places])

  const selected = selectedId != null

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-surface-tertiary">
      {/* ── 지도 영역 (전체 배경) — 골격 ─────────────────────────────────── */}
      <div className="absolute inset-0 z-0 flex items-center justify-center">
        <div className="text-center px-6">
          <p className="text-sm font-medium text-gray-500">
            {MAPS_KEY
              ? '지도 연동 준비중 — 다음 업데이트에서 표시됩니다.'
              : '지도 준비중 — Google Maps API 키 연동 전입니다.'}
          </p>
          <p className="text-xs text-gray-400 mt-1">장소는 좌측 목록에서 확인할 수 있습니다.</p>
        </div>
      </div>

      {/* ── 📱 모바일 국내/해외 탑 앱바 ─────────────────────────────────── */}
      <div
        className="md:hidden fixed top-0 left-0 right-0 z-30 flex bg-white border-b border-gray-100"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <button
          onClick={() => router.push('/')}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-semibold border-b-2 border-transparent"
          style={{ opacity: 0.85, color: '#374151' }}
        >
          국내
        </button>
        <button
          className="flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-bold border-b-2"
          style={{ color: 'var(--color-brand-primary)', borderColor: 'var(--color-brand-primary)' }}
        >
          해외
          <span
            className="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
            style={{ background: '#e5e7eb', color: '#6b7280' }}
          >
            베타
          </span>
        </button>
      </div>

      {/* ── 💻 데스크탑 국내/해외 플로팅 알약 ───────────────────────────── */}
      <div
        className="hidden md:flex fixed top-4 left-1/2 -translate-x-1/2 z-50 items-center gap-0.5 rounded-full p-1 shadow-xl"
        style={{ background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(8px)' }}
      >
        <button
          onClick={() => router.push('/')}
          className="px-5 py-1.5 rounded-full text-sm font-semibold flex items-center gap-1.5"
          style={{ opacity: 0.85, color: '#374151' }}
        >
          국내
        </button>
        <button
          className="px-5 py-1.5 rounded-full text-sm font-bold shadow-sm flex items-center gap-1.5"
          style={{ background: 'rgba(191,58,33,0.09)', color: 'var(--color-brand-primary)' }}
        >
          해외
          <span
            className="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
            style={{ background: '#e5e7eb', color: '#6b7280' }}
          >
            베타
          </span>
        </button>
      </div>

      {/* ── 좌측 플로팅 리스트 패널 (§8.1) ─────────────────────────────── */}
      <div
        className={[
          'absolute z-20 flex flex-col',
          // 모바일: 앱바 아래 풀폭 / 데스크탑: 좌측 플로팅
          'inset-x-0 top-[calc(env(safe-area-inset-top)+48px)] bottom-0',
          'md:inset-auto md:top-4 md:bottom-4 md:left-4 md:w-[360px]',
        ].join(' ')}
      >
        <div className="panel w-full h-full flex flex-col overflow-hidden md:rounded-2xl bg-white">
          {/* 목록 / 즐겨찾기 탭 (국내판 패턴) */}
          <div className="flex border-b border-border-default flex-shrink-0">
            {(
              [
                { key: 'list', label: '목록' },
                { key: 'favorites', label: '즐겨찾기' },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setMainTab(key)}
                className="flex-1 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors"
                style={
                  mainTab === key
                    ? { borderColor: 'var(--color-brand-primary)', color: 'var(--color-brand-primary)' }
                    : { borderColor: 'transparent', color: '#9ca3af' }
                }
              >
                {label}
              </button>
            ))}
          </div>

          {/* 상단 바: 국가 선택 · 검색 · 필터 (목록 탭 전용) */}
          {mainTab === 'list' && (
          <div className="px-4 pt-3 pb-2 border-b border-border-default flex-shrink-0 space-y-2">
            <div className="flex gap-2">
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700"
              >
                <option value="all">모든 국가</option>
                {countries.map((c) => (
                  <option key={c} value={c}>
                    {countryLabel(c)}
                  </option>
                ))}
              </select>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="이름·지역·주소 검색"
                className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
              />
            </div>
            <div className="flex gap-1 flex-wrap">
              {TYPE_FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setType(key)}
                  className="text-[11px] font-medium px-2.5 py-1 rounded-full border"
                  style={
                    type === key
                      ? {
                          background: 'rgba(191,58,33,0.09)',
                          borderColor: 'var(--color-brand-primary)',
                          color: 'var(--color-brand-primary)',
                        }
                      : { borderColor: '#e5e7eb', color: '#6b7280', background: '#fff' }
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          )}

          {/* 목록 본문 — §9 상태별 명시 렌더 */}
          <div className="flex-1 overflow-y-auto">
            {/* 즐겨찾기 탭 */}
            {mainTab === 'favorites' && (
              <>
                {favState === 'loading' && (
                  <p className="text-sm text-gray-500 py-12 text-center">불러오는 중…</p>
                )}
                {favState === 'unauth' && (
                  <p className="text-sm text-gray-500 py-12 px-5 text-center">
                    로그인하면 즐겨찾기한 장소를 모아볼 수 있습니다.
                  </p>
                )}
                {favState === 'error' && (
                  <p className="text-sm text-gray-500 py-12 px-5 text-center">
                    즐겨찾기를 불러오지 못했습니다.
                  </p>
                )}
                {favState === 'ready' &&
                  (favoritePlaces.length === 0 ? (
                    <p className="text-sm text-gray-500 py-12 px-5 text-center">
                      즐겨찾기한 장소가 아직 없습니다. 장소 상세에서 ☆을 눌러 추가하세요.
                    </p>
                  ) : (
                    <ul className="px-3 py-2 space-y-2">
                      {favoritePlaces.map((p) => (
                        <li key={p.id}>
                          <PlaceCard
                            p={p}
                            active={p.id === selectedId}
                            onClick={() => setSelectedId(p.id === selectedId ? null : p.id)}
                          />
                        </li>
                      ))}
                    </ul>
                  ))}
              </>
            )}

            {mainTab === 'list' && (
            <>
            {status === 'loading' && (
              <p className="text-sm text-gray-500 py-12 text-center">불러오는 중…</p>
            )}

            {status === 'not_ready' && (
              <div className="py-12 px-5 text-center">
                <p className="text-sm font-medium text-gray-800">
                  해외 데이터베이스가 아직 적용되지 않았습니다.
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
              <div className="py-12 px-5 text-center">
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
              <p className="text-sm text-gray-500 py-12 px-5 text-center">
                등록된 해외 장소가 아직 없습니다.
              </p>
            )}

            {status === 'ready' && (
              <>
                <p className="text-xs text-gray-400 px-4 pt-2">
                  {filtered.length}개 장소
                  {filtered.length !== places.length && ` / 전체 ${places.length}`}
                </p>
                {filtered.length === 0 ? (
                  /* 검색/필터 0건 (§9) */
                  <div className="py-10 px-5 text-center">
                    <p className="text-sm text-gray-500">조건에 맞는 결과가 없습니다.</p>
                    <button
                      onClick={() => {
                        setCountry('all')
                        setType('all')
                        setQ('')
                      }}
                      className="mt-3 text-xs font-medium underline"
                      style={{ color: 'var(--color-brand-primary)' }}
                    >
                      필터 초기화
                    </button>
                  </div>
                ) : (
                  <ul className="px-3 py-2 space-y-2">
                    {filtered.map((p) => (
                      <li key={p.id}>
                        <PlaceCard
                          p={p}
                          active={p.id === selectedId}
                          onClick={() => setSelectedId(p.id === selectedId ? null : p.id)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            </>
            )}
          </div>

          {/* 패널 푸터: 장소 등록(§8.6). 내 기록은 우측 상시 패널로 분리됨. */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border-default flex-shrink-0 bg-white">
            <button
              onClick={() => router.push('/global/add')}
              className="flex-1 py-2.5 text-xs font-bold rounded-lg text-white"
              style={{ background: 'var(--color-brand-primary)' }}
            >
              + 장소 등록
            </button>
            {/* 모바일에서만 내 기록 진입 (데스크탑은 우측 상시) */}
            <button
              onClick={() => setShowMe(true)}
              className="md:hidden px-4 py-2.5 text-xs font-semibold rounded-lg border border-border-default text-gray-600"
            >
              내 기록
            </button>
          </div>
        </div>
      </div>

      {/* ── 상세 패널 — 리스트 우측에 이어서 열림 (§8.1) ─────────────────── */}
      {selected && (
        <>
          {/* 데스크탑: list | detail */}
          <div className="hidden md:flex absolute z-20 top-4 bottom-4 left-[calc(1rem+360px+0.75rem)] w-[400px]">
            <div className="panel w-full h-full overflow-hidden md:rounded-2xl bg-white">
              <GlobalPlaceDetail placeId={selectedId!} onClose={() => setSelectedId(null)} />
            </div>
          </div>
          {/* 모바일: 풀스크린 오버레이 */}
          <div
            className="md:hidden fixed inset-x-0 bottom-0 top-[calc(env(safe-area-inset-top)+48px)] z-40 bg-white"
          >
            <GlobalPlaceDetail placeId={selectedId!} onClose={() => setSelectedId(null)} />
          </div>
        </>
      )}

      {/* ── 내 기록 — 데스크탑은 화면 우측 끝에 상시 표시 (리스트=좌, 내 기록=우) ──
          국내판처럼 버튼 없이 기본 노출. 접기(×) 시 우측에 작은 복원 칩만 남는다.
          상세 패널(리스트 옆 중앙)과 반대편이라 겹치지 않는다. */}
      <div className={`hidden md:flex absolute z-30 top-4 right-4 w-[380px] ${meCollapsed ? '' : 'bottom-4'}`}>
        {meCollapsed ? (
          <GlobalMyRecords collapsed onToggle={() => setMeCollapsed(false)} />
        ) : (
          <div className="panel w-full h-full overflow-hidden rounded-2xl bg-white shadow-xl">
            <GlobalMyRecords
              onPlaceClick={(id) => setSelectedId(id)}
              onAddPlace={() => router.push('/global/add')}
              onToggle={() => setMeCollapsed(true)}
            />
          </div>
        )}
      </div>

      {/* 모바일: 풀스크린 토글 */}
      {showMe && (
        <div className="md:hidden fixed inset-x-0 bottom-0 top-[calc(env(safe-area-inset-top)+48px)] z-40 bg-white">
          <GlobalMyRecords
            onPlaceClick={(id) => {
              setShowMe(false)
              setSelectedId(id)
            }}
            onAddPlace={() => router.push('/global/add')}
            onClose={() => setShowMe(false)}
          />
        </div>
      )}
    </div>
  )
}
