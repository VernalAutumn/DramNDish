// 영어 도시/지명 → 한국어 표기 사전.
// 등록 시 region(도시) 자동채움 전용 — 구글에서 받은 "영어 도시"를 사전에 있을 때만
// 한국어로 바꿔 표기를 통일한다. 사전에 없으면 영어 그대로(임의 기계번역으로 표기가
// 갈리는 것을 막기 위함). 위스키 지역(하이랜드·스페이사이드 등)은 지명이 아니라
// 산업 구분이라 여기에 두지 않는다 — 영어로 들어오거나 사용자가 직접 수정한다.
//
// 키는 소문자. 구글이 주는 변형(예: 'isle of islay')도 같은 한국어로 매핑해 둔다.
const CITY_KO: Record<string, string> = {
  // ── 일본 (JP) ──
  tokyo: '도쿄', kyoto: '교토', osaka: '오사카', yokohama: '요코하마',
  nagoya: '나고야', sapporo: '삿포로', kobe: '고베', fukuoka: '후쿠오카',
  hakata: '하카타', sendai: '센다이', hiroshima: '히로시마', kanazawa: '가나자와',
  nara: '나라', hakodate: '하코다테', niigata: '니가타', okinawa: '오키나와',
  naha: '나하', nikko: '닛코', otaru: '오타루', yamazaki: '야마자키',

  // ── 대만 (TW) ──
  taipei: '타이베이', 'new taipei': '신베이', taichung: '타이중', tainan: '타이난',
  kaohsiung: '가오슝', hsinchu: '신주', taoyuan: '타오위안', keelung: '지룽',

  // ── 영국 (UK) ── 도시 + 위스키 관련 타운/섬(지명)
  london: '런던', edinburgh: '에든버러', glasgow: '글래스고', manchester: '맨체스터',
  liverpool: '리버풀', aberdeen: '애버딘', inverness: '인버네스', dundee: '던디',
  perth: '퍼스', stirling: '스털링', oban: '오반', campbeltown: '캠벨타운',
  islay: '아일라', 'isle of islay': '아일라', bowmore: '보모어', 'port ellen': '포트엘런',
  elgin: '엘긴', dufftown: '더프타운', aberlour: '애버라워', keith: '키스',
  rothes: '로시스', tain: '테인', pitlochry: '피틀로흐리',

  // ── 미국 (US) ──
  'new york': '뉴욕', 'los angeles': '로스앤젤레스', 'san francisco': '샌프란시스코',
  chicago: '시카고', louisville: '루이빌', lexington: '렉싱턴', 'las vegas': '라스베이거스',
  seattle: '시애틀', boston: '보스턴', austin: '오스틴', portland: '포틀랜드',
  nashville: '내슈빌', 'new orleans': '뉴올리언스', washington: '워싱턴', miami: '마이애미',
  denver: '덴버', 'san diego': '샌디에이고', atlanta: '애틀랜타', dallas: '댈러스',
  houston: '휴스턴', philadelphia: '필라델피아',
}

/**
 * 영어 도시/지명을 한국어로 바꾼다. 사전에 있으면 한국어, 없으면 입력값(영어)을 그대로 돌려준다.
 * 대소문자·앞뒤 공백 무시.
 */
export function toKoreanCity(name?: string | null): string {
  const v = (name ?? '').trim()
  if (!v) return v
  return CITY_KO[v.toLowerCase()] ?? v
}
