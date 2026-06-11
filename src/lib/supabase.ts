import { createClient } from '@supabase/supabase-js'

export function createSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are required.')
  }

  return createClient(supabaseUrl, supabaseAnonKey)
}

// dramndish Global(해외) — 같은 프로젝트의 별도 `global` 스키마를 쓴다.
// 적용 절차·권한 모델: supabase/DRAMNDISH_README.md
export function createDramndishClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are required.')
  }

  return createClient(supabaseUrl, supabaseAnonKey, { db: { schema: 'global' } })
}
