'use client'

import { useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import PhotoPicker from './PhotoPicker'
import PhotoLightbox from './PhotoLightbox'
import { uploadGlobalPhotos } from '@/src/lib/global-upload'

// 증류소 한정 보틀 (B4) — 사진+제품명 등록 + 있어요/없어요·꼭사야해/굳이 교차검증.
// 공개 읽기 + 로그인 등록/투표/본인 삭제. 상세 메인과 분리 조회 → notReady여도 안 깨짐.

type Vote = 'up' | 'down'

interface Bottle {
  id: string
  name: string
  photo_url: string | null
  user_id: string | null
  created_at: string
  nickname: string | null
  counts: { up: number; down: number }
  myVote: Vote | null
}

const BRAND = 'var(--color-brand-primary)'

export default function GlobalDistilleryBottles({
  placeId,
  currentUser,
}: {
  placeId: string
  currentUser: User | null
}) {
  const [bottles, setBottles] = useState<Bottle[]>([])
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/global/places/${placeId}/bottles`)
      const json = await res.json().catch(() => ({}))
      setBottles(json.bottles ?? [])
    } catch {
      /* 무시 — 빈 상태 유지 */
    }
  }, [placeId])

  useEffect(() => {
    load()
  }, [load])

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      const photoUrls = files.length > 0 && currentUser ? await uploadGlobalPhotos(files, currentUser.id) : []
      const res = await fetch(`/api/global/places/${placeId}/bottles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, photo_url: photoUrls[0] ?? null }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || '등록 실패')
      setName('')
      setFiles([])
      setShowForm(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '등록 실패')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (bottleId: string) => {
    if (!confirm('이 한정 보틀을 삭제할까요?')) return
    try {
      const res = await fetch(`/api/global/places/${placeId}/bottles?bottleId=${bottleId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setBottles((prev) => prev.filter((b) => b.id !== bottleId))
    } catch {
      alert('삭제에 실패했습니다.')
    }
  }

  // 투표: 같은 값 재클릭 → 철회, 다른 값 → 전환. 낙관적 업데이트 후 실패 시 재조회.
  const vote = async (bottleId: string, value: Vote) => {
    if (!currentUser) {
      alert('로그인이 필요한 기능입니다.')
      return
    }
    const target = bottles.find((b) => b.id === bottleId)
    if (!target) return
    const cur = target.myVote
    const retract = cur === value

    setBottles((prev) =>
      prev.map((b) => {
        if (b.id !== bottleId) return b
        const counts = { ...b.counts }
        if (retract) {
          counts[value]--
        } else {
          if (cur) counts[cur]--
          counts[value]++
        }
        return { ...b, counts, myVote: retract ? null : value }
      })
    )

    try {
      const res = retract
        ? await fetch(`/api/global/bottles/${bottleId}/vote`, { method: 'DELETE' })
        : await fetch(`/api/global/bottles/${bottleId}/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vote: value }),
          })
      if (!res.ok) throw new Error()
    } catch {
      load() // 롤백 대신 정합 재조회
    }
  }

  const VoteBtn = ({
    active,
    label,
    count,
    onClick,
  }: {
    active: boolean
    label: string
    count: number
    onClick: () => void
  }) => (
    <button
      onClick={onClick}
      className="flex-1 text-[11px] font-semibold px-2 py-1 rounded-md border transition-colors"
      style={
        active
          ? { background: BRAND, borderColor: BRAND, color: '#fff' }
          : { borderColor: '#e5e7eb', color: '#6b7280' }
      }
    >
      {label} <span className={active ? 'opacity-80' : 'text-gray-400'}>{count}</span>
    </button>
  )

  return (
    <div className="space-y-2">
      {bottles.length === 0 ? (
        <p className="text-xs text-gray-400">
          아직 등록된 한정 보틀이 없습니다. {currentUser ? '아래에서 등록해보세요.' : '로그인하면 등록할 수 있습니다.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {bottles.map((b) => (
            <li key={b.id} className="border border-gray-100 rounded-lg p-2.5">
              <div className="flex gap-2.5">
                {b.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={b.photo_url}
                    alt={b.name}
                    onClick={() => setLightbox(b.photo_url!)}
                    className="w-14 h-14 object-cover rounded-lg flex-shrink-0 cursor-pointer"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 text-lg flex-shrink-0">
                    🥃
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-800 break-words">{b.name}</p>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-[10px] text-gray-400">
                      {b.nickname ?? '익명'} · {b.created_at?.slice(0, 10)}
                    </span>
                    {currentUser && b.user_id === currentUser.id && (
                      <button onClick={() => remove(b.id)} className="text-[10px] text-gray-400 hover:text-red-500 underline">
                        삭제
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* 추천 / 비추 (엄지 한 표) */}
              <div className="mt-2 flex gap-1.5">
                <VoteBtn active={b.myVote === 'up'} label="👍 추천" count={b.counts.up} onClick={() => vote(b.id, 'up')} />
                <VoteBtn active={b.myVote === 'down'} label="👎 비추" count={b.counts.down} onClick={() => vote(b.id, 'down')} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 등록 */}
      {currentUser ? (
        showForm ? (
          <div className="border border-gray-200 rounded-lg p-2.5 space-y-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="제품명 (예: 증류소 한정 핸드필 캐스크 #1234)"
              className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 outline-none focus:border-gray-400"
            />
            <PhotoPicker files={files} setFiles={setFiles} label="사진 (선택, 1장)" max={1} />
            {error && <p className="text-[11px] text-red-500">{error}</p>}
            <div className="flex gap-1.5">
              <button
                onClick={() => { setShowForm(false); setError(null) }}
                disabled={busy}
                className="flex-1 py-2 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={submit}
                disabled={busy || !name.trim()}
                className="flex-1 py-2 text-xs font-bold rounded-lg text-white disabled:opacity-40"
                style={{ background: BRAND }}
              >
                {busy ? '등록 중…' : '등록'}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full text-xs font-semibold py-2 rounded-lg border border-dashed"
            style={{ borderColor: BRAND, color: BRAND }}
          >
            + 한정 보틀 등록
          </button>
        )
      ) : null}

      {lightbox && <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  )
}
