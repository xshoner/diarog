// 배포 버전 조회 — 클라이언트가 자신의 빌드와 비교해 스테일 번들을 감지한다
export async function GET() {
  return Response.json(
    { sha: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
