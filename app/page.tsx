import { Suspense } from 'react'
import NaverMap from '@/src/components/NaverMap'

export default function Home() {
  return (
    <main className="w-full h-screen">
      {/* useSearchParams() 사용을 위한 Suspense 래핑 */}
      <Suspense fallback={null}>
        <NaverMap />
      </Suspense>
    </main>
  )
}
