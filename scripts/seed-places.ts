/**
 * 장소 시드 스크립트
 * 실행: npx tsx scripts/seed-places.ts
 * (개발 서버가 http://localhost:3000 에서 실행 중이어야 합니다)
 */

const BASE_URL = 'http://localhost:3000/api/places'

const seedData = [
  { name: '서울풍물시장',        address: '서울 동대문구 천호대로4길 21',    type: 'whisky', naver_place_id: '12827607',   district: '동대문구', city: '서울' },
  { name: '남대문시장',          address: '서울 중구 남대문시장4길 21',       type: 'whisky', naver_place_id: '13304144',   district: '중구',     city: '서울' },
  { name: '보틀벙커 서울역',      address: '서울 중구 한강대로 405',          type: 'whisky', naver_place_id: '1525647819', district: '중구',     city: '서울' },
  { name: '세찌상회',            address: '서울 동대문구 약령중앙로6길 5',    type: 'whisky', naver_place_id: '1541945477', district: '동대문구', city: '서울' },
  { name: '우성그린마트',         address: '서울 양천구 지양로 78',           type: 'whisky', naver_place_id: '34367540',   district: '양천구',   city: '서울' },
  { name: '은평모닝마트',         address: '서울 은평구 응암로4길 20',         type: 'whisky', naver_place_id: '1958876860', district: '은평구',   city: '서울' },
  { name: '알코홀릭드링크 이수점', address: '서울 동작구 동작대로29길 11-1',   type: 'whisky', naver_place_id: '1129168688', district: '동작구',   city: '서울' },
  { name: '마포글로벌마트',       address: '서울 마포구 토정로31길 23',        type: 'whisky', naver_place_id: '2069441314', district: '마포구',   city: '서울' },
  { name: '보틀즈 논현점',       address: '서울 강남구 학동로4길 50',          type: 'whisky', naver_place_id: '1326713568', district: '강남구',   city: '서울' },
  { name: '플러스보틀',          address: '서울 종로구 대학로2길 29',          type: 'whisky', naver_place_id: '1314130243', district: '종로구',   city: '서울' },
  { name: '스타보틀 합정',        address: '서울 마포구 합정동 401-7',         type: 'whisky', naver_place_id: '1706815184', district: '마포구',   city: '서울' },
]

async function seed() {
  console.log(`총 ${seedData.length}개 장소 등록 시작...\n`)

  let success = 0
  let failed = 0

  for (const place of seedData) {
    try {
      const res = await fetch(BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(place),
      })

      const data = await res.json()

      if (res.ok) {
        console.log(`✅ ${place.name} → lat: ${data.lat}, lng: ${data.lng}`)
        success++
      } else {
        console.error(`❌ ${place.name} → ${data.error}`)
        failed++
      }
    } catch (err) {
      console.error(`❌ ${place.name} → 요청 실패: ${err}`)
      failed++
    }
  }

  console.log(`\n완료: 성공 ${success}개 / 실패 ${failed}개`)
}

seed()
