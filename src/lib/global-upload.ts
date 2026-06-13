import { createClient } from '@/src/lib/supabase-browser'

// dramndish Global 사진 업로드 (클라이언트 전용).
// Storage 버킷 global-photos, 경로 규약 global/{uid}/{파일명}
// — 버킷 정책이 본인 uid 폴더만 허용 (20260613_0004 마이그레이션).
// 업로드 후 공개 URL(텍스트)만 reviews/bottle_logs 컬럼에 저장한다.

const BUCKET = 'global-photos'
const MAX_PHOTOS = 5
const MAX_SIZE_MB = 8

export async function uploadGlobalPhotos(files: File[], uid: string): Promise<string[]> {
  const supabase = createClient()
  const urls: string[] = []

  for (const file of files.slice(0, MAX_PHOTOS)) {
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      throw new Error(`사진은 ${MAX_SIZE_MB}MB 이하만 올릴 수 있습니다.`)
    }
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `global/${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

    const { error } = await supabase.storage.from(BUCKET).upload(path, file)
    if (error) throw new Error(`사진 업로드 실패: ${error.message}`)

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    urls.push(data.publicUrl)
  }
  return urls
}
