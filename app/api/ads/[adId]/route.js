export const runtime = "nodejs";

import crypto from "crypto";

const BASE = "https://api.searchad.naver.com";

/* 공통 유틸들 -------------------------------------------------- */
function sign(secretKey, method, path) {
  const ts = String(Date.now());
  const sig = crypto
    .createHmac("sha256", secretKey)
    .update(`${ts}.${method}.${path}`)
    .digest("base64");
  return { ts, sig };
}

function headers(apiKey, secretKey, customerId, method, path) {
  const { ts, sig } = sign(secretKey, method, path);
  return {
    "X-Timestamp": ts,
    "X-API-KEY": apiKey,
    "X-Customer": String(customerId),
    "X-Signature": sig,
    "Content-Type": "application/json",
  };
}

function env() {
  const apiKey = process.env.API_KEY || process.env.NAVER_API_KEY;
  const secretKey = process.env.SECRET_KEY || process.env.NAVER_SECRET_KEY;
  const customerId = process.env.CUSTOMER_ID || process.env.NAVER_CUSTOMER_ID;
  if (!apiKey || !secretKey || !customerId)
    throw new Error("env(API_KEY/SECRET_KEY/CUSTOMER_ID) 필요");
  return { apiKey, secretKey, customerId };
}

/**
 * 개별 소재 수정
 * PUT /api/ads/[adId]
 *
 * body 예시)
 * 1) 입찰가만 변경:
 *  { "bidAmt": 60 }
 *
 * 2) ON/OFF만 변경:
 *  { "userLock": true }   // true = OFF, false = ON
 *
 * 3) 둘 다 같이 변경:
 *  { "bidAmt": 60, "userLock": false }
 */
export async function PUT(req, { params }) {
  try {
    const { adId } = params;
    if (!adId) {
      return new Response(
        JSON.stringify({ error: "adId(소재 id)가 필요합니다." }),
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { bidAmt, userLock } = body;

    if (bidAmt == null && typeof userLock !== "boolean") {
      return new Response(
        JSON.stringify({
          error: "bidAmt 또는 userLock 중 최소 하나는 포함되어야 합니다.",
        }),
        { status: 400 }
      );
    }

    const creds = env();

    // 네이버 API path (쿼리스트링 제외)
    const path = `/ncc/ads/${encodeURIComponent(adId)}`;

    // fields 파라미터 구성
    const fields = [];
    if (bidAmt != null) fields.push("adAttr");
    if (typeof userLock === "boolean") fields.push("userLock");

    const qs = new URLSearchParams();
    if (fields.length) qs.set("fields", fields.join(","));

    // 네이버로 보낼 payload
    const payload = {
      nccAdId: adId,
      type: "SHOPPING_PRODUCT_AD",
    };

    if (bidAmt != null) {
      payload.adAttr = {
        bidAmt: Number(bidAmt),
        useGroupBidAmt: false,
      };
    }

    if (typeof userLock === "boolean") {
      payload.userLock = Boolean(userLock);
    }

    const res = await fetch(`${BASE}${path}?${qs.toString()}`, {
      method: "PUT",
      headers: headers(
        creds.apiKey,
        creds.secretKey,
        creds.customerId,
        "PUT",
        path
      ),
      cache: "no-store",
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const txt = await res.text();
      return new Response(
        JSON.stringify({
          error: "naver api error",
          status: res.status,
          body: txt,
        }),
        { status: res.status }
      );
    }

    const data = await res.json();
    return Response.json(data);
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e.message || e) }),
      { status: 500 }
    );
  }
}
