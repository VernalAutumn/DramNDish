'use client'

import { useRouter } from 'next/navigation'
import GlobalMyRecords from '@/src/components/GlobalMyRecords'

// 내 기록 — 직접 URL(/global/me) 접근용. 탐색 화면에선 오른쪽 플로팅 패널로 표시.
export default function GlobalMePage() {
  const router = useRouter()
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-xl mx-auto">
        <GlobalMyRecords
          onPlaceClick={(id) => router.push(`/global?place=${id}`)}
          onAddPlace={() => router.push('/global/add')}
          onClose={() => router.push('/global')}
        />
      </div>
    </div>
  )
}
