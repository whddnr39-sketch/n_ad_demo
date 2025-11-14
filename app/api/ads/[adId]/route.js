// app/api/ads/[adId]/route.js
export const runtime = "nodejs";

import crypto from "crypto";
import { NextResponse } from 'next/server'; // ⭐️ 추가: NextResponse 임포트

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

    // 1) ⭐️ adId 추출 단순화: URL 경로 파라미터(params)에서만 가져옵니다. ⭐️
    // adId가 nccAdId 역할을 합니다.
    const adId = params.adId;
    
    if (!adId) {
      // 프론트엔드에서 nccAdId를 'id'로 제대로 전달했는지 확인 필요
      return NextResponse.json( // ⭐️ 수정: Response 대신 NextResponse 사용
        { error: "adId(소재 id)가 필요합니다. (params.adId 누락)" },
        { status: 400 }
      );
    }

    // 2) body 파싱 (adAttr / userLock 둘 중 하나 또는 둘 다)
    const body = (await req.json().catch(() => null)) || {};

    const fields = [];
    if (body.adAttr) fields.push("adAttr");
    if (typeof body.userLock === "boolean") fields.push("userLock");

    if (!fields.length) {
      return NextResponse.json( // ⭐️ 수정: Response 대신 NextResponse 사용
        { error: "수정할 필드(adAttr 또는 userLock)이 없습니다." },
        { status: 400 }
      );
    }

    const path = `/ncc/ads/${encodeURIComponent(adId)}`;
    const qs = `?fields=${fields.join(",")}`;

    // 3) ⭐️ payload에 nccAdId 값으로 adId를 사용합니다. ⭐️
    const payload = {
      nccAdId: adId, // nccAdId 필드에 URL 경로에서 가져온 adId 값을 사용
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
      return NextResponse.json( // ⭐️ 수정: Response 대신 NextResponse 사용
        {
          error: "Naver API 오류",
          status: res.status,
          detail: data,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, adId, fields, naver: data });
  } catch (e) {
    return NextResponse.json( // ⭐️ 수정: Response 대신 NextResponse 사용
      { error: String(e.message || e) },
      { status: 500 }
    );
  }
}