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
  if (!apiKey || !secretKey || !customerId) {
    throw new Error("env(API_KEY/SECRET_KEY/CUSTOMER_ID) 필요");
  }
  return { apiKey, secretKey, customerId };
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * start / end / adgroupId / campaignId / cursor / limit 파싱
 *  - cursor: 광고그룹 인덱스 또는 그룹 내 소재 인덱스
 *  - limit: 이번 요청에서 가져올 최대 소재 개수 (ex: 400)
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

  let limit = null;
  if (limitStr) {
    const n = Number(limitStr);
    if (Number.isFinite(n) && n > 0) {
      limit = Math.floor(n);
    }
  }

  return {
    start,
    end,
    adgroupId,
    campaignId,
    cursor: cursor ?? null,
    limit,
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
  if (!res.ok) {
    throw new Error(`ads ${adgroupId} ${res.status}: ${await res.text()}`);
  }
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
  if (!res.ok) {
    throw new Error(`adgroups ${res.status}: ${await res.text()}`);
  }
  const arr = await res.json();
  return (arr || []).map((g) => ({
    id: g.nccAdgroupId,
    name: g.name,
  }));
}

/**
 * 전체 한 번에 조회 (limit 없이) – 1번 탭에서 캠페인/그룹 단위 조회 시 사용
 */
async function listAdsAll(creds, { adgroupId, campaignId }) {
  if (adgroupId) {
    const ads = await listAdsOfGroup(creds, adgroupId);
    return { ads, nextCursor: null };
  }

  const groups = await listAdgroups(creds, campaignId || null);
  const CONC = 3; // 동시 그룹 처리 개수 (너무 높이면 429 위험)
  const all = [];

  for (let i = 0; i < groups.length; i += CONC) {
    const part = groups.slice(i, i + CONC);
    const chunks = await Promise.all(
      part.map((g) => listAdsOfGroup(creds, g.id))
    );
    for (const c of chunks) {
      all.push(...c);
    }
    await sleep(150);
  }

  return { ads: all, nextCursor: null };
}

/**
 * limit & cursor 기반으로 "최대 limit개"만 가져오기
 *  - Bulk 탭 STEP1에서 전체 계정/캠페인 대상 조회 시 사용
 *  - 네가 말한 것처럼, 여기서 400개 단위로 끊어서 리턴 가능
 */
async function listAdsChunk(creds, { adgroupId, campaignId, cursor, limit }) {
  // adgroupId 하나만 볼 때는 그룹 단위 청크 필요 없이 소재 배열에서 슬라이스
  if (adgroupId) {
    const allAds = await listAdsOfGroup(creds, adgroupId);
    const startIndex = cursor ? Number(cursor) || 0 : 0;
    const slice = allAds.slice(startIndex, startIndex + limit);
    const nextCursor =
      startIndex + limit < allAds.length
        ? String(startIndex + limit)
        : null;
    return { ads: slice, nextCursor };
  }

  // 캠페인/계정 전체 대상 – 광고그룹 기준으로 순회하면서 소재를 limit개까지 채움
  const groups = await listAdgroups(creds, campaignId || null);
  const startGroup = cursor ? Number(cursor) || 0 : 0;
  const CONC = 3;
  const ads = [];

  let i = startGroup;
  while (i < groups.length && ads.length < limit) {
    const part = groups.slice(i, i + CONC);

    const chunks = await Promise.all(
      part.map((g) => listAdsOfGroup(creds, g.id))
    );

    for (const chunk of chunks) {
      for (const ad of chunk) {
        ads.push(ad);
        if (ads.length >= limit) break;
      }
      if (ads.length >= limit) break;
    }

    i += part.length;

    if (ads.length < limit) {
      await sleep(150);
    }
  }

  const nextCursor = i < groups.length ? String(i) : null;
  return { ads, nextCursor };
}

/* ---------------- /stats 호출 ---------------- */

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
      "ccnt",
      "convAmt",
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
  if (!res.ok) {
    throw new Error(`stats ${adId} ${res.status}: ${await res.text()}`);
  }

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
    const { start, end, adgroupId, campaignId, cursor, limit } =
      parseQuery(req.url);

    // 네가 말한대로 "400개 단위"로 쓰려면 프론트에서 limit=400을 넘기면 됨
    let adsInfo;
    if (limit && !adgroupId && !campaignId) {
      // 계정 전체 + limit 지정
      adsInfo = await listAdsChunk(creds, {
        adgroupId: null,
        campaignId: null,
        cursor,
        limit,
      });
    } else if (limit) {
      // adgroupId / campaignId 가 같이 온 경우에도 limit 사용
      adsInfo = await listAdsChunk(creds, {
        adgroupId: adgroupId || null,
        campaignId: campaignId || null,
        cursor,
        limit,
      });
    } else {
      // limit 없으면 기존처럼 전체 조회
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
      nextCursor,
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e.message || e) }),
      { status: 500 }
    );
  }
}
