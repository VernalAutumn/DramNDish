import BottomNav from '@/src/components/BottomNav'

// 해외(dramndish Global) 전용 레이아웃.
// 루트 레이아웃의 공유 BottomNav는 현재 라우트를 반응형으로 알 수 없으므로,
// /global/* 에서는 이 레이아웃이 마운트되는 동안에만 국내 독바를 숨기고 해외 독바를 띄운다.
// (소프트 내비로 빠져나가면 이 레이아웃이 언마운트되어 국내 독바가 다시 보인다.)
export default function GlobalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`nav[data-dock="domestic"]{display:none !important}`}</style>
      {children}
      <BottomNav variant="global" />
    </>
  )
}
