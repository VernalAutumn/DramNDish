import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

/**
 * 모든 요청에서 Supabase 세션 쿠키를 자동으로 갱신합니다.
 * 이 미들웨어가 없으면 세션이 만료된 뒤에도 클라이언트가
 * 로그인 상태로 착각할 수 있습니다.
 */
export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // 요청 쿠키 갱신
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          // 응답 쿠키 갱신
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // 세션 갱신 (토큰 만료 체크)
  await supabase.auth.getUser()

  return supabaseResponse
}

export const config = {
  matcher: [
    // 정적 파일·이미지·파비콘 제외하고 모든 경로에 적용
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
