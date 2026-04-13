// src/app/api/places/[id]/photos/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 환경 변수에서 Supabase 설정 가져오기
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// [GET] 해당 장소의 사진 목록 불러오기
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { data, error } = await supabase
    .from('place_photos')
    .select('*')
    .eq('place_id', params.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// [POST] 새 사진 업로드 및 DB 저장
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const nickname = formData.get('nickname') as string || '익명'; // 라이트버전 닉네임 정책

    if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 });

    // 1. 파일 이름 난수화 및 Supabase Storage 업로드
    const fileExt = file.name.split('.').pop();
    const fileName = `${params.id}_${Date.now()}.${fileExt}`;
    
    const { error: uploadError } = await supabase.storage
      .from('place_photos') // 만들어두신 버킷 이름
      .upload(fileName, file);

    if (uploadError) throw uploadError;

    // 2. 업로드된 사진의 Public URL 가져오기
    const { data: { publicUrl } } = supabase.storage
      .from('place_photos')
      .getPublicUrl(fileName);

    // 3. 알아낸 URL과 정보를 place_photos DB 테이블에 저장
    const { data: dbData, error: dbError } = await supabase
      .from('place_photos')
      .insert({
        place_id: params.id,
        url: publicUrl,
        nickname: nickname
      })
      .select()
      .single();

    if (dbError) throw dbError;

    return NextResponse.json(dbData);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}