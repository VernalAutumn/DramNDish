'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import GlobalPlaceDetail from './GlobalPlaceDetail'
import GlobalMyRecords from './GlobalMyRecords'
import { GlobalPlace, GLOBAL_TYPE_LABEL, COUNTRY_LABEL, COUNTRY_FLAG, countryLabel } from '@/src/lib/global'
import { EMBED_KEY, placeEmbedSrc, embedCountrySrc } from '@/src/lib/google-embed'

// dramndish Global(해외) 탐색 화면 — §8.1 구조 (국내 NaverMap 방식 참고).
// 전체 배경 = 지도(무료 Google Maps Embed), 좌측 플로팅 리스트, 선택 시 우측 상세 패널.
// 비용 0원 기조: Embed API(무제한 무료)로 선택 장소를 핀 표시, 국가별 1개씩만 로딩.

// 국가는 고정 목록(JP/TW/UK/US)에서 1개씩 선택 — '모든 국가' 동시 로딩은 하지 않는다.
const COUNTRIES = Object.keys(COUNTRY_LABEL)

type Status = 'loading' | 'ready' | 'empty' | 'not_ready' | 'error'

const TYPE_FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'liquor_shop', label: '리쿼샵' },
  { key: 'bar', label: '바' },
  { key: 'restaurant', label: '음식점' },
  { key: 'distillery', label: '증류소' },
] as const

// 속성 필터 (다중 선택, AND). 카드 뱃지(attrBadges)와 같은 기준.
// 현재 목록에 실제로 존재하는 속성만 칩으로 노출 → 유형 선택과 자연히 연동된다
// (예: 바만 보면 면세/시음 칩은 사라지고 금연만 남음).
type AttrMatch = (a: Record<string, unknown>) => boolean
const ATTR_FILTERS: { key: string; label: string; match: AttrMatch }[] = [
  { key: 'tax_free', label: '면세', match: (a) => a.tax_free === true },
  { key: 'has_tasting', label: '시음', match: (a) => a.has_tasting === true },
  { key: 'handfill', label: '핸드필', match: (a) => a.has_handfill === true || a.handfill === true },
  { key: 'booking_required', label: '예약 필수', match: (a) => a.booking_required === true },
  { key: 'no_smoking', label: '금연', match: (a) => a.smoking === false },
]

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
  // 지도가 보는 장소 — 상세 열림/닫힘과 분리. X로 상세를 닫아도 지도는 유지(리셋·깜빡임 방지).
  const [mapPlaceId, setMapPlaceId] = useState<string | null>(null)

  // 리스트에서 장소 선택 — 상세는 토글, 지도는 그 장소를 잡고 유지(닫아도 안 바뀜)
  const pickPlace = (id: string) => {
    setSelectedId((prev) => (prev === id ? null : id))
    setMapPlaceId(id)
  }

  // /global?place={id} — 등록 직후·공유 링크로 상세 바로 열기
  useEffect(() => {
    const pid = searchParams.get('place')
    if (pid) {
      setSelectedId(pid)
      setMapPlaceId(pid)
    }
  }, [searchParams])

  // 필터·검색 (§8.1 상단 바). 국가는 1개씩 선택 — 데이터도 그 국가만 불러온다.
  const [country, setCountry] = useState(COUNTRIES[0] ?? 'JP')
  const [type, setType] = useState('all')
  const [q, setQ] = useState('')
  const [region, setRegion] = useState<string | null>(null) // 도시 칩 (단일 선택)
  const [activeAttrs, setActiveAttrs] = useState<string[]>([]) // 속성 칩 (다중, AND)

  // 유형/국가를 바꾸면 하위 필터(도시·속성)는 초기화 — 안 그러면 빈 결과로 오인.
  const resetSubFilters = () => {
    setRegion(null)
    setActiveAttrs([])
  }
  const toggleAttr = (key: string) =>
    setActiveAttrs((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  // 유형 칩: 같은 걸 다시 누르면 '전체'로 해제 (기본값 복귀).
  const pickType = (key: string) => {
    setType((prev) => (prev === key && key !== 'all' ? 'all' : key))
    resetSubFilters()
  }

  // 목록 / 마이페이지 탭. 즐겨찾기는 마이페이지(GlobalMyRecords) 하위탭으로 흡수.
  const [mainTab, setMainTab] = useState<'list' | 'mypage'>('list')
  const [filtersOpen, setFiltersOpen] = useState(true) // 필터 칩 접기/펴기

  // 선택한 국가의 장소만 불러온다 (전체 동시 로딩 안 함 → 리소스 절약).
  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await fetch(`/api/global/places?country=${country}`)
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
  }, [country])

  useEffect(() => {
    load()
  }, [load])

  // 지도에 핀으로 보여줄 장소 — mapPlaceId 기준(상세를 닫아도 유지됨)
  const mapPlace = useMemo(
    () => places.find((p) => p.id === mapPlaceId) ?? null,
    [places, mapPlaceId]
  )

  // 유형까지만 적용한 집합 — 도시/속성 칩 후보를 이 집합 기준으로 뽑는다.
  const typeFiltered = useMemo(
    () => (type === 'all' ? places : places.filter((p) => p.type === type)),
    [places, type]
  )

  // 현재(유형 적용) 목록에 실제로 존재하는 속성만 칩으로 노출.
  const availAttrs = useMemo(
    () => ATTR_FILTERS.filter((f) => typeFiltered.some((p) => f.match(p.attributes ?? {}))),
    [typeFiltered]
  )

  // 도시(region) 후보 — 현재 목록의 고유 지역.
  const cities = useMemo(
    () =>
      Array.from(new Set(typeFiltered.map((p) => p.region).filter(Boolean))).sort() as string[],
    [typeFiltered]
  )

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return typeFiltered.filter((p) => {
      // 국가·유형은 이미 적용됨 — 여기선 도시·속성·검색어.
      if (region && p.region !== region) return false
      for (const key of activeAttrs) {
        const f = ATTR_FILTERS.find((x) => x.key === key)
        if (f && !f.match(p.attributes ?? {})) return false
      }
      if (
        needle &&
        ![p.name, p.name_local, p.region, p.address]
          .filter(Boolean)
          .some((s) => (s as string).toLowerCase().includes(needle))
      )
        return false
      return true
    })
  }, [typeFiltered, region, activeAttrs, q])

  // 접힘 상태 토글에 표시할 활성 필터 개수 (유형 비'전체' + 속성 + 도시)
  const activeFilterCount =
    (type !== 'all' ? 1 : 0) + activeAttrs.length + (region ? 1 : 0)

  const selected = selectedId != null

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-surface-tertiary md:flex">
      {/* ── 지도 영역 — 무료 Google Maps Embed ───────────────────────────────
          구글 지도 레이아웃: 좌측 리스트 칸(order-1)을 뺀 나머지(order-2, flex-1)를
          지도가 차지한다. Embed는 "보이는 지도 영역의 중앙"에 핀을 찍으므로, 영역을
          이렇게 고정하면 핀이 곧 보이는 중앙에 온다. 모바일은 리스트가 전체를 덮어 숨김. */}
      <div className="relative hidden md:block md:order-2 md:flex-1 h-full">
        {EMBED_KEY ? (
          <iframe
            title="해외 지도"
            className="w-full h-full border-0"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            src={
              (mapPlace
                ? placeEmbedSrc(mapPlace)
                : embedCountrySrc(country)) ?? undefined
            }
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center px-6">
              <p className="text-sm font-medium text-gray-500">지도 키가 아직 설정되지 않았습니다.</p>
              <p className="text-xs text-gray-400 mt-1">
                NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY 추가 후 표시됩니다. 장소는 좌측 목록에서 확인하세요.
              </p>
            </div>
          </div>
        )}
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

      {/* ── 좌측 리스트 칸 (도킹 사이드바) ───────────────────────────────
          플로팅 → 고정 컬럼. 모바일: 앱바 아래 풀폭 / 데스크탑: 좌측 고정폭(order-1). */}
      <div
        className={[
          'relative z-20 flex flex-col h-full',
          'w-full pt-[calc(env(safe-area-inset-top)+48px)]',
          'md:order-1 md:w-[380px] md:flex-shrink-0 md:pt-0',
        ].join(' ')}
      >
        <div className="w-full h-full flex flex-col overflow-hidden bg-white md:border-r md:border-border-default">
          {/* 목록 / 마이페이지 탭 */}
          <div className="flex border-b border-border-default flex-shrink-0">
            {(
              [
                { key: 'list', label: '목록' },
                { key: 'mypage', label: '마이페이지' },
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

          {/* 상단 바: 국가(국기)·검색·유형·속성·도시 필터 (목록 탭 전용) */}
          {mainTab === 'list' && (
          <div className="px-4 pt-3 pb-2 border-b border-border-default flex-shrink-0 space-y-2">
            {/* 국가 국기 칩 + 검색 */}
            <div className="flex gap-2">
              <div className="flex gap-1 flex-shrink-0">
                {COUNTRIES.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      if (c === country) return
                      setCountry(c)
                      setSelectedId(null) // 다른 국가로 바꾸면 선택 해제
                      setMapPlaceId(null) // 지도도 국가 개요로 (이때만 리셋)
                      resetSubFilters()   // 도시·속성 필터 초기화
                    }}
                    title={countryLabel(c)}
                    aria-pressed={country === c}
                    className="text-sm px-2 py-1 rounded-lg border leading-none transition-all"
                    style={
                      country === c
                        ? { borderColor: 'var(--color-brand-primary)', background: 'rgba(191,58,33,0.09)' }
                        : { borderColor: '#e5e7eb', background: '#fff', opacity: 0.55 }
                    }
                  >
                    {COUNTRY_FLAG[c] ?? c}
                  </button>
                ))}
              </div>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="이름·지역·주소 검색"
                className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5"
              />
            </div>

            {/* 유형 칩 + 세부 필터 접기 토글 (같은 가로축) */}
            <div className="flex items-center gap-1">
              <div className="flex gap-1 flex-wrap flex-1">
                {TYPE_FILTERS.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => pickType(key)}
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
              {(availAttrs.length > 0 || cities.length > 1) && (
                <button
                  onClick={() => setFiltersOpen((v) => !v)}
                  aria-pressed={filtersOpen}
                  title="세부 필터 접기/펴기"
                  className="flex-shrink-0 text-[11px] font-medium px-2 py-1 rounded-full border"
                  style={
                    activeFilterCount > 0
                      ? { borderColor: 'var(--color-brand-primary)', color: 'var(--color-brand-primary)', background: 'rgba(191,58,33,0.06)' }
                      : { borderColor: '#e5e7eb', color: '#6b7280', background: '#fff' }
                  }
                >
                  필터{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''} {filtersOpen ? '▴' : '▾'}
                </button>
              )}
            </div>

            {filtersOpen && (availAttrs.length > 0 || cities.length > 1) && (
            <>
            {/* 속성 칩 (다중, AND) — 현재 목록에 존재하는 속성만 노출 */}
            {availAttrs.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {availAttrs.map(({ key, label }) => {
                  const on = activeAttrs.includes(key)
                  return (
                    <button
                      key={key}
                      onClick={() => toggleAttr(key)}
                      aria-pressed={on}
                      className="text-[11px] font-medium px-2.5 py-1 rounded-full border"
                      style={
                        on
                          ? { background: '#eef2ff', borderColor: '#4338ca', color: '#4338ca' }
                          : { borderColor: '#e5e7eb', color: '#6b7280', background: '#fff' }
                      }
                    >
                      {on ? '✓ ' : ''}{label}
                    </button>
                  )
                })}
              </div>
            )}

            {/* 도시 칩 (단일 선택) — 현재 목록의 지역 */}
            {cities.length > 1 && (
              <div className="flex gap-1 flex-wrap">
                {cities.map((c) => {
                  const on = region === c
                  return (
                    <button
                      key={c}
                      onClick={() => setRegion(on ? null : c)}
                      aria-pressed={on}
                      className="text-[11px] font-medium px-2.5 py-1 rounded-full border"
                      style={
                        on
                          ? {
                              background: 'rgba(191,58,33,0.09)',
                              borderColor: 'var(--color-brand-primary)',
                              color: 'var(--color-brand-primary)',
                            }
                          : { borderColor: '#e5e7eb', color: '#6b7280', background: '#fff' }
                      }
                    >
                      📍 {c}
                    </button>
                  )
                })}
              </div>
            )}
            </>
            )}
          </div>
          )}

          {/* 마이페이지 탭 — GlobalMyRecords가 자체 스크롤·하위탭(즐겨찾기·장소·리뷰·사진·바틀) 관리 */}
          {mainTab === 'mypage' && (
            <div className="flex-1 overflow-hidden">
              <GlobalMyRecords
                onPlaceClick={(id) => {
                  setSelectedId(id)
                  setMapPlaceId(id)
                }}
                onAddPlace={() => router.push('/global/add')}
              />
            </div>
          )}

          {/* 목록 본문 — §9 상태별 명시 렌더 */}
          {mainTab === 'list' && (
          <div className="flex-1 overflow-y-auto">
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
                        // 국가는 1개씩 보는 기본 내비라 유지. 유형·속성·도시·검색어 초기화.
                        setType('all')
                        setQ('')
                        resetSubFilters()
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
                          onClick={() => pickPlace(p.id)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            </>
          </div>
          )}

          {/* 패널 푸터: 장소 등록(§8.6) */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border-default flex-shrink-0 bg-white">
            <button
              onClick={() => router.push('/global/add')}
              className="flex-1 py-2.5 text-xs font-bold rounded-lg text-white"
              style={{ background: 'var(--color-brand-primary)' }}
            >
              + 장소 등록
            </button>
          </div>
        </div>
      </div>

      {/* ── 상세 패널 — 지도 위에 떠 있는 플로팅 카드 (구글 지도식) ──────────
          리스트(좌측 고정) 바로 오른쪽, 지도 위에 라운드+그림자 카드로 띄운다.
          지도 iframe은 그대로 전체를 차지하므로 핀 중앙은 유지되고, 카드만 떠 있음.
          모바일: 앱바 아래 풀스크린. */}
      {selected && (
        <div
          className={[
            'absolute z-40 bg-white overflow-hidden',
            'inset-x-0 top-[calc(env(safe-area-inset-top)+48px)] bottom-0',
            'md:inset-x-auto md:right-auto md:left-[calc(380px+0.75rem)] md:top-4 md:bottom-4 md:w-[400px]',
            'md:rounded-2xl md:shadow-xl md:border md:border-border-default',
          ].join(' ')}
        >
          <GlobalPlaceDetail placeId={selectedId!} onClose={() => setSelectedId(null)} />
        </div>
      )}
    </div>
  )
}
