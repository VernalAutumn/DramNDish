'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { createClient } from '@/src/lib/supabase-browser'

const CONFIRM_WORD = '탈퇴'

/**
 * 회원 탈퇴 버튼 + 재확인 모달 (국내 PC/모바일·글로벌 공용).
 * 로그아웃 버튼 바로 아래에, 가시성 낮은(de-emphasized) 텍스트로 둔다.
 *
 * 안전장치: 한 번 탭으로 절대 삭제되지 않는다.
 *   1) 트리거 클릭 → 경고 모달
 *   2) "탈퇴" 를 직접 입력해야 최종 버튼 활성화
 *   3) 최종 버튼 → DELETE /api/account
 */
export default function DeleteAccountButton({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  // Portal은 클라이언트에서만 (SSR 시 document 없음)
  useEffect(() => setMounted(true), [])

  const close = () => {
    if (busy) return
    setOpen(false)
    setTyped('')
    setError(null)
  }

  const handleDelete = async () => {
    if (typed.trim() !== CONFIRM_WORD || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/account', { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '탈퇴 처리 중 오류가 발생했습니다.')
      }
      // 로컬 세션 정리 후 홈으로 (서버에서 계정은 이미 삭제됨)
      try { await createClient().auth.signOut() } catch {}
      window.location.href = '/'
    } catch (e) {
      setError(e instanceof Error ? e.message : '탈퇴 처리 중 오류가 발생했습니다.')
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`w-full text-xs text-gray-300 hover:text-red-500 transition-colors py-1.5 ${className}`}
      >
        회원 탈퇴
      </button>

      {open && mounted && createPortal(
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 px-5"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label="회원 탈퇴 확인"
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-gray-900">정말 탈퇴하시겠어요?</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">
              계정과 개인 데이터(즐겨찾기·반응)는 <span className="font-semibold text-red-500">영구 삭제</span>되며
              되돌릴 수 없습니다. 등록하신 장소·후기·사진은 삭제되지 않고
              작성자만 <span className="font-semibold">‘{CONFIRM_WORD}한 사용자’</span>로 익명 처리됩니다.
            </p>

            <label className="mt-4 block text-xs font-medium text-gray-500">
              계속하려면 <span className="font-bold text-gray-800">{CONFIRM_WORD}</span> 를 입력하세요
            </label>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={CONFIRM_WORD}
              autoFocus
              disabled={busy}
              className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400 disabled:opacity-60"
            />

            {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="flex-1 rounded-xl bg-gray-100 py-3 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-200 disabled:opacity-60"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={typed.trim() !== CONFIRM_WORD || busy}
                className="flex-1 rounded-xl bg-red-500 py-3 text-sm font-semibold text-white transition-all hover:bg-red-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? '처리 중...' : '탈퇴하기'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
