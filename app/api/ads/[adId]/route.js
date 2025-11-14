// app/api/ads/[adId]/route.js
export const runtime = "nodejs";

import crypto from "crypto";

const BASE = "https://api.searchad.naver.com";

// --- 공통 유틸 (stats 쪽이랑 동일 패턴) ---
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

// PUT /api/ads/[adId]
export async function PUT(req, { params }) {
  try {
    const { apiKey, secretKey, customerId } = env();

    // 1) URL path or query 둘 다에서 adId 시도 (안전장치)
    const url = new URL(req.url);
    const queryAdId = url.searchParams.get("adId");
    const adId = params?.adId || queryAdId;
    if (!adId) {
      return Response.json(
        { error: "adId(소재 id)가 필요합니다." },
        { status: 400 }
      );
    }

    // 2) body 파싱 (adAttr / userLock 둘 중 하나 또는 둘 다)
    const body = (await req.json().catch(() => null)) || {};

    const fields = [];
    if (body.adAttr) fields.push("adAttr");
    if (typeof body.userLock === "boolean") fields.push("userLock");

    if (!fields.length) {
      return Response.json(
        { error: "수정할 필드(adAttr 또는 userLock)이 없습니다." },
        { status: 400 }
      );
    }

    const path = `/ncc/ads/${encodeURIComponent(adId)}`;
    const qs = `?fields=${fields.join(",")}`;

    const payload = {
      nccAdId: adId,
      type: "SHOPPING_PRODUCT_AD",
      ...(body.adAttr ? { adAttr: body.adAttr } : {}),
      ...(typeof body.userLock === "boolean" ? { userLock: body.userLock } : {}),
    };

    const res = await fetch(`${BASE}${path}${qs}`, {
      method: "PUT",
      headers: headers(apiKey, secretKey, customerId, "PUT", path),
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!res.ok) {
      return Response.json(
        {
          error: "Naver API 오류",
          status: res.status,
          detail: data,
        },
        { status: 500 }
      );
    }

    return Response.json({ ok: true, adId, fields, naver: data });
  } catch (e) {
    return Response.json(
      { error: String(e.message || e) },
      { status: 500 }
    );
  }
}
