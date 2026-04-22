import { createBrowserClient } from '@supabase/ssr'

/**
 * 브라우저(클라이언트 컴포넌트)용 Supabase 클라이언트.
 * createBrowserClient는 내부적으로 싱글턴을 반환하므로
 * 여러 번 호출해도 인스턴스가 중복 생성되지 않습니다.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
