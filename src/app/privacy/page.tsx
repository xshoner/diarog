import Link from "next/link";

export const metadata = {
  title: "diarog 개인정보처리방침",
  description: "diarog(다이어로그) 개인정보처리방침",
};

// Google OAuth 앱 게시 요건: 공개 접근 가능한 개인정보처리방침 페이지
export default function PrivacyPage() {
  return (
    <main className="max-w-lg mx-auto px-5 py-10 text-[14px] leading-relaxed text-ink">
      <h1 className="text-xl font-bold mb-1">diarog 개인정보처리방침</h1>
      <p className="text-xs text-ink-soft mb-6">시행일: 2026-08-24</p>

      <section className="space-y-5">
        <div>
          <h2 className="font-semibold mb-1">1. 서비스 개요</h2>
          <p>
            diarog(다이어로그)는 사용자가 올린 사진과 캘린더·날씨·장소 정보를 바탕으로
            하루의 기록과 일기를 자동으로 작성해 주는 개인용 라이프로그 서비스입니다.
          </p>
        </div>

        <div>
          <h2 className="font-semibold mb-1">2. 수집하는 정보</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><b>Google 계정 프로필</b>: 이메일, 이름, 프로필 사진 (로그인·계정 식별)</li>
            <li><b>Google 캘린더(선택)</b>: 일정 제목·시간·장소·참석자 이름 — <b>읽기 전용</b>이며, 일정 설명(description)은 수집하지 않습니다</li>
            <li><b>사진</b>: 사용자가 직접 올린 사진의 <b>축소본(최대 1024px)</b>과 촬영 시각·위치 메타데이터. 원본은 서버에 저장되지 않습니다</li>
            <li><b>위치</b>: 사진의 EXIF 위치 또는 사용자가 허용한 기기 위치 (기록·지도 표시 목적)</li>
            <li><b>사용자 입력</b>: 순간 제목·메모·기분, 일기 수정 내역 (문체 학습 목적)</li>
          </ul>
        </div>

        <div>
          <h2 className="font-semibold mb-1">3. 이용 목적</h2>
          <p>
            수집한 정보는 오직 <b>사용자 본인의 기록 생성·표시·검색</b>에만 사용됩니다.
            AI 처리 시에는 해당 순간에 필요한 최소한의 정보만 전달하며,
            사용자 데이터는 AI 모델 학습에 사용되지 않습니다. 광고 목적의 이용은 없습니다.
          </p>
        </div>

        <div>
          <h2 className="font-semibold mb-1">4. 제3자 처리</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Google (로그인·캘린더 읽기)</li>
            <li>Supabase (데이터베이스·사진 축소본 저장)</li>
            <li>Letsur AI 게이트웨이 (사진 해석·일기 생성 — 처리 후 미보관)</li>
            <li>카카오 (좌표→주소 변환, 장소 검색, 지도 표시)</li>
            <li>기상청 공공데이터 (좌표 기반 날씨 조회)</li>
          </ul>
        </div>

        <div>
          <h2 className="font-semibold mb-1">5. 보관 및 삭제</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>기록·사진은 사용자가 삭제하면 파생 데이터(AI 캡션·검색 인덱스)와 함께 즉시 삭제됩니다</li>
            <li>계정 삭제 시 모든 데이터는 30일 이내 완전 파기됩니다</li>
            <li>전체 데이터 내보내기(일기 Markdown + 기록 JSON + 썸네일)는 설정에서 언제든 가능합니다</li>
          </ul>
        </div>

        <div>
          <h2 className="font-semibold mb-1">6. Google API 제한적 사용 고지</h2>
          <p>
            diarog의 Google API 데이터 사용은{" "}
            <a className="text-accent underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
              Google API Services User Data Policy
            </a>
            의 제한적 사용(Limited Use) 요건을 준수합니다.
          </p>
        </div>

        <div>
          <h2 className="font-semibold mb-1">7. 문의</h2>
          <p>jeebs0627@gmail.com</p>
        </div>
      </section>

      <p className="mt-8">
        <Link href="/" className="text-accent text-sm font-semibold">← diarog으로 돌아가기</Link>
      </p>
    </main>
  );
}
