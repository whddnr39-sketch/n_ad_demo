// middleware.js
import { NextResponse } from "next/server";

const USER = process.env.BASIC_AUTH_USER;
const PASS = process.env.BASIC_AUTH_PASS;

// 정적 자원 등은 통과
export const config = {
  matcher: [
    // _next 정적파일, 이미지/JS/CSS 등은 제외
    "/((?!_next/|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map)$).*)",
  ],
};

export function middleware(req) {
  // 환경변수가 비어있으면 보호 비활성화 (배포 실수 방지)
  if (!USER || !PASS) return NextResponse.next();

  const auth = req.headers.get("authorization") || "";
  if (auth.startsWith("Basic ")) {
    try {
      const b64 = auth.slice(6);
      const decoded = atob(b64);            // "user:pass"
      const [u, p] = decoded.split(":");
      if (u === USER && p === PASS) return NextResponse.next();
    } catch {
      // no-op → 아래 401로
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Secure Area"' },
  });
}
