// app/api/naver/ad-bulk-action/route.js
export const runtime = "nodejs";

import crypto from "crypto";
import { NextResponse } from "next/server";

const BASE = "https://api.searchad.naver.com";

// === 공통 유틸 (기존 /api/ads/[adId] 와 동일 구조) ===
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

/**
 * POST /api/naver/ad-bulk-action
 *
 * body: {
 *   items: [
 *     { adId: "nccAdId1", type: "bid", newBid: 1200 },
 *     { adId: "nccAdId2", type: "onoff", status: "OFF" }, // status: "ON" | "OFF"
 *     ...
 *   ]
 * }
 */
export async function POST(req) {
  try {
    const { apiKey, secretKey, customerId } = env();

    const body = (await req.json().catch(() => null)) || {};
    const items = Array.isArray(body.items) ? body.items : [];

    if (!items.length) {
      return NextResponse.json(
        { error: "items 배열이 비어 있습니다." },
        { status: 400 }
      );
    }

    let total = items.length;
    let success = 0;
    let fail = 0;

    const errors = [];

    // 순차 처리 (필요하면 나중에 Promise.all 로 병렬 변경 가능)
    for (const item of items) {
      const adId = item?.adId;
      if (!adId) {
        fail += 1;
        errors.push({ item, error: "adId 누락" });
        continue;
      }

      let adAttr = undefined;
      let userLock = undefined;
      const fields = [];

      if (item.type === "bid") {
        const nb = Number(item.newBid);
        if (Number.isFinite(nb) && nb >= 0) {
          adAttr = { bidAmt: nb };
          fields.push("adAttr");
        } else {
          fail += 1;
          errors.push({
            item,
            error: `잘못된 newBid 값: ${item.newBid}`,
          });
          continue;
        }
      } else if (item.type === "onoff") {
        // status: "ON" | "OFF"
        const status = String(item.status || "").toUpperCase();
        if (status === "ON") {
          userLock = false; // ON → 잠금 해제
          fields.push("userLock");
        } else if (status === "OFF") {
          userLock = true; // OFF → 잠금
          fields.push("userLock");
        } else {
          fail += 1;
          errors.push({
            item,
            error: `status는 "ON" 또는 "OFF" 여야 합니다. (현재: ${item.status})`,
          });
          continue;
        }
      } else {
        fail += 1;
        errors.push({
          item,
          error: `알 수 없는 type: ${item.type} (bid | onoff 만 지원)`,
        });
        continue;
      }

      if (!fields.length) {
        fail += 1;
        errors.push({
          item,
          error: "변경할 필드(adAttr 또는 userLock)이 없습니다.",
        });
        continue;
      }

      const path = `/ncc/ads/${encodeURIComponent(adId)}`;
      const qs = `?fields=${fields.join(",")}`;

      const payload = {
        nccAdId: adId,
        type: "SHOPPING_PRODUCT_AD",
        ...(adAttr ? { adAttr } : {}),
        ...(typeof userLock === "boolean" ? { userLock } : {}),
      };

      try {
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
          fail += 1;
          errors.push({
            item,
            status: res.status,
            error: "Naver API 오류",
            detail: data,
          });
        } else {
          success += 1;
        }
      } catch (e) {
        fail += 1;
        errors.push({
          item,
          error: String(e?.message || e),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      total,
      success,
      fail,
      errors,
    });
  } catch (e) {
    return NextResponse.json(
      { error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
