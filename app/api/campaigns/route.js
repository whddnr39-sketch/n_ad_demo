// app/api/campaigns/route.js
export const runtime = "nodejs";
import crypto from "crypto";

function makeHeaders({ apiKey, secretKey, customerId, method, path }) {
  const ts = String(Date.now());
  const msg = `${ts}.${method}.${path}`; // ts.method.path
  const sig = crypto.createHmac("sha256", secretKey).update(msg).digest("base64");
  return {
    "X-Timestamp": ts,
    "X-API-KEY": apiKey,
    "X-Customer": String(customerId),
    "X-Signature": sig,
    "Content-Type": "application/json",
  };
}

function readAccount() {
  // 단일 계정(현재 환경변수 키 그대로 사용: API_KEY / SECRET_KEY / CUSTOMER_ID)
  const API_KEY = process.env.API_KEY || process.env.NAVER_API_KEY;
  const SECRET_KEY = process.env.SECRET_KEY || process.env.NAVER_SECRET_KEY;
  const CUSTOMER_ID = process.env.CUSTOMER_ID || process.env.NAVER_CUSTOMER_ID;
  if (!API_KEY || !SECRET_KEY || !CUSTOMER_ID) {
    throw new Error("환경변수(API_KEY/SECRET_KEY/CUSTOMER_ID)가 필요합니다.");
  }
  return { API_KEY, SECRET_KEY, CUSTOMER_ID };
}

// GET /api/campaigns  → 현재 등록된 캠페인 배열 반환
export async function GET() {
  try {
    const { API_KEY, SECRET_KEY, CUSTOMER_ID } = readAccount();
    const base = "https://api.searchad.naver.com";
    const path = "/ncc/campaigns";
    const url = base + path; // 기본 리스트

    const res = await fetch(url, {
      method: "GET",
      headers: makeHeaders({
        apiKey: API_KEY,
        secretKey: SECRET_KEY,
        customerId: CUSTOMER_ID,
        method: "GET",
        path,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Naver API ${res.status}: ${text}`);
    }

    const data = await res.json();
    // 유용한 필드만 간추려 반환(원한다면 전체 그대로 반환해도 됨)
    const campaigns = (data || []).map((c) => ({
      id: c.nccCampaignId,
      name: c.name,
      type: c.campaignType,     // e.g. SEARCH, SHOPPING 등
      status: c.status,         // ON/OFF 등
      budget: c.dailyBudget,    // 공유예산/개별예산 조합일 수 있음
      regTm: c.regTm,
      editTm: c.editTm,
    }));
    return Response.json({ campaigns });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), {
      status: 500,
    });
  }
}
