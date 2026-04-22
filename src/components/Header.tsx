'use client'

import { useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/src/lib/supabase-browser'

export default function Header() {
  const [user, setUser] = useState<User | null>(null)
  const supabase = useRef(createClient()).current   // 싱글턴 재사용

  // ── 세션 초기화 + 변경 구독 ──────────────────────────────────────────────
  useEffect(() => {
    // 현재 세션 로드
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
    })

    // 로그인/로그아웃 이벤트 구독
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [supabase])

  // ── 구글 로그인 ───────────────────────────────────────────────────────────
  const handleLogin = async () => {
    // NEXT_PUBLIC_SITE_URL이 없으면 현재 origin 사용 (로컬 개발 안전망)
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin

    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${siteUrl}/auth/callback`,
      },
    })
  }

  // ── 로그아웃 ──────────────────────────────────────────────────────────────
  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  // 표시 이름: full_name → email 순으로 폴백
  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ?? user?.email

  // ── 렌더 ──────────────────────────────────────────────────────────────────
  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 h-11"
      style={{
        background: 'rgba(255,255,255,0.88)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        borderBottom: '0.5px solid var(--color-border-default)',
      }}
    >
      {/* 앱 이름 */}
      <span className="text-title-sm" style={{ color: 'var(--color-brand-primary)' }}>
        Dram &amp; Dish
      </span>

      {/* 인증 영역 */}
      <div className="flex items-center gap-3">
        {user ? (
          <>
            <span
              className="text-body-sm"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {displayName}
            </span>
            <button
              onClick={handleLogout}
              className="text-label font-semibold px-3 py-1 rounded-full border transition-colors"
              style={{
                color: 'var(--color-text-primary)',
                borderColor: 'var(--color-border-default)',
                background: 'var(--color-surface-base)',
              }}
            >
              로그아웃
            </button>
          </>
        ) : (
          <button
            onClick={handleLogin}
            className="text-label font-semibold px-3 py-1 rounded-full transition-colors"
            style={{
              background: 'var(--color-brand-primary)',
              color: '#fff',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                'var(--color-brand-hover)'
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                'var(--color-brand-primary)'
            }}
          >
            구글 로그인
          </button>
        )}
      </div>
    </header>
  )
}
