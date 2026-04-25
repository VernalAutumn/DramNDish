'use client'

import { createContext, useContext, useState, useCallback } from 'react'

export type MobileTab = 'home' | 'list' | 'add' | 'profile'

interface MobileTabContextType {
  activeTab: MobileTab
  setActiveTab: (tab: MobileTab) => void
}

const MobileTabContext = createContext<MobileTabContextType>({
  activeTab: 'home',
  setActiveTab: () => {},
})

export function MobileTabProvider({ children }: { children: React.ReactNode }) {
  const [activeTab, setActiveTabState] = useState<MobileTab>('home')
  const setActiveTab = useCallback((tab: MobileTab) => setActiveTabState(tab), [])
  return (
    <MobileTabContext.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </MobileTabContext.Provider>
  )
}

export const useMobileTab = () => useContext(MobileTabContext)
