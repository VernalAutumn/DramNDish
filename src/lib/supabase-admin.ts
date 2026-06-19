import { createClient } from '@supabase/supabase-js'

// 서버 전용 service-role 클라이언트.
// RLS를 우회하므로 절대 클라이언트 번들로 새어나가면 안 된다 (NEXT_PUBLIC 접두사 금지).
// 회원 탈퇴처럼 "본인 외 행 조작 + auth 계정 삭제"가 필요한 관리 작업에만 쓴다.
//
// ⚠ 필요 env: SUPABASE_SERVICE_ROLE_KEY (Supabase 대시보드 → Project Settings → API → service_role)

function serviceKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다. (서버 env)')
  }
  return key
}

const baseOpts = {
  auth: { autoRefreshToken: false, persistSession: false },
} as const

/** public 스키마(국내) 관리 클라이언트. */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey(),
    baseOpts,
  )
}

/** global 스키마(해외) 관리 클라이언트. */
export function createAdminGlobalClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey(),
    { ...baseOpts, db: { schema: 'global' } },
  )
}
