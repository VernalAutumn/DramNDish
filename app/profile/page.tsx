'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/src/lib/supabase-browser'
import type { User } from '@supabase/supabase-js'

const MARKER_COLOR = '#BF3A21'

interface UserStats {
  comments: number
  photos:   number
}

export default function ProfilePage() {
  const router   = useRouter()
  const supabase = createClient()

  const [currentUser,      setCurrentUser]      = useState<User | null>(null)
  const [myNickname,       setMyNickname]        = useState<string>('')
  const [myCode,           setMyCode]            = useState<string>('')
  const [showPassword,     setShowPassword]      = useState(false)
  const [userStats,        setUserStats]         = useState<UserStats | null>(null)
  const [loadingStats,     setLoadingStats]      = useState(false)
  const [favCount,         setFavCount]          = useState(0)
  // Case B: 최초 닉네임 설정
  const [showNicknameForm, setShowNicknameForm]  = useState(false)
  const [newNickname,      setNewNickname]        = useState('')
  const [savingNick,       setSavingNick]         = useState(false)
  const [nickError,        setNickError]          = useState('')
  // Case C: 닉네임 인라인 수정
  const [isEditingNick,    setIsEditingNick]      = useState(false)
  const [editNickValue,    setEditNickValue]      = useState('')
  const [editNickError,    setEditNickError]      = useState('')
  const [isSavingEdit,     setIsSavingEdit]       = useState(false)

  // ─── 초기화 ───────────────────────────────────────────────────────────
  useEffect(() => {
    const savedNick = localStorage.getItem('tastamp_nickname') ?? ''
    const savedCode = localStorage.getItem('tastamp_code') ?? ''
    setMyNickname(savedNick)
    setMyCode(savedCode)

    supabase.auth.getSession().then(({ data: { session } }) => {
      const user = session?.user ?? null
      setCurrentUser(user)
      if (user) loadStats()
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      const user = session?.user ?? null
      setCurrentUser(user)
      if (user) loadStats()
    })
    return () => subscription.unsubscribe()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadStats = async () => {
    setLoadingStats(true)
    try {
      const [statsRes, favRes] = await Promise.all([
        fetch('/api/user/stats'),
        fetch('/api/favorites'),
      ])
      if (statsRes.ok) setUserStats(await statsRes.json())
      if (favRes.ok) {
        const ids: string[] = await favRes.json()
        setFavCount(ids.length)
      }
    } catch { /* 무시 */ } finally {
      setLoadingStats(false)
    }
  }

  const handleGoogleLogin = async () => {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${siteUrl}/auth/callback` },
    })
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.reload()
  }

  // ─── 공통 닉네임 저장 API 호출 ──────────────────────────────────────────
  const saveNicknameViaAPI = async (nick: string): Promise<string | null> => {
    const res = await fetch('/api/user/nickname', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: nick }),
    })
    const data = await res.json()
    if (!res.ok) return data.error ?? '저장 중 오류가 발생했습니다.'
    return null // null = 성공
  }

  // ─── Case B: 최초 닉네임 설정 ────────────────────────────────────────────
  const handleSaveNickname = async () => {
    const nick = newNickname.trim()
    if (!nick) { setNickError('닉네임을 입력해 주세요.'); return }
    if (nick.length > 20) { setNickError('20자 이내로 입력해 주세요.'); return }
    setSavingNick(true)
    setNickError('')
    try {
      const err = await saveNicknameViaAPI(nick)
      if (err) { setNickError(err); return }
      // 세션 갱신 → UI 즉각 반영
      const { data: { session } } = await supabase.auth.getSession()
      setCurrentUser(session?.user ?? null)
      setShowNicknameForm(false)
    } catch { setNickError('저장 중 오류가 발생했습니다.') }
    finally { setSavingNick(false) }
  }

  // ─── Case C: 기존 닉네임 변경 ────────────────────────────────────────────
  const handleStartEditNick = () => {
    const current = currentUser?.user_metadata?.app_nickname as string | undefined
    setEditNickValue(current ?? '')
    setEditNickError('')
    setIsEditingNick(true)
  }

  const handleCancelEditNick = () => {
    setIsEditingNick(false)
    setEditNickValue('')
    setEditNickError('')
  }

  const handleUpdateNickname = async () => {
    const nick = editNickValue.trim()
    if (!nick) { setEditNickError('닉네임을 입력해 주세요.'); return }
    if (nick.length > 20) { setEditNickError('20자 이내로 입력해 주세요.'); return }
    setIsSavingEdit(true)
    setEditNickError('')
    try {
      const err = await saveNicknameViaAPI(nick)
      if (err) { setEditNickError(err); return }
      // 세션 갱신 → 프로필 UI 즉각 반영
      const { data: { session } } = await supabase.auth.getSession()
      setCurrentUser(session?.user ?? null)
      setIsEditingNick(false)
    } catch { setEditNickError('저장 중 오류가 발생했습니다.') }
    finally { setIsSavingEdit(false) }
  }

  // ─── 법적 고지 ────────────────────────────────────────────────────────
  const LegalNote = () => (
    <p className="text-[9px] text-gray-400 leading-relaxed text-center mt-3">
      본 서비스는 주류 관련 장소 정보도 다룹니다.<br />
      주류 판매·광고·중개가 목적이 아닌 개인 운영 커뮤니티입니다.<br />
      <a href="https://tender-omelet-de8.notion.site/Terms-of-Use-34c39f83940e809c8841ef4d6700f48f?pvs=74"
        target="_blank" rel="noopener noreferrer" className="underline">이용약관</a>
      {' · '}
      <a href="https://tender-omelet-de8.notion.site/Privacy-Policy-34c39f83940e801389e6e957be1dfdd6?source=copy_link"
        target="_blank" rel="noopener noreferrer" className="underline">개인정보처리방침</a>
    </p>
  )

  // ─── 렌더 ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-white">
      {/* 헤더 */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-gray-100">
        <h1 className="text-base font-bold text-gray-900">마이페이지</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

        {/* ─── 케이스 A: 비로그인 ─────────────────────────────────────── */}
        {!currentUser && (
          <div className="space-y-3">
            {/* 익명 닉네임 */}
            <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
              <p className="text-xs font-bold text-gray-700">익명 사용자 설정</p>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-400 w-14 shrink-0">닉네임</span>
                <input
                  type="text"
                  value={myNickname}
                  onChange={(e) => {
                    setMyNickname(e.target.value)
                    localStorage.setItem('tastamp_nickname', e.target.value)
                  }}
                  placeholder="익명"
                  maxLength={20}
                  className="flex-1 min-w-0 text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-gray-400 bg-white transition-colors"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-400 w-14 shrink-0">비밀번호</span>
                <div className="flex-1 relative min-w-0">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={myCode}
                    onChange={(e) => {
                      const v = e.target.value.slice(0, 20)
                      setMyCode(v)
                      localStorage.setItem('tastamp_code', v)
                    }}
                    placeholder="콘텐츠 삭제 시 사용"
                    maxLength={20}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 pr-8 outline-none focus:border-gray-400 bg-white transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                      fill="none" stroke="currentColor" strokeWidth="2">
                      {showPassword
                        ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>
                        : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                      }
                    </svg>
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-gray-400">등록한 콘텐츠 삭제 시 이 비밀번호로 인증합니다.</p>
            </div>

            {/* Google 로그인 */}
            <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
              <p className="text-xs font-bold text-gray-700">계정 로그인</p>
              <button
                onClick={handleGoogleLogin}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 active:scale-[0.98] transition-all shadow-sm"
              >
                <svg viewBox="0 0 24 24" width="16" height="16">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Google로 로그인
              </button>
              <LegalNote />
            </div>
          </div>
        )}

        {/* ─── 케이스 B: 로그인 + 닉네임 미설정 ──────────────────────── */}
        {currentUser && !(currentUser.user_metadata?.app_nickname as string | undefined) && (
          <div className="space-y-3">
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
              <p className="text-sm font-bold text-amber-700">닉네임 설정이 필요합니다</p>
              <p className="text-xs text-amber-600">서비스를 이용하려면 닉네임을 먼저 설정해 주세요.</p>
              {showNicknameForm ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={newNickname}
                    onChange={(e) => setNewNickname(e.target.value)}
                    placeholder="닉네임 (최대 20자)"
                    maxLength={20}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-gray-400 bg-white"
                  />
                  {nickError && <p className="text-xs text-red-500">{nickError}</p>}
                  <button
                    onClick={handleSaveNickname}
                    disabled={savingNick}
                    className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-60"
                    style={{ backgroundColor: MARKER_COLOR }}
                  >
                    {savingNick ? '저장 중...' : '저장'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowNicknameForm(true)}
                  className="w-full py-2.5 rounded-xl text-sm font-bold text-white active:scale-[0.98] transition-all"
                  style={{ backgroundColor: MARKER_COLOR }}
                >
                  닉네임 설정하기
                </button>
              )}
            </div>
            <button
              onClick={handleLogout}
              className="w-full text-sm text-gray-400 hover:text-red-500 transition-colors py-2"
            >
              로그아웃
            </button>
            <LegalNote />
          </div>
        )}

        {/* ─── 케이스 C: 로그인 완료 ───────────────────────────────────── */}
        {currentUser && !!(currentUser.user_metadata?.app_nickname as string | undefined) && (
          <div className="space-y-4">
            {/* 유저 정보 */}
            <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                {/* 아바타 */}
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-white text-base font-bold shrink-0"
                  style={{ backgroundColor: MARKER_COLOR }}
                >
                  {(currentUser.user_metadata.app_nickname as string)[0].toUpperCase()}
                </div>

                {/* 닉네임 영역 */}
                {isEditingNick ? (
                  /* ── 수정 모드 ── */
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editNickValue}
                        onChange={(e) => { setEditNickValue(e.target.value); setEditNickError('') }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleUpdateNickname()
                          if (e.key === 'Escape') handleCancelEditNick()
                        }}
                        maxLength={20}
                        autoFocus
                        placeholder="새 닉네임 (최대 20자)"
                        className="flex-1 min-w-0 text-sm border border-gray-300 rounded-xl px-3 py-1.5 outline-none focus:border-[#BF3A21] bg-white transition-colors"
                      />
                      <button
                        onClick={handleUpdateNickname}
                        disabled={isSavingEdit}
                        className="shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold text-white disabled:opacity-50 active:scale-[0.97] transition-all"
                        style={{ backgroundColor: MARKER_COLOR }}
                      >
                        {isSavingEdit ? '저장 중…' : '저장'}
                      </button>
                      <button
                        onClick={handleCancelEditNick}
                        disabled={isSavingEdit}
                        className="shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold text-gray-500 bg-white border border-gray-200 disabled:opacity-50 active:scale-[0.97] transition-all"
                      >
                        취소
                      </button>
                    </div>
                    {editNickError && (
                      <p className="text-[11px] text-red-500 pl-1">{editNickError}</p>
                    )}
                    <p className="text-[10px] text-gray-400 pl-1">
                      닉네임을 변경하면 기존에 작성한 코멘트·사진의 이름도 함께 바뀝니다.
                    </p>
                  </div>
                ) : (
                  /* ── 표시 모드 ── */
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-bold text-gray-900 truncate">
                        {currentUser.user_metadata.app_nickname as string}
                      </p>
                      <button
                        onClick={handleStartEditNick}
                        className="shrink-0 p-1 text-gray-400 hover:text-[#BF3A21] active:scale-90 transition-all"
                        aria-label="닉네임 수정"
                      >
                        {/* Pencil icon */}
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
                          fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">Google 계정으로 로그인됨</p>
                  </div>
                )}
              </div>
            </div>

            {/* 통계 그리드 */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: '코멘트',  value: loadingStats ? '…' : (userStats?.comments ?? 0) },
                { label: '사진',    value: loadingStats ? '…' : (userStats?.photos   ?? 0) },
                { label: '즐겨찾기', value: loadingStats ? '…' : favCount },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="text-center bg-gray-50 rounded-xl py-3 border border-gray-100"
                >
                  <p className="text-lg font-bold text-gray-900">{value}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* 즐겨찾기 목록 보기 버튼 */}
            <button
              onClick={() => router.push('/list')}
              className="w-full py-3 rounded-xl text-sm font-semibold text-gray-700 bg-gray-50 border border-gray-100 hover:bg-gray-100 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                fill={MARKER_COLOR} stroke={MARKER_COLOR} strokeWidth="1.5">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
              </svg>
              즐겨찾기 목록 보기
            </button>

            {/* 로그아웃 */}
            <div className="border-t border-gray-100 pt-4">
              <button
                onClick={handleLogout}
                className="w-full py-3 rounded-xl text-sm font-semibold text-red-500 bg-red-50 hover:bg-red-100 active:scale-[0.98] transition-all"
              >
                로그아웃
              </button>
              <LegalNote />
            </div>
          </div>
        )}

      </div>

      {/* BottomNav 높이만큼 여백 */}
      <div className="h-20 flex-shrink-0 md:hidden" />
    </div>
  )
}
