'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/src/lib/supabase-browser'

// 구매팁(방명록) — 장소 정보란의 짧은 한줄평. 공개 읽기 + 로그인 작성/본인 삭제.
// 상세 메인과 분리 조회 → 테이블 미적용(notReady)이어도 상세는 안 깨진다.

interface Tip {
  id: string
  body: string
  created_at: string
  user_id: string | null
  user?: { nickname: string | null } | { nickname: string | null }[] | null
}

function nick(t: Tip): string {
  const u = Array.isArray(t.user) ? t.user[0] : t.user
  if (!u) return '탈퇴한 사용자'
  return u.nickname ?? '익명'
}

export default function GlobalPurchaseTips({ placeId }: { placeId: string }) {
  const [tips, setTips] = useState<Tip[]>([])
  const [uid, setUid] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/global/places/${placeId}/purchase-tips`)
      const json = await res.json().catch(() => ({}))
      setTips(json.tips ?? [])
    } catch {
      /* 무시 — 빈 상태로 둠 */
    }
  }, [placeId])

  useEffect(() => {
    load()
    createClient().auth.getUser().then(({ data }) => setUid(data.user?.id ?? null))
  }, [load])

  const submit = async () => {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/global/places/${placeId}/purchase-tips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || '등록 실패')
      setDraft('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '등록 실패')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (tipId: string) => {
    if (!confirm('이 구매팁을 삭제할까요?')) return
    try {
      const res = await fetch(`/api/global/places/${placeId}/purchase-tips?tipId=${tipId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setTips((prev) => prev.filter((t) => t.id !== tipId))
    } catch {
      alert('삭제에 실패했습니다.')
    }
  }

  return (
    <div className="space-y-2">
      {tips.length === 0 ? (
        <p className="text-xs text-gray-400">아직 구매팁이 없습니다. 첫 팁을 남겨보세요.</p>
      ) : (
        <ul className="space-y-1.5">
          {tips.map((t) => (
            <li key={t.id} className="text-xs text-gray-700 border border-gray-100 rounded-lg px-3 py-2">
              <p className="whitespace-pre-wrap break-words">{t.body}</p>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-gray-400">
                  {nick(t)} · {t.created_at?.slice(0, 10)}
                </span>
                {uid && t.user_id === uid && (
                  <button onClick={() => remove(t.id)} className="text-[10px] text-gray-400 hover:text-red-500 underline">
                    삭제
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {uid ? (
        <div className="flex gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            maxLength={300}
            placeholder="한줄 구매팁 (예: 시내 리쿼샵이 더 쌈)"
            className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-gray-400"
          />
          <button
            onClick={submit}
            disabled={busy || !draft.trim()}
            className="flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-40"
            style={{ background: 'var(--color-brand-primary)' }}
          >
            등록
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-gray-400">로그인하면 구매팁을 남길 수 있습니다.</p>
      )}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  )
}
