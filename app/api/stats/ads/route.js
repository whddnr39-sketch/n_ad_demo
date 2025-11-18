// app/api/stats/ads/route.js
export const runtime = "nodejs";

import crypto from "crypto";
import { NextResponse } from "next/server";

const BASE = "https://api.searchad.naver.com";

// --------------------------------------------------
// 공통 유틸
// --------------------------------------------------
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

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Naver 응답을 안전하게 JSON 파싱
 * (HTML 에러 페이지가 와도 서버가 죽지 않도록)
 */
async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(
      "Naver API가 JSON이 아닌 응답을 반환했습니다: " + text.slice(0, 200)
    );
  }
}

/**
 * 공통 Naver GET 호출 헬퍼
 */
async function getJsonFromNaver(path, qs, apiKey, secretKey, customerId) {
  const url = `${BASE}${path}${qs || ""}`;
  const res = await fetch(url, {
    method: "GET",
    headers: headers(apiKey, secretKey, customerId, "GET", path),
    cache: "no-store",
  });

  if (!res.ok) {
    const raw = await res.text();
    throw new Error(`${path} ${res.status}: ${raw.slice(0, 200)}`);
  }
  return safeJson(res);
}

// --------------------------------------------------
// adgroup / ad / stats 조회 유틸
// --------------------------------------------------

/**
 * 계정 전체 adgroup 목록 조회
 * - recordSize / page 기반 페이징 (필요시 조정 가능)
 */
async function listAllAdgroups(apiKey, secretKey, customerId) {
  const path = "/ncc/adgroups";
  const limit = 100;
  let page = 0;
  let all = [];

  while (true) {
    const qs = `?recordSize=${limit}&page=${page}`;
    const data = await getJsonFromNaver(path, qs, apiKey, secretKey, customerId);

    if (!Array.isArray(data) || data.length === 0) break;
    all = all.concat(data);

    if (data.length < limit) break; // 마지막 페이지
    page += 1;

    // 레이트리밋 완화
    await sleep(80);
  }

  return all;
}

/**
 * 특정 adgroup 안의 전체 소재 조회
 */
async function listAdsOfGroup(apiKey, secretKey, customerId, adgroupId) {
  const path = "/ncc/ads";
  const qs = `?nccAdgroupId=${encodeURIComponent(adgroupId)}&limit=500`;
  const data = await getJsonFromNaver(path, qs, apiKey, secretKey, customerId);
  if (!Array.isArray(data)) return [];
  return data;
}

/**
 * 개별 소재(ad)의 기간별 성과 조회
 */
async function fetchStatPerAd(apiKey, secretKey, customerId, adId, start, end) {
  const path = "/stats";
  const qs = `?id=${encodeURIComponent(
    adId
  )}&timeRange=${start}~${end}&timeUnit=all&statType=AD`;
  const data = await getJsonFromNaver(path, qs, apiKey, secretKey, customerId);

  if (Array.isArray(data) && data.length > 0) return data[0];
  return null;
}

// --------------------------------------------------
// GET /api/stats/ads
//   - start, end 필수
//   - adgroupId 선택
// --------------------------------------------------
export async function GET(req) {
  try {
    const { apiKey, secretKey, customerId } = env();
    const { searchParams } = new URL(req.url);

    const adgroupId = searchParams.get("adgroupId") || null;
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    if (!start || !end) {
      return NextResponse.json(
        { error: "start, end 모두 필요합니다." },
        { status: 400 }
      );
    }

    // 1) ad 목록 가져오기
    let ads = [];

    if (adgroupId) {
      // ✅ 특정 adgroup만 조회 (1번 탭, 기존 구조)
      ads = await listAdsOfGroup(apiKey, secretKey, customerId, adgroupId);
    } else {
      // ✅ adgroupId 미지정 → 계정 전체 adgroup 돌면서 모든 소재를 수집
      const groups = await listAllAdgroups(apiKey, secretKey, customerId);
      for (const g of groups) {
        const gid =
          g.nccAdgroupId || g.adgroupId || g.nccAdGroupId || g.id || null;
        if (!gid) continue;

        try {
          const groupAds = await listAdsOfGroup(
            apiKey,
            secretKey,
            customerId,
            gid
          );
          if (Array.isArray(groupAds) && groupAds.length) {
            ads = ads.concat(groupAds);
          }
        } catch (e) {
          // 그룹 하나 실패해도 전체는 계속 진행
          console.error("listAdsOfGroup error:", gid, e);
        }

        // 레이트리밋 완화
        await sleep(80);
      }
    }

    if (!Array.isArray(ads) || ads.length === 0) {
      return NextResponse.json({
        start,
        end,
        adgroupId,
        totalSalesAmt: 0,
        rows: [],
        note: "조회된 소재가 없습니다.",
      });
    }

    // 2) 각 소재별 stats 조회 (완전 순차 + sleep)
    const rows = [];
    let totalSalesAmt = 0;

    for (const ad of ads) {
      const adId = ad.nccAdId || ad.adId || ad.id;
      if (!adId) continue;

      // 레이트리밋 완화
      await sleep(80);

      try {
        const s = await fetchStatPerAd(
          apiKey,
          secretKey,
          customerId,
          adId,
          start,
          end
        );

        if (!s) {
          rows.push({
            id: adId,
            nccAdId: adId,
            error: "통계 데이터 없음",
          });
          continue;
        }

        // 필드 이름은 계정/버전에 따라 달라질 수 있어서 여러 후보를 넣어둠
        const salesAmt =
          Number(
            s.salesAmt ??
              s.cost ??
              s.sales ??
              s.salesAmtAvg ??
              0
          ) || 0;

        const convCnt =
          Number(
            s.convCnt ??
              s.ccnt ??
              s.conversions ??
              0
          ) || 0;

        const convAmt =
          Number(
            s.convAmt ??
              s.convValue ??
              s.salesConvAmt ??
              0
          ) || 0;

        totalSalesAmt += salesAmt;

        rows.push({
          id: adId,
          nccAdId: adId,
          nccAdgroupId:
            ad.nccAdgroupId || ad.adgroupId || ad.nccAdGroupId || null,
          nccCampaignId: ad.nccCampaignId || ad.campaignId || null,
          productName: ad.adName || ad.name || "",
          mallProductId: ad.mallProductId || "",
          imageUrl: ad.imgUrl || ad.imageUrl || null,
          userLock: ad.userLock ?? false,
          bidAmt: ad.bidAmt ?? 0,

          imp: Number(s.imp ?? s.impCnt ?? 0),
          clk: Number(s.clk ?? s.clkCnt ?? 0),
          ctr: Number(s.ctr ?? 0),
          cpc: Number(s.cpc ?? 0),
          avgRnk: Number(s.avgRnk ?? 0),

          // 👉 BulkControlTab에서 쓰는 필드 이름에 맞춤
          salesAmt,
          ccnt: convCnt,
          convAmt,
        });
      } catch (e) {
        console.error("fetchStatPerAd error:", adId, e);
        rows.push({
          id: adId,
          nccAdId: adId,
          error: String(e.message || e),
        });
      }
    }

    return NextResponse.json({
      start,
      end,
      adgroupId,
      totalSalesAmt,
      rows,
    });
  } catch (e) {
    console.error("GET /api/stats/ads error:", e);
    return NextResponse.json(
      { error: "Unhandled error: " + String(e.message || e) },
      { status: 500 }
    );
  }
}
