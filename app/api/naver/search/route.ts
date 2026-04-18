import { NextRequest, NextResponse } from 'next/server'

const GEOCODE_URL = 'https://maps.apigw.ntruss.com/map-geocode/v2/geocode'
const SEARCH_URL  = 'https://openapi.naver.com/v1/search/local.json'

function stripHtml(str: string) {
  return str.replace(/<[^>]*>/g, '')
}

function parseKoreanAddress(roadAddress: string) {
  const parts = roadAddress.split(' ').filter(Boolean)
  const raw   = parts[0] ?? ''
  const city  = raw
    .replace('특별시', '').replace('광역시', '')
    .replace('특별자치시', '').replace('특별자치도', '').replace('도', '') || null
  const district = parts[1] ?? null
  return { city, district }
}

function extractNaverPlaceId(link: string): string | null {
  // 패턴 1: /place/123456 또는 place=123456
  const m1 = link.match(/place[/=](\d+)/)
  if (m1) return m1[1]
  // 패턴 2: /restaurant/123456, /cafe/123456 등 카테고리형 URL
  const m2 = link.match(/\/(?:restaurant|cafe|store|beauty|hospital|accommodation|leisure|culture|academic|public|agent)\/(\d+)/)
  if (m2) return m2[1]
  // 패턴 3: entry/place?id=123456 형태
  const m3 = link.match(/[?&]id=(\d+)/)
  if (m3) return m3[1]
  return null
}

async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `${GEOCODE_URL}?query=${encodeURIComponent(address)}`,
      {
        headers: {
          'X-NCP-APIGW-API-KEY-ID': process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID!,
          'X-NCP-APIGW-API-KEY':    process.env.NAVER_MAP_CLIENT_SECRET!,
        },
      }
    )
    if (!res.ok) return null
    const data = await res.json()
    const addr = data.addresses?.[0]
    if (!addr) return null
    return { lat: parseFloat(addr.y), lng: parseFloat(addr.x) }
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('query')?.trim()
  if (!query) {
    return NextResponse.json({ error: 'query 파라미터가 필요합니다.' }, { status: 400 })
  }

  const clientId     = process.env.NAVER_SEARCH_CLIENT_ID
  const clientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET 환경변수가 설정되지 않았습니다.' },
      { status: 500 }
    )
  }

  const searchRes = await fetch(
    `${SEARCH_URL}?query=${encodeURIComponent(query)}&display=5&sort=random`,
    {
      headers: {
        'X-Naver-Client-Id':     clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
    }
  )

  if (!searchRes.ok) {
    const text = await searchRes.text()
    console.error('[naver search]', searchRes.status, text)
    return NextResponse.json({ error: '네이버 검색 API 오류', detail: text }, { status: 502 })
  }

  const searchData = await searchRes.json()
  const items: any[] = searchData.items ?? []

  // 상위 5개에 대해 병렬로 geocoding
  const results = await Promise.all(
    items.slice(0, 5).map(async (item) => {
      const name          = stripHtml(item.title)
      const roadAddress   = item.roadAddress || item.address || ''
      const { city, district } = parseKoreanAddress(roadAddress)
      const naver_place_id = extractNaverPlaceId(item.link ?? '')
      const coords        = await geocode(roadAddress)
      return { name, address: roadAddress, city, district, naver_place_id, coords, category: stripHtml(item.category ?? '') }
    })
  )

  // 좌표 변환 실패한 항목 제외
  const valid = results.filter((r) => r.coords !== null)

  return NextResponse.json(valid)
}
