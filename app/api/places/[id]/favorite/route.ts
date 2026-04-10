import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/src/lib/supabase'

// POST body: { action: 'add' | 'remove' }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { action } = await req.json()

  const { data, error } = await supabase
    .from('places')
    .select('favorites_count')
    .eq('id', id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Place not found' }, { status: 404 })

  const newCount = Math.max(0, (data.favorites_count ?? 0) + (action === 'add' ? 1 : -1))

  const { error: updateError } = await supabase
    .from('places')
    .update({ favorites_count: newCount })
    .eq('id', id)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return NextResponse.json({ favorites_count: newCount })
}
