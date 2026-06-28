// 관리자(모더레이터) 판별 — 이메일 허용목록 기반.
//
// 허용목록은 비밀이 아니다(누가 관리자인지 알아도 그 계정으로 "인증"해야만 권한이 생김).
// 따라서 클라이언트(버튼 노출)·서버(실제 권한 검증) 양쪽에서 같은 값을 쓰도록
// NEXT_PUBLIC_ADMIN_EMAILS 하나로 통일한다. (쉼표 구분)
//
// ⚠ 보안은 "서버가 인증된 유저의 email을 이 목록과 대조"하는 데서 나온다.
//    클라이언트 판별은 버튼 노출 용도일 뿐 — 실제 삭제/편집 API는 서버에서 반드시 재검증한다.

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false
  const raw = process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? ''
  const list = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return list.includes(email.toLowerCase())
}
