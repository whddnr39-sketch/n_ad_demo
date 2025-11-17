// app/api/ads/[adId]/route.js
export const runtime = "nodejs";

import crypto from "crypto";
import { NextResponse } from "next/server";

const BASE = "https://api.searchad.naver.com";

// === 공통 유틸 ===
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
// 여기서 adId = Naver nccAdId 로 사용한다.
export async function PUT(req, ctx) {
  try {
    const { apiKey, secretKey, customerId } = env();

    // ctx 에서 params 꺼내기
    const params = ctx?.params || {};

    // body: 입찰가/상태 변경용 필드만 받는 형태
    const body = (await req.json().catch(() => null)) || {};

    // 1) URL 경로에서 nccAdId를 받아보고,
    // 2) 없으면 body.adId 에서 한번 더 찾아본다 (백업용)
    const urlAdId = params?.adId;
    const bodyAdId = body?.adId;
    const adId = urlAdId ?? bodyAdId;

    if (!adId || adId === "undefined") {
      return NextResponse.json(
        {
          error: "adId(= nccAdId)가 필요합니다.",
          debug: { urlAdId, bodyAdId },
        },
        { status: 400 }
      );
    }

    // adAttr (입찰가 등) / userLock(ON/OFF) 둘 중 하나 이상이 와야 한다.
    const fields = [];
    if (body.adAttr) fields.push("adAttr");
    if (typeof body.userLock === "boolean") fields.push("userLock");

    if (!fields.length) {
      return NextResponse.json(
        { error: "수정할 필드(adAttr 또는 userLock)이 없습니다." },
        { status: 400 }
      );
    }

    // Naver SearchAd API 호출 준비
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
      return NextResponse.json(
        {
          error: "Naver API 오류",
          status: res.status,
          detail: data,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      adId,        // = nccAdId
      fields,      // 실제 변경 요청한 필드 목록
      naver: data, // Naver 응답
    });
  } catch (e) {
    return NextResponse.json(
      { error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
