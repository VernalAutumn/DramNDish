'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/src/lib/supabase-browser'
import { COUNTRY_LABEL, GLOBAL_TYPE_LABEL } from '@/src/lib/global'
import type { PlaceSuggestion } from '@/src/lib/adapters/types'

// 장소 등록 (§8.6) — 플로우: 국가 → 장소 찾기(구글) → 최소 정보 → 등록 → 감사 페이지.
// 구글 Places(New) Autocomplete + Details, 세션 토큰으로 묶어 과금 1회분.

// 유형별 추가 정보(attributes) 토글. 사실 정보를 등록 시 선택적으로 켠다.
// 여기에 줄을 추가하면 폼에 토글이 늘어난다. on = 체크 시 attributes에 저장할 값
// (예: 면세 가능→tax_free:true, 금연→smoking:false). 서버 POST의 화이트리스트와 키를 맞출 것.
const ATTR_TOGGLES: Record<string, { key: string; label: string; on: boolean }[]> = {
  liquor_shop: [
    { key: 'tax_free', label: '면세 가능', on: true },
    { key: 'has_tasting', label: '시음 가능', on: true },
  ],
  distillery: [
    { key: 'booking_required', label: '예약 필수', on: true },
  ],
  bar: [
    { key: 'smoking', label: '금연', on: false },
  ],
  restaurant: [],
}

export default function GlobalAddPage() {
  const router = useRouter()
  const supabase = createClient()
  const [user, setUser] = useState<User | null | 'loading'>('loading')

  const [country, setCountry] = useState('JP')
  const [type, setType] = useState('liquor_shop')
  const [subkind, setSubkind] = useState('distillery')
  const [name, setName] = useState('')
  const [nameLocal, setNameLocal] = useState('')
  const [region, setRegion] = useState('')
  const [address, setAddress] = useState('')
  const [mapsUrl, setMapsUrl] = useState('')
  const [officialUrl, setOfficialUrl] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dupId, setDupId] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)
  // 추가 정보 토글 체크 상태 (attribute key → 켜짐 여부)
  const [attrOn, setAttrOn] = useState<Record<string, boolean>>({})

  // 구글 검색(자동완성) 상태
  const [search, setSearch] = useState('')
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState(false) // 구글에서 골라 자동 채움됨
  const [coords, setCoords] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null })
  const [searchError, setSearchError] = useState<string | null>(null) // 검색 실패/네트워크 오류
  const [noResults, setNoResults] = useState(false)                    // 정상 응답인데 결과 0건
  const [suggestedName, setSuggestedName] = useState<string | null>(null) // 구글 한국어 표기(이름 제안)
  // 자동완성↔상세를 한 세션으로 묶는 토큰. 선택 후 비워 다음 검색은 새 토큰을 쓴다.
  const sessionToken = useRef<string | null>(null)
  // 제안을 막 선택한 직후 1회: 검색창에 이름이 채워져도 재검색·드롭다운을 띄우지 않는다.
  const justPicked = useRef(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
  }, [supabase])

  const login = async () => {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${siteUrl}/auth/callback?next=/global/add` },
    })
  }

  // 타이핑하면 300ms 멈춘 뒤 자동완성 호출 (매 글자마다 부르지 않도록 디바운스).
  useEffect(() => {
    // 제안을 막 골라 검색창이 채워진 경우엔 재검색하지 않고 드롭다운을 닫은 채로 둔다.
    if (justPicked.current) {
      justPicked.current = false
      setSuggestions([])
      setSearching(false)
      return
    }
    const q = search.trim()
    if (q.length < 2) {
      setSuggestions([])
      setNoResults(false)
      setSearchError(null)
      return
    }
    // 검색 세션이 없으면 새로 연다 (자동완성+상세를 한 토큰으로 묶어 과금 절약).
    if (!sessionToken.current) sessionToken.current = crypto.randomUUID()
    setSearching(true)
    setSearchError(null)
    setNoResults(false)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/global/search?query=${encodeURIComponent(q)}&country=${country}&token=${sessionToken.current}`
        )
        if (!res.ok) {
          setSuggestions([])
          setSearchError('검색 실패 — 잠시 후 다시 시도하거나 아래에 직접 입력해주세요.')
          return
        }
        const json = await res.json().catch(() => ({}))
        const list: PlaceSuggestion[] = json.suggestions ?? []
        setSuggestions(list)
        setNoResults(list.length === 0)
      } catch {
        setSuggestions([])
        setSearchError('네트워크 오류 — 연결을 확인하거나 아래에 직접 입력해주세요.')
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [search, country])

  // 제안 선택 → 상세 조회 → 폼 자동 채움. 같은 세션 토큰으로 마감.
  const pickSuggestion = async (s: PlaceSuggestion) => {
    justPicked.current = true // 아래 setSearch로 인한 재검색을 막는다
    setSuggestions([])
    setSearchError(null)
    setNoResults(false)
    setSearch(s.mainText)
    // 구글이 languageCode:'ko'로 준 표기 → 한글명(이름) 칸에 칩으로 제안.
    setSuggestedName(s.mainText.trim() || null)
    try {
      const res = await fetch(
        `/api/global/place?placeId=${encodeURIComponent(s.providerId)}&country=${country}&token=${sessionToken.current ?? ''}`
      )
      const json = await res.json().catch(() => ({}))
      const p = json.place
      if (p) {
        // 구글이 준 현지어 원문 이름 → "현지어 원문" 칸. "한글명"은 사용자가 직접 입력.
        setNameLocal(p.name ?? '')
        setAddress(p.address ?? '')
        setMapsUrl(p.googleMapsUrl ?? '')
        setOfficialUrl(p.officialUrl ?? '') // 구글 공식 사이트 자동채움
        setCoords({ lat: p.lat ?? null, lng: p.lng ?? null })
        setPicked(true)
      }
    } catch {
      /* 상세 실패 시 직접 입력으로 진행 */
    }
    sessionToken.current = null // 세션 마감 — 다음 검색은 새 토큰
  }

  const submit = async () => {
    setError(null)
    setDupId(null)
    if (!name.trim()) {
      setError('장소 이름을 입력해주세요.')
      return
    }
    // 현재 유형의 켜진 토글만 attributes로 (체크된 것만 키를 넣음 = 미지정은 '정보 없음')
    const attributes: Record<string, boolean> = {}
    for (const t of ATTR_TOGGLES[type] ?? []) {
      if (attrOn[t.key]) attributes[t.key] = t.on
    }
    setBusy(true)
    try {
      const res = await fetch('/api/global/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          name_local: nameLocal.trim() || null,
          type,
          subkind: type === 'distillery' ? subkind : null,
          country,
          region: region.trim() || null,
          address: address.trim() || null,
          lat: coords.lat,
          lng: coords.lng,
          google_maps_url: mapsUrl.trim() || null,
          official_url: officialUrl.trim() || null,
          attributes,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 409) {
        setError(json.message ?? '이미 등록된 장소입니다.')
        setDupId(json.existingId ?? null)
        return
      }
      if (!res.ok) {
        setError(json.error ?? '등록에 실패했습니다.')
        return
      }
      setCreatedId(json.id)
    } catch {
      setError('등록에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  // ── 감사 페이지 (§8.6 기여자 인정) ──────────────────────────────
  if (createdId) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <p className="text-2xl">🥃</p>
          <h1 className="text-lg font-bold text-gray-900 mt-3">등록해주셔서 감사합니다!</h1>
          <p className="text-xs text-gray-500 mt-2">
            등록하신 장소는 닉네임과 함께 표시됩니다.
            방문하셨다면 후기·관찰 정보도 남겨주세요.
          </p>
          <div className="flex gap-2 mt-6">
            <button
              onClick={() => router.push(`/global?place=${createdId}`)}
              className="flex-1 py-2.5 text-xs font-bold rounded-lg text-white"
              style={{ background: 'var(--color-brand-primary)' }}
            >
              등록한 장소 보기
            </button>
            <button
              onClick={() => {
                setCreatedId(null)
                setName('')
                setNameLocal('')
                setRegion('')
                setAddress('')
                setMapsUrl('')
                setOfficialUrl('')
                setSearch('')
                setSuggestions([])
                setPicked(false)
                setCoords({ lat: null, lng: null })
                setAttrOn({})
                setSearchError(null)
                setNoResults(false)
                setSuggestedName(null)
                sessionToken.current = null
              }}
              className="flex-1 py-2.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-700"
            >
              계속 등록
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-xl mx-auto px-5 py-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/global')} className="text-gray-400 hover:text-gray-600 text-lg" aria-label="뒤로">
            ←
          </button>
          <h1 className="text-base font-bold text-gray-900">해외 장소 등록</h1>
        </div>

        {user === 'loading' ? (
          <p className="text-sm text-gray-500 py-16 text-center">확인 중…</p>
        ) : user === null ? (
          /* 로그인 필요 (§9 — 무반응 금지) */
          <div className="py-16 text-center">
            <p className="text-sm font-medium text-gray-800">장소 등록에는 로그인이 필요합니다.</p>
            <button
              onClick={login}
              className="mt-4 px-5 py-2.5 text-xs font-bold rounded-lg text-white"
              style={{ background: 'var(--color-brand-primary)' }}
            >
              Google로 로그인
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {/* ① 국가 */}
            <div>
              <p className="text-xs font-bold text-gray-900 mb-1.5">① 국가</p>
              <div className="flex gap-1.5">
                {Object.entries(COUNTRY_LABEL).map(([code, label]) => (
                  <button
                    key={code}
                    onClick={() => setCountry(code)}
                    className="flex-1 py-2 text-xs font-medium rounded-lg border"
                    style={
                      country === code
                        ? { borderColor: 'var(--color-brand-primary)', color: 'var(--color-brand-primary)', background: 'rgba(191,58,33,0.06)' }
                        : { borderColor: '#e5e7eb', color: '#6b7280' }
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* ② 장소 찾기 — 구글 Places 검색 (선택한 국가 안에서만, 한국 제외) */}
            <div className="relative">
              <p className="text-xs font-bold text-gray-900 mb-1.5">② 장소 찾기</p>
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPicked(false)
                }}
                // 다른 곳을 클릭하면 드롭다운을 닫는다 (제안 클릭은 먼저 처리되도록 약간 지연).
                onBlur={() => setTimeout(() => setSuggestions([]), 150)}
                placeholder={`🔍 ${COUNTRY_LABEL[country] ?? ''}에서 검색 (영어/현지어 이름 권장)`}
                className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2"
              />
              {suggestions.length > 0 && (
                <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                  {suggestions.map((s) => (
                    <li key={s.providerId}>
                      <button
                        type="button"
                        onClick={() => pickSuggestion(s)}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                      >
                        <span className="block text-xs font-medium text-gray-900">{s.mainText}</span>
                        <span className="block text-[11px] text-gray-500">{s.secondaryText}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {searchError ? (
                <p className="text-[11px] text-red-500 mt-1">{searchError}</p>
              ) : searching ? (
                <p className="text-[11px] text-gray-400 mt-1">검색 중…</p>
              ) : picked ? (
                <p className="text-[11px] text-emerald-600 mt-1">✓ 현지어 원문·주소·좌표·공식사이트를 불러왔습니다. 아래 <b>한글명</b>에 한국인들이 부르는 이름을 입력해주세요.</p>
              ) : noResults ? (
                <p className="text-[11px] text-amber-600 mt-1">검색 결과가 없습니다 — 이름을 바꿔보거나 아래에 직접 입력하세요.</p>
              ) : (
                <p className="text-[11px] text-gray-400 mt-1">
                  한국어로는 잘 안 잡힙니다 — 가게의 영어/현지어 이름으로 검색하세요. 직접 입력도 가능합니다.
                </p>
              )}
            </div>

            {/* ③ 최소 정보 */}
            <div>
              <p className="text-xs font-bold text-gray-900 mb-1.5">③ 유형 (필수)</p>
              <div className="flex gap-1.5">
                {Object.entries(GLOBAL_TYPE_LABEL).map(([k, l]) => (
                  <button
                    key={k}
                    onClick={() => setType(k)}
                    className="flex-1 py-2 text-xs font-medium rounded-lg border"
                    style={
                      type === k
                        ? { borderColor: 'var(--color-brand-primary)', color: 'var(--color-brand-primary)', background: 'rgba(191,58,33,0.06)' }
                        : { borderColor: '#e5e7eb', color: '#6b7280' }
                    }
                  >
                    {l}
                  </button>
                ))}
              </div>
              {type === 'distillery' && (
                <div className="flex gap-1.5 mt-1.5">
                  {(
                    [
                      { k: 'distillery', l: '증류소 (생산)' },
                      { k: 'ib_shop', l: 'IB 직영점 (카덴헤드·G&M 등)' },
                    ] as const
                  ).map(({ k, l }) => (
                    <button
                      key={k}
                      onClick={() => setSubkind(k)}
                      className="flex-1 py-1.5 text-[11px] font-medium rounded-lg border"
                      style={
                        subkind === k
                          ? { borderColor: 'var(--color-brand-primary)', color: 'var(--color-brand-primary)' }
                          : { borderColor: '#e5e7eb', color: '#6b7280' }
                      }
                    >
                      {l}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold text-gray-900">④ 장소 정보</p>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름 (필수, 한국어/통용 표기)" className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2" />
              {suggestedName && suggestedName !== name && (
                <button
                  type="button"
                  onClick={() => { setName(suggestedName); setSuggestedName(null) }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-full border"
                  style={{ borderColor: 'var(--color-brand-primary)', color: 'var(--color-brand-primary)', background: 'rgba(191,58,33,0.06)' }}
                >
                  🔤 한글명 제안: {suggestedName} <span className="text-gray-400">— 적용</span>
                </button>
              )}
              <input value={nameLocal} onChange={(e) => setNameLocal(e.target.value)} placeholder="현지어 원문 (선택, 예: リカーマウンテン)" className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2" />
              <input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder={country === 'UK' ? '지역 (위스키 지역 — 스페이사이드·아일라 등)' : '지역 (도시 — 교토·타이베이 등)'}
                className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2"
              />
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="주소 (선택)" className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2" />
              <input value={mapsUrl} onChange={(e) => setMapsUrl(e.target.value)} placeholder="구글 지도 링크 (선택)" className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2" />
              <input value={officialUrl} onChange={(e) => setOfficialUrl(e.target.value)} placeholder="공식 사이트 (선택 — SNS 제외)" className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2" />
            </div>

            {/* ⑤ 추가 정보 (선택) — 유형별 사실 토글 → attributes */}
            {(ATTR_TOGGLES[type]?.length ?? 0) > 0 && (
              <div>
                <p className="text-xs font-bold text-gray-900 mb-1.5">⑤ 추가 정보 (선택)</p>
                <div className="flex gap-1.5 flex-wrap">
                  {ATTR_TOGGLES[type].map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setAttrOn((p) => ({ ...p, [t.key]: !p[t.key] }))}
                      className="px-3 py-1.5 text-[11px] font-medium rounded-full border"
                      style={
                        attrOn[t.key]
                          ? { borderColor: 'var(--color-brand-primary)', color: 'var(--color-brand-primary)', background: 'rgba(191,58,33,0.06)' }
                          : { borderColor: '#e5e7eb', color: '#6b7280' }
                      }
                    >
                      {attrOn[t.key] ? '✓ ' : ''}
                      {t.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 mt-1">확실한 정보만 켜주세요. 체크 안 하면 &lsquo;정보 없음&rsquo;으로 남습니다.</p>
              </div>
            )}

            {error && (
              <p className="text-xs text-red-500">
                {error}
                {dupId && (
                  <button onClick={() => router.push(`/global?place=${dupId}`)} className="ml-2 underline text-gray-600">
                    기존 장소 보기
                  </button>
                )}
              </p>
            )}

            <button
              onClick={submit}
              disabled={busy}
              className="w-full py-3 text-sm font-bold rounded-xl text-white disabled:opacity-50"
              style={{ background: 'var(--color-brand-primary)' }}
            >
              {busy ? '등록 중…' : '등록하기'}
            </button>
            <p className="text-[11px] text-gray-400">
              태그·후기·구매 인증은 등록 후 장소 상세에서 선택적으로 남길 수 있습니다. (필수 아님)
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
