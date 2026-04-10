import { supabase } from '@/src/lib/supabase'
import PlaceDetailClient from '@/src/components/PlaceDetailClient'
import { notFound } from 'next/navigation'

export default async function PlacePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const [{ data: place, error }, { data: tags }] = await Promise.all([
    supabase.from('places').select('*').eq('id', id).single(),
    supabase.from('tags').select('*').eq('place_id', id).order('count', { ascending: false }),
  ])

  if (error || !place) notFound()

  return <PlaceDetailClient place={place} initialTags={tags ?? []} />
}
