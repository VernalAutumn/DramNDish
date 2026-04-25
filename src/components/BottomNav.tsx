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

const TABS: Tab[] = [
  { key: 'home',    href: '/',        label: '홈',       Icon: Map        },
  { key: 'list',    href: '/list',    label: '리스트',   Icon: Search     },
  { key: 'add',     href: '/add',     label: '장소 추가', Icon: PlusCircle },
  { key: 'profile', href: '/profile', label: '마이페이지', Icon: User      },
]

export default function BottomNav() {
  const pathname = usePathname()
  const router   = useRouter()


  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 flex items-stretch"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map(({ key, href, label, Icon }) => {
        const isActive = pathname === href
        const color    = isActive ? PRIMARY : GRAY

        return (
          <button
            key={key}
            onClick={() => router.push(href)}
            className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 active:bg-gray-50 transition-colors"
          >
            <Icon size={22} color={color} strokeWidth={isActive ? 2.2 : 1.8} />
            <span className="text-[10px] font-semibold leading-none" style={{ color }}>
              {label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
