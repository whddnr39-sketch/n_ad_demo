// app/api/spend/route.js
export const runtime = "nodejs";

import crypto from "crypto";

// KST 날짜 유틸
function toKstDate(d = new Date()) {
  const kstMs = d.getTime() + (9 * 60 + d.getTimezoneOffset()) * 60_000;
  return new Date(kstMs);
}
function ymdDash(date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function ymd(date) {
  return ymdDash(date).replace(/-/g, "");
}
function kstYesterday() {
  const y = new Date(toKstDate().getTime() - 24 * 60 * 60 * 1000);
  return { ymd: ymd(y), ymdDash: ymdDash(y) };
}

// NAVER 인증 헤더
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

// 하루치 bizmoney 소진액 조회
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

  const arr = await res.json();
  let total = 0;
  for (const entry of arr || []) {
    const refundable = Math.abs(Number(entry?.useRefundableAmt || 0));
    const nonrefundable = Math.abs(Number(entry?.useNonrefundableAmt || 0));
    total += refundable + nonrefundable;
  }
  return total;
}

// ENV에서 계정 세트 읽기
function readAccountsFromEnv() {
  const json = process.env.NAVER_ACCOUNTS_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {}
  }
  const API_KEY = process.env.API_KEY || process.env.NAVER_API_KEY;
  const SECRET_KEY = process.env.SECRET_KEY || process.env.NAVER_SECRET_KEY;
  const CUSTOMER_ID = process.env.CUSTOMER_ID || process.env.NAVER_CUSTOMER_ID;
  if (API_KEY && SECRET_KEY && CUSTOMER_ID) {
    return [{ name: "default", API_KEY, SECRET_KEY, CUSTOMER_ID }];
  }
  throw new Error("환경변수에 계정 정보가 없습니다. NAVER_ACCOUNTS_JSON 또는 (API_KEY/SECRET_KEY/CUSTOMER_ID) 설정 필요");
}

// GET /api/spend?start=YYYY-MM-DD&end=YYYY-MM-DD
// 미지정 시 어제 하루 반환
export async function GET(request) {
  try {
    const accounts = readAccountsFromEnv();
    const { searchParams } = new URL(request.url);

    // 파라미터 파싱
    const startParam = searchParams.get("start");
    const endParam = searchParams.get("end");

    let startDash, endDash;
    if (startParam && endParam) {
      startDash = startParam;
      endDash = endParam;
    } else {
      // 기본: 어제 하루
      const { ymdDash: yd } = kstYesterday();
      startDash = yd;
      endDash = yd;
    }

    // 날짜 범위 확정 (KST 기준, 양 끝 포함)
    const s = new Date(`${startDash}T00:00:00Z`);
    const e = new Date(`${endDash}T00:00:00Z`);
    if (isNaN(s) || isNaN(e) || s.getTime() > e.getTime()) {
      return new Response(JSON.stringify({ error: "invalid date range" }), { status: 400 });
    }

    // 범위를 하루씩 순회
    let total = 0;
    const perDay = [];
    for (let d = new Date(s); d.getTime() <= e.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
      const dayYmd = ymd(d);
      let daySum = 0;
      for (const acc of accounts) {
        daySum += await fetchBizmoneyFor({
          dateYmd: dayYmd,
          apiKey: acc.API_KEY,
          secretKey: acc.SECRET_KEY,
          customerId: acc.CUSTOMER_ID,
        });
      }
      total += daySum;
      perDay.push({ date: ymdDash(d), total: Math.round(daySum) });
    }

    return Response.json({
      start: startDash,
      end: endDash,
      total: Math.round(total),
      perDay, // 필요 없으면 프론트에서 안 쓰면 됨
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500 });
  }
}
