import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/src/lib/supabase'

// PATCH body: { payment_methods: string[] }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { payment_methods } = await req.json()

  const { data, error } = await supabase
    .from('places')
    .update({ payment_methods })
    .eq('id', id)
    .select('payment_methods')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}
