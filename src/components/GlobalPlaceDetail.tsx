'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  GlobalPlace,
  GlobalReview,
  GlobalBottleLog,
  GlobalObservation,
  GLOBAL_TYPE_LABEL,
  BOTTLE_CONTEXT_LABEL,
  OBS_TYPE_LABEL,
  VALUE_BUCKET_LABEL,
  countryLabel,
  daysSince,
  freshnessColor,
} from '@/src/lib/global'

// 해외 장소 상세 패널 — §8.2 표시 순서를 따른다.
// 작성 기능(후기·관찰·즐겨찾기·신고)은 다음 슬라이스 — 미구현은 '준비중'으로
// 명시하고 클릭 가능한 척하지 않는다 (§1 데이터 정직성).

interface DetailData {
  place: GlobalPlace
  reviews: GlobalReview[]
  reviewsFailed: boolean
  bottleLogs: GlobalBottleLog[]
  bottleLogsFailed: boolean
  observations: GlobalObservation[]
  observationsFailed: boolean
}

type Status = 'loading' | 'ready' | 'error'

// 값 없음(undefined)과 false를 구분해 표기 — §6 "없는 값은 키를 넣지 않는다"
function fmtBool(v: unknown, yes: string, no: string): string {
  if (v === true) return yes
  if (v === false) return no
  return '정보 없음'
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  const isEmpty = value === undefined || value === null || value === '정보 없음'
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-xs text-gray-500 flex-shrink-0">{label}</span>
      <span className={`text-xs text-right ${isEmpty ? 'text-gray-400' : 'text-gray-800 font-medium'}`}>
        {isEmpty ? '정보 없음' : value}
      </span>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[13px] font-bold text-gray-900 mt-5 mb-1.5">{children}</h3>
}

export default function GlobalPlaceDetail({
  placeId,
  onClose,
}: {
  placeId: string
  onClose: () => void
}) {
  const [status, setStatus] = useState<Status>('loading')
  const [data, setData] = useState<DetailData | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await fetch(`/api/global/places/${placeId}`)
      if (!res.ok) throw new Error()
      setData(await res.json())
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [placeId])

  useEffect(() => {
    load()
  }, [load])

  const copyAddress = useCallback(async (address: string) => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard 미지원 — 조용히 실패하지 않기
      alert('복사에 실패했습니다. 주소를 직접 선택해 주세요.')
    }
  }, [])

  if (status === 'loading') {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-gray-500">불러오는 중…</p>
      </div>
    )
  }

  if (status === 'error' || !data) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm font-medium text-gray-800">일시 오류가 발생했습니다.</p>
        <button
          onClick={load}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700"
        >
          재시도
        </button>
      </div>
    )
  }

  const { place, reviews, bottleLogs, observations } = data
  const attrs = place.attributes ?? {}

  // §8.2-4 재방문 의사 분포 (reviews.rating 집계)
  const rated = reviews.filter((r) => r.rating)
  const ratingCount = (k: string) => rated.filter((r) => r.rating === k).length
  const comments = reviews.filter((r) => r.comment && r.comment.trim() !== '')

  const isDistillery = place.type === 'distillery'
  const tourPrograms = attrs.tour_programs as
    | { name?: string; type?: string; season?: string; price?: number | string; booking_required?: boolean; booking_url?: string; duration?: string }[]
    | undefined
  const onsiteOfferings = attrs.onsite_offerings as
    | { name?: string; category?: string; note?: string }[]
    | undefined
  const referencePrices = attrs.reference_prices as
    | { product?: string; price?: number | string; currency?: string }[]
    | undefined

  return (
    <div className="h-full flex flex-col">
      {/* 헤더: 1. 명칭 + 분류 */}
      <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-border-default flex-shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-bold text-gray-900">{place.name}</h2>
            <span
              className="text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0"
              style={{ background: '#f3f4f6', color: '#4b5563' }}
            >
              {GLOBAL_TYPE_LABEL[place.type] ?? place.type}
              {place.subkind === 'ib_shop' && ' · IB 직영점'}
            </span>
          </div>
          {place.name_local && <p className="text-xs text-gray-400 mt-0.5">{place.name_local}</p>}
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-xl leading-none px-1 flex-shrink-0"
          aria-label="닫기"
        >
          ×
        </button>
      </div>

      <div className="overflow-y-auto px-5 pb-8 flex-1">
        {/* 2. 주소 + 신고 */}
        <div className="flex items-start justify-between gap-2 mt-3">
          <p className="text-xs text-gray-600">
            {countryLabel(place.country)}
            {place.region ? ` · ${place.region}` : ''}
            {place.address ? ` · ${place.address}` : ' · 주소 정보 없음'}
          </p>
          {/* TODO(다음 슬라이스): global.reports 연동 신고 모달 */}
          <button
            disabled
            className="text-[11px] text-gray-400 border border-gray-200 rounded-md px-2 py-1 flex-shrink-0 cursor-not-allowed"
            title="신고 기능은 준비중입니다"
          >
            신고 (준비중)
          </button>
        </div>

        {/* 3. 즐겨찾기 + 지도보기 */}
        <div className="flex gap-2 mt-3">
          {/* TODO(다음 슬라이스): global.favorites 연동 */}
          <button
            disabled
            className="flex-1 py-2 text-xs font-medium rounded-lg border border-gray-200 text-gray-400 cursor-not-allowed"
            title="즐겨찾기는 준비중입니다"
          >
            ☆ 즐겨찾기 (준비중)
          </button>
          {place.google_maps_url ? (
            <a
              href={place.google_maps_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-2 text-xs font-bold rounded-lg text-center text-white"
              style={{ background: 'var(--color-brand-primary)' }}
            >
              지도보기
            </a>
          ) : (
            <button
              disabled
              className="flex-1 py-2 text-xs font-medium rounded-lg border border-gray-200 text-gray-400 cursor-not-allowed"
            >
              지도 링크 없음
            </button>
          )}
          {place.address && (
            <button
              onClick={() => copyAddress(place.address!)}
              className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 text-gray-700"
            >
              {copied ? '복사됨!' : '주소 복사'}
            </button>
          )}
        </div>

        {/* 4. 재방문 의사 분포 */}
        <SectionTitle>재방문 의사</SectionTitle>
        {rated.length === 0 ? (
          <p className="text-xs text-gray-400">
            아직 후기가 없습니다. (후기 작성 기능 준비중)
          </p>
        ) : (
          <div className="space-y-1.5">
            {(
              [
                { key: 'revisit', label: '또 가고 싶어요' },
                { key: 'fine', label: '괜찮았어요' },
                { key: 'meh', label: '아쉬웠어요' },
              ] as const
            ).map(({ key, label }) => {
              const n = ratingCount(key)
              const pct = Math.round((n / rated.length) * 100)
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-600 w-24 flex-shrink-0">{label}</span>
                  <div className="flex-1 h-2 rounded-full bg-surface-tertiary overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: 'var(--color-brand-primary)' }}
                    />
                  </div>
                  <span className="text-[11px] text-gray-500 w-10 text-right">{n}명</span>
                </div>
              )
            })}
          </div>
        )}

        {/* 4-1. 면세 여부 (리쿼샵 — 일본 등에서 중요) */}
        {place.type === 'liquor_shop' && (
          <p className="text-xs mt-2">
            <span className="font-medium text-gray-700">면세: </span>
            <span className={attrs.tax_free === undefined ? 'text-gray-400' : 'text-gray-800'}>
              {fmtBool(attrs.tax_free, '면세 가능', '면세 불가')}
            </span>
          </p>
        )}

        {/* 유형별 정보 (§8.2 유형별 본문) */}
        <SectionTitle>{GLOBAL_TYPE_LABEL[place.type] ?? '장소'} 정보</SectionTitle>
        <div className="divide-y divide-gray-100">
          {place.type === 'liquor_shop' && (
            <>
              <InfoRow label="시음" value={fmtBool(attrs.has_tasting, '가능', '불가')} />
              <InfoRow label="핸드필" value={fmtBool(attrs.has_handfill, '있음', '없음')} />
              <InfoRow label="영업시간" value={(attrs.hours as string) ?? '정보 없음'} />
            </>
          )}
          {place.type === 'bar' && (
            <>
              <InfoRow
                label="커버차지"
                value={attrs.cover_charge != null ? String(attrs.cover_charge) : '정보 없음'}
              />
              <InfoRow label="흡연" value={fmtBool(attrs.smoking, '흡연 가능', '금연')} />
              <InfoRow label="전문 주종" value={(attrs.specialty as string) ?? '정보 없음'} />
              <InfoRow
                label="제휴"
                value={
                  Array.isArray(attrs.affiliations) && attrs.affiliations.length > 0
                    ? (attrs.affiliations as string[]).join(', ')
                    : '정보 없음'
                }
              />
              <InfoRow label="영업시간" value={(attrs.hours as string) ?? '정보 없음'} />
            </>
          )}
          {place.type === 'restaurant' && (
            <>
              <InfoRow
                label="타베로그"
                value={
                  attrs.tabelog_url ? (
                    <a
                      href={attrs.tabelog_url as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                      style={{ color: 'var(--color-brand-primary)' }}
                    >
                      {attrs.tabelog_rating ? `평점 ${attrs.tabelog_rating}` : '링크'}
                    </a>
                  ) : (
                    '정보 없음'
                  )
                }
              />
              <InfoRow label="영업시간" value={(attrs.hours as string) ?? '정보 없음'} />
            </>
          )}
          {isDistillery && (
            <>
              <InfoRow label="접근·교통" value={(attrs.access as string) ?? '정보 없음'} />
              <InfoRow
                label="예약"
                value={
                  attrs.booking_required === undefined ? (
                    '정보 없음'
                  ) : (
                    <span>
                      {attrs.booking_required ? '예약 필수' : '예약 불필요'}
                      {!!attrs.booking_url && (
                        <>
                          {' · '}
                          <a
                            href={attrs.booking_url as string}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                            style={{ color: 'var(--color-brand-primary)' }}
                          >
                            예약 링크
                          </a>
                        </>
                      )}
                    </span>
                  )
                }
              />
              <InfoRow label="운영 시즌" value={(attrs.season as string) ?? '정보 없음'} />
              <InfoRow label="핸드필" value={fmtBool(attrs.handfill, '있음', '없음')} />
              <InfoRow label="보틀 구매 주의" value={(attrs.purchase_caution as string) ?? '정보 없음'} />
            </>
          )}
        </div>

        {/* distillery: 투어 프로그램 (관리자 큐레이션 — §6) */}
        {isDistillery && (
          <>
            <SectionTitle>투어 프로그램</SectionTitle>
            {!tourPrograms || tourPrograms.length === 0 ? (
              <p className="text-xs text-gray-400">투어 정보 없음 — 공식 사이트를 확인해 주세요.</p>
            ) : (
              <ul className="space-y-2">
                {tourPrograms.map((t, i) => (
                  <li key={i} className="border border-gray-100 rounded-lg px-3 py-2">
                    <p className="text-xs font-bold text-gray-800">{t.name ?? '이름 미상'}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {[t.type, t.season, t.duration, t.price != null ? `${t.price}` : null]
                        .filter(Boolean)
                        .join(' · ') || '상세 정보 없음'}
                      {t.booking_required && ' · 예약 필수'}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <SectionTitle>현장 상품·식음</SectionTitle>
            {!onsiteOfferings || onsiteOfferings.length === 0 ? (
              <p className="text-xs text-gray-400">정보 없음</p>
            ) : (
              <ul className="space-y-1">
                {onsiteOfferings.map((o, i) => (
                  <li key={i} className="text-xs text-gray-700">
                    {o.name}
                    {o.category && <span className="text-gray-400"> ({o.category})</span>}
                    {o.note && <span className="text-gray-500"> — {o.note}</span>}
                  </li>
                ))}
              </ul>
            )}

            <SectionTitle>공식·독점 정보</SectionTitle>
            {attrs.exclusive_md ? (
              <p className="text-xs text-gray-700 whitespace-pre-wrap">{attrs.exclusive_md as string}</p>
            ) : (
              <p className="text-xs text-gray-400">정보 없음</p>
            )}
          </>
        )}

        {/* liquor_shop: 기준 병가 */}
        {place.type === 'liquor_shop' && (
          <>
            <SectionTitle>기준 병가</SectionTitle>
            {!referencePrices || referencePrices.length === 0 ? (
              <p className="text-xs text-gray-400">
                가격 정보 없음 — 직접 등록해 주세요. (등록 기능 준비중)
              </p>
            ) : (
              <ul className="space-y-1">
                {referencePrices.map((rp, i) => (
                  <li key={i} className="text-xs text-gray-700 flex justify-between">
                    <span>{rp.product ?? '제품 미상'}</span>
                    <span className="font-medium">
                      {rp.price != null ? `${rp.price} ${rp.currency ?? ''}` : '가격 미상'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {/* 관찰 데이터 (§8.4 — 검증 상태·관찰일 항상 노출) */}
        <SectionTitle>최근 관찰 (카더라)</SectionTitle>
        {data.observationsFailed ? (
          <p className="text-xs text-gray-400">관찰 데이터를 불러오지 못했습니다.</p>
        ) : observations.length === 0 ? (
          <p className="text-xs text-gray-400">
            관찰 데이터 없음 — 다녀오셨다면 알려주세요. (입력 기능 준비중)
          </p>
        ) : (
          <ul className="space-y-2">
            {observations.map((o) => {
              const days = daysSince(o.observed_at)
              return (
                <li key={o.id} className="border border-gray-100 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-gray-800">
                      {OBS_TYPE_LABEL[o.obs_type] ?? o.obs_type}
                    </span>
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={
                        o.verification_status === 'confirmed'
                          ? { background: '#d1fae5', color: '#047857' }
                          : { background: '#fef3c7', color: '#b45309' }
                      }
                    >
                      {o.verification_status === 'confirmed' ? '확정' : '미확정'}
                    </span>
                    {o.obs_type === 'cask_level' && (
                      <span className="text-[10px] text-gray-400">직원 말 기반 — 카더라</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-700 mt-1">
                    {o.value_bucket ? (VALUE_BUCKET_LABEL[o.value_bucket] ?? o.value_bucket) : o.value_text ?? '—'}
                    {o.note && <span className="text-gray-500"> · {o.note}</span>}
                  </p>
                  <p className="text-[11px] mt-1 flex items-center gap-1.5">
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ background: freshnessColor(days) }}
                    />
                    <span className="text-gray-500">
                      {o.observed_at} ({days === 0 ? '오늘' : `${days}일 전`})
                    </span>
                    {days >= 15 && <span className="text-red-500 font-medium">방문 전 확인 권장</span>}
                  </p>
                </li>
              )
            })}
          </ul>
        )}

        {/* 5. 태그 — TODO: global 스키마에 태그 테이블이 스펙 §5에 정의되지 않음.
            스펙 확정 후 구현 (추측으로 만들지 않는다). */}
        <SectionTitle>태그</SectionTitle>
        <p className="text-xs text-gray-400">태그 기능 준비중</p>

        {/* 6. 사진 / 구매 인증 (bottle_logs public_minimal) */}
        <SectionTitle>사진 / 구매 인증</SectionTitle>
        {data.bottleLogsFailed ? (
          <p className="text-xs text-gray-400">구매 인증을 불러오지 못했습니다.</p>
        ) : bottleLogs.length === 0 ? (
          <p className="text-xs text-gray-400">
            구매 인증이 아직 없습니다. (등록 기능 준비중)
          </p>
        ) : (
          <ul className="space-y-2">
            {bottleLogs.map((b) => (
              <li key={b.id} className="border border-gray-100 rounded-lg px-3 py-2">
                {b.photo_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={b.photo_url}
                    alt=""
                    className="w-full max-h-44 object-cover rounded-md mb-2"
                  />
                )}
                <p className="text-xs font-bold text-gray-800">
                  {b.product?.display_name ?? b.free_label ?? '보틀명 미상'}
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {BOTTLE_CONTEXT_LABEL[b.context] ?? b.context}
                  {b.price != null && ` · ${b.price} ${b.currency ?? ''}`}
                  {b.price != null && b.fx_to_krw != null && (
                    <span> (약 ₩{Math.round(b.price * b.fx_to_krw).toLocaleString()})</span>
                  )}
                </p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {b.user?.nickname ?? '익명'} · {b.logged_at}
                </p>
              </li>
            ))}
          </ul>
        )}

        {/* 7. 한줄평 */}
        <SectionTitle>한줄평</SectionTitle>
        {data.reviewsFailed ? (
          <p className="text-xs text-gray-400">한줄평을 불러오지 못했습니다.</p>
        ) : comments.length === 0 ? (
          <p className="text-xs text-gray-400">
            한줄평이 아직 없습니다. (작성 기능 준비중)
          </p>
        ) : (
          <ul className="space-y-2">
            {comments.map((r) => (
              <li key={r.id} className="border border-gray-100 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-800">{r.comment}</p>
                <p className="text-[11px] text-gray-400 mt-1">
                  {r.user?.nickname ?? '익명'} · 방문 {r.visited_at}
                  {r.rating && (
                    <span>
                      {' · '}
                      {r.rating === 'revisit' ? '또 가고 싶어요' : r.rating === 'fine' ? '괜찮았어요' : '아쉬웠어요'}
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}

        {/* 기여자 표시 (§10) */}
        <p className="text-[11px] text-gray-400 mt-6">
          {place.source === 'seed'
            ? '운영진이 직접 조사해 등록한 장소입니다.'
            : `등록: ${place.contributor?.nickname ?? '익명'}`}
        </p>
      </div>
    </div>
  )
}
