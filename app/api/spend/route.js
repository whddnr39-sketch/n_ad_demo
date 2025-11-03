// app/api/spend/route.js
export const runtime = "nodejs"; // HMAC/crypto 사용 → Node 런타임

import crypto from "crypto";

// ──────────────────────────────────────────────────────────
// KST 어제 날짜 계산 (YYYYMMDD / YYYY-MM-DD 둘 다 제공)
// ──────────────────────────────────────────────────────────
function kstYesterday() {
  const now = new Date();
  const kstMs = now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60_000;
  const y = new Date(kstMs - 24 * 60 * 60 * 1000);
  const yyyy = y.getUTCFullYear();
  const mm = String(y.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(y.getUTCDate()).padStart(2, "0");
  return { ymd: `${yyyy}${mm}${dd}`, ymdDash: `${yyyy}-${mm}-${dd}` };
}

// ──────────────────────────────────────────────────────────
// NAVER 서명: HMAC-SHA256(secret, `${ts}.${method}.${path}`) → base64
// (Python 코드의 sign_headers와 동일)
// ──────────────────────────────────────────────────────────
function makeHeaders({ apiKey, secretKey, customerId, method, path }) {
  const ts = String(Date.now());
  const msg = `${ts}.${method}.${path}`;
  const sig = crypto.createHmac("sha256", secretKey).update(msg).digest("base64");
  return {
    "X-Timestamp": ts,
    "X-API-KEY": apiKey,
    "X-Customer": String(customerId),
    "X-Signature": sig,
    "Content-Type": "application/json",
  };
}

// ──────────────────────────────────────────────────────────
// 하루치 bizmoney 소진액 조회 (refund/nonrefund 합산)
// Python의 fetch_bizmoney_for와 1:1 대응
// ──────────────────────────────────────────────────────────
async function fetchBizmoneyFor({ dateYmd, apiKey, secretKey, customerId }) {
  const base = "https://api.naver.com";
  const path = "/billing/bizmoney/histories/exhaust";
  const method = "GET";

  const url = new URL(base + path);
  url.searchParams.set("searchStartDt", dateYmd);
  url.searchParams.set("searchEndDt", dateYmd);

  const res = await fetch(url.toString(), {
    method,
    headers: makeHeaders({ apiKey, secretKey, customerId, method, path }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Naver API ${res.status}: ${text}`);
  }

  const arr = await res.json(); // [{ useRefundableAmt, useNonrefundableAmt, ... }, ...]
  let total = 0;
  for (const entry of arr || []) {
    const refundable = Math.abs(Number(entry?.useRefundableAmt || 0));
    const nonrefundable = Math.abs(Number(entry?.useNonrefundableAmt || 0));
    total += refundable + nonrefundable;
  }
  return total;
}

// ──────────────────────────────────────────────────────────
// ENV에서 계정 세트 읽기
// 1) NAVER_ACCOUNTS_JSON (권장): [{"name":"...","API_KEY":"...","SECRET_KEY":"...","CUSTOMER_ID":"..."}, ...]
// 2) 또는 단일 키: API_KEY / SECRET_KEY / CUSTOMER_ID
// ──────────────────────────────────────────────────────────
function readAccountsFromEnv() {
  const json = process.env.NAVER_ACCOUNTS_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {}
  }
  // 단일 계정 fallback
  const API_KEY = process.env.API_KEY || process.env.NAVER_API_KEY;
  const SECRET_KEY = process.env.SECRET_KEY || process.env.NAVER_SECRET_KEY;
  const CUSTOMER_ID = process.env.CUSTOMER_ID || process.env.NAVER_CUSTOMER_ID;
  if (API_KEY && SECRET_KEY && CUSTOMER_ID) {
    return [{ name: "default", API_KEY, SECRET_KEY, CUSTOMER_ID }];
  }
  throw new Error("환경변수에 계정 정보가 없습니다. NAVER_ACCOUNTS_JSON 또는 (API_KEY/SECRET_KEY/CUSTOMER_ID) 설정 필요");
}

// ──────────────────────────────────────────────────────────
// GET /api/spend
// - 기본: 어제 하루 합계 { date, total, perAccount[] }
// - days=8 쿼리 주면 최근 N일 일자별 합계도 반환(series)
// ──────────────────────────────────────────────────────────
export async function GET(request) {
  try {
    const { ymd, ymdDash } = kstYesterday();
    const accounts = readAccountsFromEnv();

    // ?days=8 지원 (없으면 1일만)
    const { searchParams } = new URL(request.url);
    const days = Math.max(1, Math.min(30, Number(searchParams.get("days") || 1)));

    const out = { date: ymdDash, total: 0, perAccount: [] };

    // 최근 N일 시리즈가 필요하면 생성
    if (days > 1) {
      const seriesDates = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        const kstMs = d.getTime() + (9 * 60 + d.getTimezoneOffset()) * 60_000;
        const target = new Date(kstMs - (i + 1) * 24 * 60 * 60 * 1000);
        const yyyy = target.getUTCFullYear();
        const mm = String(target.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(target.getUTCDate()).padStart(2, "0");
        seriesDates.push({ ymd: `${yyyy}${mm}${dd}`, ymdDash: `${yyyy}-${mm}-${dd}` });
      }

      const series = [];
      for (const sd of seriesDates) {
        let dayTotal = 0;
        for (const acc of accounts) {
          dayTotal += await fetchBizmoneyFor({
            dateYmd: sd.ymd,
            apiKey: acc.API_KEY,
            secretKey: acc.SECRET_KEY,
            customerId: acc.CUSTOMER_ID,
          });
        }
        series.push({ date: sd.ymdDash, total: Math.round(dayTotal) });
      }
      // 어제 값은 맨 마지막
      out.series = series;
      out.total = series[series.length - 1]?.total ?? 0;

      // 계정별 어제값
      for (const acc of accounts) {
        const val = await fetchBizmoneyFor({
          dateYmd: ymd,
          apiKey: acc.API_KEY,
          secretKey: acc.SECRET_KEY,
          customerId: acc.CUSTOMER_ID,
        });
        out.perAccount.push({ name: acc.name || acc.CUSTOMER_ID, amount: Math.round(val) });
      }
      return Response.json(out);
    }

    // 기본(어제 하루) 처리
    for (const acc of accounts) {
      const val = await fetchBizmoneyFor({
        dateYmd: ymd,
        apiKey: acc.API_KEY,
        secretKey: acc.SECRET_KEY,
        customerId: acc.CUSTOMER_ID,
      });
      out.perAccount.push({ name: acc.name || acc.CUSTOMER_ID, amount: Math.round(val) });
    }
    out.total = out.perAccount.reduce((s, a) => s + a.amount, 0);
    return Response.json(out);
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500 });
  }
}
