'use client'

import { Map, Search, PlusCircle, User } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'

const PRIMARY = '#BF3A21'
const GRAY    = '#9ca3af'

interface Tab {
  key:   string
  href:  string
  label: string
  Icon:  React.ComponentType<{ size: number; color: string; strokeWidth?: number }>
}

// 국내 독바 (기본)
const DOMESTIC_TABS: Tab[] = [
  { key: 'home',    href: '/',        label: '홈',       Icon: Map        },
  { key: 'list',    href: '/list',    label: '리스트',   Icon: Search     },
  { key: 'add',     href: '/add',     label: '장소 추가', Icon: PlusCircle },
  { key: 'profile', href: '/profile', label: '마이페이지', Icon: User      },
]

// 해외(dramndish Global) 독바 — 임시 조치(§ 모바일 UI).
// 홈이 리스트를 겸하므로 리스트 버튼 제거. 국내 복귀는 상단 앱바/마이페이지 토글로.
const GLOBAL_TABS: Tab[] = [
  { key: 'home',    href: '/global',     label: '홈',       Icon: Map        },
  { key: 'add',     href: '/global/add', label: '장소 추가', Icon: PlusCircle },
  { key: 'profile', href: '/global/me',  label: '마이페이지', Icon: User      },
]

// variant로 어느 독바를 그릴지 결정한다.
// 루트 레이아웃의 공유 컴포넌트에서는 usePathname/useSelectedLayoutSegment가
// 소프트 내비에 반응하지 않으므로(정적 프리렌더), 라우트별 레이아웃에서 variant를 넘긴다.
//  - 국내(기본): app/layout.tsx 에서 <BottomNav />
//  - 해외:       app/global/layout.tsx 에서 <BottomNav variant="global" /> + 국내 독바 숨김
export default function BottomNav({ variant = 'domestic' }: { variant?: 'domestic' | 'global' }) {
  const pathname = usePathname()
  const router   = useRouter()

  const tabs = variant === 'global' ? GLOBAL_TABS : DOMESTIC_TABS

  return (
    <nav
      data-dock={variant}
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 flex items-stretch"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tabs.map(({ key, href, label, Icon }) => {
        const isActive = pathname === href
        const color    = isActive ? PRIMARY : GRAY

        return (
          <button
            key={key}
            onClick={() => router.push(href)}
            className="flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 active:bg-gray-50 transition-colors"
          >
            <Icon size={22} color={color} strokeWidth={isActive ? 2.2 : 1.8} />
            <span className="text-[11px] font-semibold leading-none" style={{ color }}>
              {label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
