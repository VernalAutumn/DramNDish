'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/src/lib/supabase-browser'
import { COUNTRY_LABEL, GLOBAL_TYPE_LABEL } from '@/src/lib/global'

// 장소 등록 (§8.6) — 플로우: 국가 → 장소 찾기 → 최소 정보 → 등록 → 감사 페이지.
// TODO(부록 C): 구글 Places 검색(세션 토큰)은 API 키 연동 후 — 현재는 수동 입력 골격.

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

  const submit = async () => {
    setError(null)
    setDupId(null)
    if (!name.trim()) {
      setError('장소 이름을 입력해주세요.')
      return
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
          google_maps_url: mapsUrl.trim() || null,
          official_url: officialUrl.trim() || null,
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

            {/* ② 장소 찾기 — 구글 Places 골격 (부록 C: 키 연동 전) */}
            <div className="border border-dashed border-gray-300 rounded-lg px-3 py-2.5">
              <p className="text-[11px] text-gray-500">
                🔍 구글 장소 검색은 준비중입니다 (API 키 연동 후 제공).
                아래에 직접 입력해주세요 — 이름·주소는 구글 지도 표기를 권장합니다.
              </p>
            </div>

            {/* ③ 최소 정보 */}
            <div>
              <p className="text-xs font-bold text-gray-900 mb-1.5">② 유형 (필수)</p>
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
              <p className="text-xs font-bold text-gray-900">③ 장소 정보</p>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름 (필수, 한국어/통용 표기)" className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2" />
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
