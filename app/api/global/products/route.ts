import { NextRequest, NextResponse } from 'next/server'
import { createDramndishClient } from '@/src/lib/supabase'

/**
 * GET /api/global/products?q=닛프배
 * 보틀 자동완성 (§7) — display_name 부분일치 + aliases(통용 약칭) 정확일치.
 * 약칭은 검색에만 쓰고 표시는 항상 display_name (§7 표기 규칙).
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 1) return NextResponse.json({ products: [] })

  const supabase = createDramndishClient()
  const { data, error } = await supabase
    .from('products')
    .select('id, display_name')
    .or(`display_name.ilike.%${q}%,aliases.cs.{"${q}"}`)
    .limit(8)

  if (error) {
    console.error('[global products GET]', error)
    return NextResponse.json({ products: [] })
  }
  return NextResponse.json({ products: data ?? [] })
}
