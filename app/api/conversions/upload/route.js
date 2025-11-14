// app/api/ads/[adId]/route.js
export const runtime = "nodejs";

import crypto from "crypto";

const BASE = "https://api.searchad.naver.com";

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
  if (!apiKey || !secretKey || !customerId) {
    throw new Error("env(API_KEY/SECRET_KEY/CUSTOMER_ID) 필요");
  }
  return { apiKey, secretKey, customerId };
}

// PUT /api/ads/[adId]
// body 예시 1) 입찰가 변경
// { "adAttr": { "bidAmt": 50, "useGroupBidAmt": false } }
// body 예시 2) ON/OFF 변경
// { "userLock": true }  // off
// { "userLock": false } // on
export async function PUT(req, { params }) {
  try {
    const { apiKey, secretKey, customerId } = env();

    const adId = params?.adId;   // ✅ 동적 세그먼트에서 adId 가져오기
    if (!adId) {
      return Response.json(
        { error: "adId(소재 id)가 필요합니다." },
        { status: 400 }
      );
    }

    let body;
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    if (!body || typeof body !== "object") body = {};

    const { adAttr, userLock } = body;

    const updates = {};
    const fields = [];

    if (adAttr && typeof adAttr === "object") {
      updates.adAttr = {
        bidAmt: Number(adAttr.bidAmt ?? 0),
        useGroupBidAmt: !!adAttr.useGroupBidAmt,
      };
      fields.push("adAttr");
    }

    if (typeof userLock === "boolean") {
      updates.userLock = userLock;
      fields.push("userLock");
    }

    if (!fields.length) {
      return Response.json(
        { error: "변경할 값이 없습니다. (adAttr 또는 userLock 필요)" },
        { status: 400 }
      );
    }

    const path = `/ncc/ads/${encodeURIComponent(adId)}`;
    const qs = `fields=${fields.join(",")}`;

    const res = await fetch(`${BASE}${path}?${qs}`, {
      method: "PUT",
      headers: headers(apiKey, secretKey, customerId, "PUT", path),
      body: JSON.stringify({
        nccAdId: adId,
        type: "SHOPPING_PRODUCT_AD",
        ...updates,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      return new Response(text || JSON.stringify({ error: "Naver API error" }), {
        status: res.status,
      });
    }

    const data = await res.json();
    return Response.json(data);
  } catch (e) {
    return Response.json(
      { error: String(e.message || e) },
      { status: 500 }
    );
  }
}
