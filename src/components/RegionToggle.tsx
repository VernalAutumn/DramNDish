'use client'

import { useRouter } from 'next/navigation'

const BRAND = '#BF3A21'

// 마이페이지 내용을 국내/해외 중 무엇으로 볼지 고르는 on/off 스위치.
// 앱 전체를 바꾸는 게 아니라 마이페이지 컨텍스트만 전환한다.
//  - active='domestic' → 국내 마이페이지(/profile)
//  - active='global'   → 해외 마이페이지(/global/me)
// "마이페이지" 헤더 우측에 정렬해 배치한다.
export default function RegionToggle({ active }: { active: 'domestic' | 'global' }) {
  const router = useRouter()

  const Item = ({ region, label, href }: { region: 'domestic' | 'global'; label: string; href: string }) => {
    const on = active === region
    return (
      <button
        onClick={() => { if (!on) router.push(href) }}
        aria-pressed={on}
        className="px-3 py-1 rounded-full text-[11px] font-bold leading-none transition-colors"
        style={on ? { background: BRAND, color: '#fff' } : { color: '#9ca3af', background: 'transparent' }}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 p-0.5 flex-shrink-0">
      <Item region="domestic" label="국내" href="/profile" />
      <Item region="global" label="해외" href="/global/me" />
    </div>
  )
}
