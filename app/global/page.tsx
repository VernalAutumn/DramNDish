import { Suspense } from 'react'
import GlobalExplorer from '@/src/components/GlobalExplorer'

// dramndish Global(해외) — /global
// 탐색 화면(§8.1): 지도(골격) + 플로팅 리스트 + 상세 패널
// Suspense: GlobalExplorer가 useSearchParams(?place=)를 사용하므로 필요
export default function GlobalPage() {
  return (
    <Suspense fallback={null}>
      <GlobalExplorer />
    </Suspense>
  )
}
