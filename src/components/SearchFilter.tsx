'use client'

import { useState, useCallback } from 'react'

export interface FilterState {
  query:      string
  type:       'all' | 'whisky' | 'restaurant' | 'bar'
  corkage:    boolean
  categories: string[]
}

export const INITIAL_FILTER: FilterState = {
  query: '', type: 'all', corkage: false, categories: [],
}

const CATEGORIES = ['한식', '일식', '중식', '양식', '아시안', '기타'] as const
const TYPE_OPTIONS = [
  { value: 'all',        label: '전체'   },
  { value: 'whisky',     label: '리쿼샵' },
  { value: 'restaurant', label: '식당'   },
  { value: 'bar',        label: '바'     },
] as const

const PRIMARY = '#BF3A21'
const ORANGE  = '#F97316'

interface Props {
  onChange: (f: FilterState) => void
}

export default function SearchFilter({ onChange }: Props) {
  const [query,      setQuery]      = useState('')
  const [type,       setType]       = useState<FilterState['type']>('all')
  const [corkage,    setCorkage]    = useState(false)
  const [categories, setCategories] = useState<string[]>([])

  const emit = useCallback(
    (patch: Partial<FilterState>) =>
      onChange({ query, type, corkage, categories, ...patch }),
    [query, type, corkage, categories, onChange],
  )

  const handleType = (v: FilterState['type']) => {
    setType(v)
    const c = v !== 'restaurant' ? false : corkage
    const k = v !== 'restaurant' ? []    : categories
    setCorkage(c)
    setCategories(k)
    emit({ type: v, corkage: c, categories: k })
  }

  const toggleCategory = (cat: string) => {
    const next = categories.includes(cat)
      ? categories.filter((c) => c !== cat)
      : [...categories, cat]
    setCategories(next)
    emit({ categories: next })
  }

  const toggleCorkage = () => {
    const n = !corkage
    setCorkage(n)
    emit({ corkage: n })
  }

  return (
    <div className="px-3.5 pt-2.5 pb-3 space-y-2.5">

      {/* 텍스트 검색 */}
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); emit({ query: e.target.value }) }}
        placeholder="장소명 검색"
        className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none transition-colors focus:border-gray-400 placeholder:text-gray-300"
      />

      {/* 종류 필터 칩 */}
      <div className="flex gap-1.5">
        {TYPE_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => handleType(value)}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-all border ${
              type === value
                ? 'text-white border-transparent'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
            }`}
            style={type === value ? { backgroundColor: PRIMARY } : {}}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 식당 전용 필터 */}
      {type === 'restaurant' && (
        <div className="space-y-2">
          {/* 콜키지 토글 */}
          <button
            onClick={toggleCorkage}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
              corkage
                ? 'text-white border-transparent'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
            }`}
            style={corkage ? { backgroundColor: ORANGE } : {}}
          >
            콜키지 가능
          </button>

          {/* 대분류 다중 선택 */}
          <div className="flex gap-1.5 flex-wrap">
            {CATEGORIES.map((cat) => {
              const active = categories.includes(cat)
              return (
                <button
                  key={cat}
                  onClick={() => toggleCategory(cat)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                    active
                      ? 'text-white border-transparent'
                      : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
                  }`}
                  style={active ? { backgroundColor: ORANGE } : {}}
                >
                  {cat}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
