# diarog — 프라이빗 AI 라이프로그

> 기록하지 않아도 기록되는 삶.

사진을 찍기만 하면, AI가 위치·일정·날씨·장소의 증거를 엮어 하루를 **Moment(사건)** 단위로
자동 조립하고, 밤 9시 사용자의 30초 확인으로 확정되는 **나의 페르소나가 써주는 프라이빗 AI 라이프로그**.

## 스택

| 영역 | 기술 |
|---|---|
| 웹/API | Next.js 16 (App Router, PWA) → Vercel |
| DB/스토리지 | Supabase (Postgres + pgvector, RLS, private Storage) |
| AI | Letsur 게이트웨이 (`gemini-3.7-flash`, `text-embedding-3-small`) |
| 컨텍스트 | Google Calendar (readonly) · Kakao 로컬/지도 · 기상청 초단기실황 |
| 푸시 | Web Push (VAPID) + Vercel Cron (21:00 KST 리추얼 / 일 20:00 주간회고) |

## 핵심 루프

```
낮: 사진 촬영 → 업로드 시 클라이언트에서 EXIF 추출 + 1024px 다운스케일 (원본은 기기에)
    → 45분/300m 클러스터링 → 캘린더·POI·날씨 융합 → Call-1(사진 분석·사건 해석)
    → 확신도 산출: ≥0.75 자동 연결 · 0.45~0.75 버튼 질문 · <0.45 미연결
21:00: 푸시 → 카드 확인 + 버튼 질문(≤3) + 인라인 편집 → "오늘 하루 확정하기"
    → Call-2(페르소나 일기, 문장별 근거 배지) → 데일리 지도 반영 → 검색 임베딩
일요일 20:00: Call-3 주간 회고 (Plan vs Lived 포함)
```

## 개발

```bash
npm install
cp .env.example .env.local   # 키 입력
npm run dev
```

### 초기 설정 (1회)
1. **DB 스키마**: Supabase Dashboard → SQL Editor → `supabase/migrations/0001_init.sql` 실행
2. **Google OAuth**: Cloud Console에서 redirect URI 등록
   - `http://localhost:3000/api/auth/callback/google`
   - `https://diarog.vercel.app/api/auth/callback/google`
3. **Kakao Developers**: 앱에서 "카카오맵" 서비스 활성화 + 플랫폼 도메인 등록
4. **Vercel env**: `.env.local`의 모든 키 등록 (`NEXT_PUBLIC_APP_URL`은 프로덕션 URL로)

### 테스트
```bash
npx tsx tests/core.test.ts   # 격자변환·클러스터링·시간유틸 + 외부 API 라이브 테스트
```

## 프라이버시 5원칙 (협상 불가)
① AI 호출에 해당 Moment의 최소 증거만 전달 ② 원본 미보관(다운스케일·썸네일만)
③ 학습 미사용·광고 영구 배제 ④ 파생 데이터 동반 삭제 ⑤ 내보내기 상시 개방
