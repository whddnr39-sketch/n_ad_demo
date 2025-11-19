export const runtime = "nodejs";
import crypto from "crypto";

const BASE = "https://api.searchad.naver.com";

/* ---------------- 공통 유틸 ---------------- */

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
  const customerId =
    process.env.CUSTOMER_ID || process.env.NAVER_CUSTOMER_ID;
  if (!apiKey || !secretKey || !customerId)
    throw new Error("env(API_KEY/SECRET_KEY/CUSTOMER_ID) 필요");
  return { apiKey, secretKey, customerId };
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * start / end / adgroupId / campaignId / limit / cursor 파싱
 *  - limit: 한 번에 가져올 최대 소재 개수 (없으면 전체)
 *  - cursor: adgroup 청크 시작 index (없으면 0부터)
 */
function parseQuery(url) {
  const u = new URL(url);
  const start = u.searchParams.get("start");
  const end = u.searchParams.get("end");
  const adgroupId = u.searchParams.get("adgroupId");
  const campaignId = u.searchParams.get("campaignId");
  const cursor = u.searchParams.get("cursor");
  const limitStr = u.searchParams.get("limit");

  if (!start || !end) throw new Error("start/end 필요");

  const limit = limitStr ? Number(limitStr) : null;
  const safeLimit =
    Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null;

  return {
    start,
    end,
    adgroupId,
    campaignId,
    cursor: cursor ?? null,
    limit: safeLimit,
  };
}

/* ---------------- 소재 / 그룹 조회 ---------------- */

/**
 * 특정 광고그룹의 소재 목록 (/ncc/ads)
 * SHOPPING_PRODUCT_AD 만 필터
 */
async function listAdsOfGroup(creds, adgroupId) {
  const path = "/ncc/ads";
  const qs = `?nccAdgroupId=${encodeURIComponent(adgroupId)}`;
  const res = await fetch(`${BASE}${path}${qs}`, {
    method: "GET",
    headers: headers(
      creds.apiKey,
      creds.secretKey,
      creds.customerId,
      "GET",
      path
    ),
    cache: "no-store",
  });

  if (!res.ok)
    throw new Error(`ads ${adgroupId} ${res.status}: ${await res.text()}`);

  const arr = await res.json();

  return (arr || [])
    .filter((a) => a.type === "SHOPPING_PRODUCT_AD")
    .map((a) => {
      const ref = a.referenceData || {};
      const attr = a.adAttr || {};
      return {
        id: a.nccAdId,
        name: ref.productName || ref.productTitle || a.name || a.nccAdId,
        bidAmt: attr.bidAmt ?? null,
        mallProductId: ref.mallProductId ?? null,
        imageUrl: ref.imageUrl ?? null,
        productName: ref.productName ?? null,
        userLock: a.userLock ?? null,
      };
    });
}

/**
 * 캠페인 기준 광고그룹 목록 (/ncc/adgroups)
 */
async function listAdgroups(creds, campaignId) {
  const path = "/ncc/adgroups";
  const qs = campaignId
    ? `?nccCampaignId=${encodeURIComponent(campaignId)}`
    : "";
  const res = await fetch(`${BASE}${path}${qs}`, {
    method: "GET",
    headers: headers(
      creds.apiKey,
      creds.secretKey,
      creds.customerId,
      "GET",
      path
    ),
    cache: "no-store",
  });

  if (!res.ok)
    throw new Error(`adgroups ${res.status}: ${await res.text()}`);

  const arr = await res.json();
  return (arr || []).map((g) => ({ id: g.nccAdgroupId, name: g.name }));
}

/**
 * 기존처럼 "전체 한 번에" 소재 가져오기 (Stats 탭에서 캠페인/그룹 단위 조회 시 사용)
 */
async function listAdsAll(creds, { adgroupId, campaignId }) {
  if (adgroupId) {
    const ads = await listAdsOfGroup(creds, adgroupId);
    return { ads, nextCursor: null };
  }

  const groups = await listAdgroups(creds, campaignId || null);
  const CONC = 3; // 레이트 리밋 방지를 위해 동시 요청 수 조금 줄임
  let all = [];

  for (let i = 0; i < groups.length; i += CONC) {
    const part = groups.slice(i, i + CONC);
    const chunks = await Promise.all(
      part.map((g) => listAdsOfGroup(creds, g.id))
    );
    for (const c of chunks) all.push(...c);

    // 너무 몰아서 치지 않도록 살짝 텀
    await sleep(40);
  }

  return { ads: all, nextCursor: null };
}

/**
 * limit & cursor 기반으로 "부분 청크"만 가져오기
 *  - Bulk 탭 STEP1에서 전체 계정 대상 조회 시 사용
 *  - limit 개수만큼 채워질 때까지 adgroup 단위로 순차 호출
 */
async function listAdsChunk(creds, { campaignId, limit, cursor }) {
  const groups = await listAdgroups(creds, campaignId || null);
  const startIndex = cursor ? Number(cursor) || 0 : 0;

  const CONC = 3; // 동시에 처리할 그룹 수
  const ads = [];

  let i = startIndex;
  while (i < groups.length && ads.length < limit) {
    const part = groups.slice(i, i + CONC);
    const chunks = await Promise.all(
      part.map((g) => listAdsOfGroup(creds, g.id))
    );

    for (const c of chunks) {
      ads.push(...c);
      if (ads.length >= limit) break;
    }

    i += CONC;

    if (ads.length < limit) {
      // 다음 청크 전에 아주 짧은 텀 (레이트 리밋 완화)
      await sleep(40);
    }
  }

  const nextCursor = i < groups.length ? String(i) : null;

  return { ads, nextCursor, totalGroups: groups.length };
}

/* ---------------- /stats 호출 ---------------- */

/**
 * 단일 소재 id로 /stats 호출
 */
async function fetchStatPerAd(creds, adId, start, end) {
  const path = "/stats";
  const params = new URLSearchParams();
  params.set("id", adId);
  params.set(
    "fields",
    JSON.stringify([
      "impCnt",
      "clkCnt",
      "salesAmt",
      "ctr",
      "cpc",
      "avgRnk",
      "ccnt", // 전환수
      "convAmt", // 전환매출액
    ])
  );
  params.set("timeRange", JSON.stringify({ since: start, until: end }));

  const res = await fetch(`${BASE}${path}?${params.toString()}`, {
    method: "GET",
    headers: headers(
      creds.apiKey,
      creds.secretKey,
      creds.customerId,
      "GET",
      path
    ),
    cache: "no-store",
  });

  if (!res.ok)
    throw new Error(`stats ${adId} ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const arr = Array.isArray(data)
    ? data
    : data?.data || data?.items || [];

  let agg = {
    imp: 0,
    clk: 0,
    amt: 0,
    ctr: 0,
    cpc: 0,
    rnk: 0,
    conv: 0,
    convAmt: 0,
    n: 0,
  };

  for (const it of arr) {
    const list = Array.isArray(it?.items) ? it.items : [it];
    for (const x of list) {
      agg.imp += Number(x.impCnt ?? 0);
      agg.clk += Number(x.clkCnt ?? 0);
      agg.amt += Number(x.salesAmt ?? 0);
      agg.ctr += Number(x.ctr ?? 0);
      agg.cpc += Number(x.cpc ?? 0);
      agg.rnk += Number(x.avgRnk ?? 0);
      agg.conv += Number(x.ccnt ?? 0);
      agg.convAmt += Number(x.convAmt ?? 0);
      agg.n += 1;
    }
  }

  return {
    impCnt: Math.round(agg.imp),
    clkCnt: Math.round(agg.clk),
    salesAmt: Math.round(agg.amt),
    ctr: agg.n ? agg.ctr / agg.n : 0,
    cpc: agg.n ? agg.cpc / agg.n : 0,
    avgRnk: agg.n ? agg.rnk / agg.n : 0,
    ccnt: Math.round(agg.conv),
    convAmt: Math.round(agg.convAmt),
  };
}

/* ---------------- 메인 핸들러 ---------------- */

export async function GET(req) {
  try {
    const creds = env();
    const {
      start,
      end,
      adgroupId,
      campaignId,
      cursor,
      limit,
    } = parseQuery(req.url);

    let adsInfo;
    if (limit && !adgroupId) {
      // ✅ Bulk 탭용: limit & cursor 기반 부분 로딩
      adsInfo = await listAdsChunk(creds, {
        campaignId: campaignId || null,
        limit,
        cursor,
      });
    } else {
      // ✅ 기존 동작: 전체 조회 (Stats 탭에서 사용)
      adsInfo = await listAdsAll(creds, { adgroupId, campaignId });
    }

    const ads = adsInfo.ads || [];
    const nextCursor = adsInfo.nextCursor ?? null;

    if (!ads.length) {
      return Response.json({
        start,
        end,
        adgroupId: adgroupId || null,
        campaignId: campaignId || null,
        total: 0,
        rows: [],
        nextCursor,
      });
    }

    // 소재별 /stats 조회
    const CONC = 10;
    const rows = [];
    let total = 0;

    for (let i = 0; i < ads.length; i += CONC) {
      const part = ads.slice(i, i + CONC);
      const stats = await Promise.all(
        part.map(async (a) => {
          const s = await fetchStatPerAd(creds, a.id, start, end);
          return {
            id: a.id,
            name: a.name,
            ...s,
            nccAdId: a.id,
            bidAmt: a.bidAmt,
            mallProductId: a.mallProductId,
            imageUrl: a.imageUrl,
            productName: a.productName,
            userLock: a.userLock,
          };
        })
      );
      for (const r of stats) {
        rows.push(r);
        total += r.salesAmt;
      }
    }

    rows.sort((a, b) => b.salesAmt - a.salesAmt);

    return Response.json({
      start,
      end,
      adgroupId: adgroupId || null,
      campaignId: campaignId || null,
      total: Math.round(total),
      rows,
      nextCursor, // 🔥 Bulk 탭에서 다음 청크 호출 여부 판단에 사용
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e.message || e) }),
      { status: 500 }
    );
  }
}
