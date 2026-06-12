'use client'

import { useRef } from 'react'

// 사진 1~2장 첨부 공용 컴포넌트 (후기 폼·구매 인증 폼에서 사용)
export default function PhotoPicker({
  files,
  setFiles,
  label,
}: {
  files: File[]
  setFiles: (f: File[]) => void
  label: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-700">{label}</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-gray-300 text-gray-700 flex-shrink-0"
        >
          📷 사진 첨부 ({files.length}/2)
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? [])
          setFiles([...files, ...picked].slice(0, 2))
          e.target.value = ''
        }}
      />
      {files.length > 0 && (
        <div className="flex gap-2 mt-2">
          {files.map((f, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={URL.createObjectURL(f)} alt="" className="w-16 h-16 object-cover rounded-lg" />
              <button
                type="button"
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-800 text-white text-[10px] leading-none"
                aria-label="사진 제거"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
