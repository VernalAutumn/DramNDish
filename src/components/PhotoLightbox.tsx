'use client'

import { useEffect } from 'react'

// 사진 확대 보기 — 모든 사진 클릭에 공용 적용.
// 단순 열람이므로 바깥 클릭·ESC로 닫아도 무방(작성 폼과 달리 소실 위험 없음).
export default function PhotoLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[100] bg-black/85 flex items-center justify-center p-4" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className="max-w-full max-h-full object-contain rounded"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white text-3xl leading-none"
        aria-label="닫기"
      >
        ×
      </button>
    </div>
  )
}
