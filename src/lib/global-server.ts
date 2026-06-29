import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { User } from '@supabase/supabase-js'

// dramndish Global(해외) 작성용 서버 헬퍼.
// global 스키마 RLS는 전부 auth.uid() 기반이므로, 작성은 anon 클라이언트가 아니라
// "사용자 토큰(SSR 쿠키)"으로 호출해야 정책의 auth.uid()가 채워진다.
// db.schema='global' 로 global 스키마를 가리킨다 (auth는 GoTrue라 schema 무관).

export async function makeGlobalSSRClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: 'global' },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(list) {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        },
      },
    }
  )
}

/**
 * 작성 전 호출. 로그인 유저를 반환하고, global.users 프로필 행을 보장한다.
 * reviews/observations/favorites 등은 user_id → global.users FK라서,
 * 프로필 행이 없으면 첫 작성이 FK 위반으로 실패한다.
 *
 * @returns 로그인 유저. 비로그인이면 null.
 */
type GlobalSSRClient = Awaited<ReturnType<typeof makeGlobalSSRClient>>

export async function getGlobalUser(client: GlobalSSRClient): Promise<User | null> {
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return null

  // 닉네임은 국내판과 공유되는 user_metadata.app_nickname 사용 (§10 기여자 표시)
  const nickname =
    (user.user_metadata?.app_nickname as string | undefined)?.trim() ||
    user.email?.split('@')[0] ||
    '익명'

  // 프로필 행 보장 + 닉네임 동기화.
  // 해외판은 contributor/user 표시를 global.users.nickname 라이브 조인으로 하므로,
  // 국내판에서 닉네임을 바꾼 사용자라도 해외 활동 시 최신 app_nickname으로 자가 치유된다.
  // (insert=users_insert_self / update=users_update_self RLS 통과)
  await client
    .from('users')
    .upsert({ id: user.id, nickname }, { onConflict: 'id' })

  return user
}
