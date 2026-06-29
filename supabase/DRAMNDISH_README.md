# dramndish Global — Phase 1 백엔드 (DB 토대)

스펙: `dramndish-global-spec.md` §2(Phase 1)·§5(데이터 모델)·§6·§7·부록 A·C 기준.

## 구조 결정 (2026-06-11 승인됨)

- **국내판(tastamp)과 같은 Supabase 프로젝트**를 쓰되, **별도 `global` 스키마**에 모든 테이블을 생성한다.
  - 이유: 국내판 `public` 스키마에 이미 `places`·`reports` 테이블이 있어 이름이 충돌한다.
- `auth.users` 는 국내판과 **공유**된다 (같은 계정으로 양쪽 서비스 이용).
- dramndish 프로필(`global.users`)은 auth 트리거가 아니라 **첫 로그인 시 앱에서 upsert** 한다.
  트리거를 쓰면 국내판 가입자 전원에게 dramndish 프로필이 생기기 때문. RLS 정책
  (`users_insert_self` / `users_update_self`)이 본인 행 upsert를 허용한다.

## 적용 순서 (수동 — 프로비저닝 자동화 금지, 부록 C)

Supabase SQL Editor에서 순서대로 실행:

1. `migrations/20260611_0001_dramndish_schema.sql` — `global` 스키마 + 테이블 + 인덱스 + display_name 트리거 + 검증 상태 뷰
2. `migrations/20260611_0002_dramndish_rls_grants.sql` — RLS 정책 + 명시적 GRANT
3. `seed/dramndish_seed.sql` — 샘플 시드 (장소 5곳, 제품 4종)

그다음 **대시보드 설정 (필수, SQL로 불가):**

4. **Settings → API → "Exposed schemas"** 에 `global` 추가.
   - 이걸 빼먹으면 GRANT가 있어도 supabase-js가 schema not exposed 에러를 낸다.

### 후기 작성 슬라이스 추가 적용 (2026-06-13)

기존 프로젝트라면 아래를 추가로 실행:

5. `migrations/20260613_0003_reviews_companion_bottle_photos.sql`
   — reviews 방문맥락 컬럼(companion_type·party_size) + bottle_logs 사진배열·식당메뉴 context
6. `migrations/20260613_0004_storage_bucket.sql`
   — 사진 Storage 버킷 `global-photos`(공개 읽기) + 업로드/삭제 정책
   - 경로 규약: `global/{auth.uid()}/{파일명}` — 본인 폴더에만 업로드 가능
7. `migrations/20260613_0005_review_bar_fields.sql` — 바 후기 흡연·커버차지 컬럼
8. `migrations/20260613_0006_photos.sql` — 사진 테이블(설명 포함) + RLS·GRANT
9. `migrations/20260613_0007_verification_window_14d.sql` — 관찰 검증 기간 14일
10. `migrations/20260613_0008_tags.sql` — 장소 태그(place_tags·tag_votes, 1인 1표) + RLS·GRANT
11. `migrations/20260629_0015_observations_auto_purge.sql` — 관찰 30일 자동 삭제(pg_cron)
    - ⚠ pg_cron 확장 필요(대시보드 Database → Extensions). 미적용이어도 앱은 30일 컷오프로
      오래된 관찰을 숨기므로, cron 은 저장소 정리용.

시드 재실행 시(`seed/dramndish_seed.sql`)는 멱등 — `source='seed'` 행을 먼저
비우므로 중복 등록이 정리된다.

## 클라이언트 접근

```ts
// 전용 클라이언트 (권장)
const dnd = createClient(url, anonKey, { db: { schema: 'global' } })
// 또는 호출별
supabase.schema('global').from('places').select('*')
```

부록 C 주의: 이후 `global`에 테이블을 추가할 때마다 **RLS 활성화 + 정책 + 명시적
GRANT 3종을 반드시 함께** 작성한다. GRANT 누락 시 supabase-js가 조용히 빈 결과를 반환한다.

## 권한 모델 요약

| 테이블 | anon 읽기 | auth 읽기 | 쓰기 |
|---|---|---|---|
| users | ✅ (닉네임 표시용) | ✅ | 본인 insert/update |
| places | ✅ | ✅ | auth insert (본인 명의, source=community). 수정·삭제는 service_role |
| products | ✅ | ✅ | auth insert. 정제·병합은 service_role |
| reviews | ✅ | ✅ | 본인 insert/update/delete |
| bottle_logs | public_minimal 행만 | public_minimal + 본인 행 | 본인 insert/update/delete |
| observations | ✅ | ✅ | 본인 insert/delete (수정 없음 — 새 관찰로 갱신) |
| favorites | ❌ | 본인 행만 | 본인 insert/delete |
| review_votes | ✅ (집계 공개) | ✅ | 본인 insert/update/delete (1인 1표는 PK) |
| reports | ❌ | 본인 신고만 | auth insert. 처리(status)·대상 삭제는 service_role |
| itineraries(+stops) | ❌ | ❌ | ❌ — Phase 2까지 GRANT·정책 없이 잠금 |

관리자 모더레이션(§8.2-8)은 **service_role** 키(서버/대시보드)로 수행 — RLS·GRANT 우회.
admin role 컬럼은 스펙 §5에 없어 두지 않았다.

## TODO / 스펙 미정 사항 (추측 금지 — 결정 필요)

- [ ] **검증 기간**: §8.4 "일정 기간 내 2건 이상"의 기간 미정 → `observations_with_status` 뷰에 **30일로 가정**. 확정 시 0001 뷰의 `30` 수정.
- [ ] **비회원 신고**: 국내판은 허용, 글로벌 스펙은 미언급 → 일단 **로그인 필수**(`reporter_id not null`).
- [ ] **users 공개 컬럼**: 현재 `taste_profile`·`membership`까지 공개 select에 노출. Phase 2 전 공개 프로필 뷰 또는 column-level grant로 분리 검토.
- [ ] **IB샵 region 표기**(§6): 에든버러 시내 매장 등 위스키 지역 태그가 애매한 케이스 → 시드에선 '로우랜드'로 임시 처리.
- [ ] **시드 좌표·attributes**: 좌표는 근사값. 증류소 투어 프로그램·현장 상품은 §6 관리자 큐레이션으로 채울 것 (확실한 사실만 시드함).
- [ ] **Auth UI/세션 골격(Next.js 측)**: DB 정책은 준비됨. 로그인 플로우·`global` 스키마 클라이언트 헬퍼는 프론트 슬라이스에서 (이번 범위 = 백엔드/데이터 토대).
