import { NextResponse } from "next/server";

// ================================
// CONFIG
// ================================
const BASE = "https://api.searchad.naver.com";
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// JSON safe parsing (네이버가 HTML/텍스트로 에러 보내도 절대 죽지 않도록)
async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(
      "Naver API returned non-JSON response: " + text.substring(0, 200)
    );
  }
}

// ================================
// SearchAd 공통 헤더 생성
// ================================
function headers(apiKey, secretKey, customerId, method, path) {
  const timestamp = Date.now().toString();
  const hmac = require("crypto")
    .createHmac("sha256", secretKey)
    .update(timestamp + "." + method + "." + path)
    .digest("base64");

  return {
    Authorization: `API_KEY ${apiKey}:${hmac}`,
    "Content-Type": "application/json; charset=UTF-8",
    "X-Timestamp": timestamp,
    "X-API-KEY": apiKey,
    "X-Customer": customerId,
  };
}

// ================================
// ENV: 서버환경변수 불러오기
// ================================
function env() {
  return {
    apiKey: process.env.NAVER_API_KEY,
    secretKey: process.env.NAVER_SECRET_KEY,
    customerId: process.env.NAVER_CUSTOMER_ID,
  };
}

// ================================
// (1) 특정 그룹의 전체 소재 ID 조회
// ================================
async function listAdsOfGroup(apiKey, secretKey, customerId, adgroupId) {
  const path = `/ncc/ads`;
  const qs = `?adgroupId=${encodeURIComponent(adgroupId)}&limit=500`;

  const url = `${BASE}${path}${qs}`;
  const res = await fetch(url, {
    method: "GET",
    headers: headers(apiKey, secretKey, customerId, "GET", path),
  });

  if (!res.ok) {
    const raw = await res.text();
    throw new Error(`ads ${adgroupId} ${res.status}: ${raw}`);
  }

  return safeJson(res); // ← JSON이 아닐 때도 안전하게 처리
}

// ================================
// (2) 개별 소재의 성과 조회
// ================================
async function fetchStatPerAd(apiKey, secretKey, customerId, adId, start, end) {
  const path = `/stats`;
  const qs = `?id=${encodeURIComponent(adId)}&fields=imp,clk,ctr,cpc,avgRnk,crto,conv,convValue,errCnt&timeRange=${start}~${end}&timeUnit=all&statType=ad`;

  const url = `${BASE}${path}${qs}`;
  const res = await fetch(url, {
    method: "GET",
    headers: headers(apiKey, secretKey, customerId, "GET", path),
  });

  if (!res.ok) {
    const raw = await res.text();
    throw new Error(`stats ${adId} ${res.status}: ${raw}`);
  }

  return safeJson(res); // ← 여기에도 안전 처리
}

// ================================
// (GET) /api/stats/ads
// ================================
export async function GET(req) {
  try {
    const { apiKey, secretKey, customerId } = env();
    const { searchParams } = new URL(req.url);

    const adgroupId = searchParams.get("adgroupId");
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    if (!adgroupId || !start || !end) {
      return NextResponse.json(
        { error: "adgroupId, start, end 모두 필요합니다." },
        { status: 400 }
      );
    }

    // 1) 전체 소재 ID 조회
    const ads = await listAdsOfGroup(apiKey, secretKey, customerId, adgroupId);
    if (!Array.isArray(ads) || ads.length === 0) {
      return NextResponse.json({
        start,
        end,
        total: 0,
        rows: [],
      });
    }

    // 2) 소재별 순차 조회
    const rows = [];
    let total = 0;

    for (const ad of ads) {
      const adId = ad.nccAdId;

      // 딜레이 (429 방지)
      await sleep(10);

      try {
        const stat = await fetchStatPerAd(
          apiKey,
          secretKey,
          customerId,
          adId,
          start,
          end
        );

        if (Array.isArray(stat) && stat.length > 0) {
          const s = stat[0];

          const cost = s.cost || 0;
          total += cost;

          rows.push({
            id: adId,
            mallProductId: ad.mallProductId || "",
            productName: ad.adName || "",
            imageUrl: ad.nccAd?.pc?.landingUrl || "",
            userLock: ad.userLock || false,
            bidAmt: ad.bidAmt || 0,

            imp: s.imp || 0,
            clk: s.clk || 0,
            ctr: s.ctr || 0,
            cpc: s.cpc || 0,
            avgRnk: s.avgRnk || 0,
            cost: cost,
            conv: s.convCnt || 0,
            convAmt: s.convValue || 0,
          });
        }
      } catch (e) {
        rows.push({
          id: adId,
          error: String(e.message || e),
        });
      }
    }

    return NextResponse.json({
      start,
      end,
      total: Math.round(total),
      rows,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Unhandled error: " + String(e.message || e) },
      { status: 500 }
    );
  }
}
