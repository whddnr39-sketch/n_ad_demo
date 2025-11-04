export const runtime = "nodejs";
import crypto from "crypto";

const BASE = "https://api.searchad.naver.com";

function sign(secretKey, method, path) {
  const ts = String(Date.now());
  const sig = crypto.createHmac("sha256", secretKey)
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
  if (!apiKey || !secretKey || !customerId) throw new Error("env(API_KEY/SECRET_KEY/CUSTOMER_ID) 필요");
  return { apiKey, secretKey, customerId };
}
function range(url) {
  const u = new URL(url);
  const start = u.searchParams.get("start");
  const end = u.searchParams.get("end");
  const adgroupId = u.searchParams.get("adgroupId");
  const campaignId = u.searchParams.get("campaignId");
  if (!start || !end) throw new Error("start/end 필요");
  return { start, end, adgroupId, campaignId };
}

// ✅ 추가 필드 포함된 소재 조회
async function listAdsOfGroup(creds, adgroupId) {
  const path = "/ncc/ads";
  const qs = `?nccAdgroupId=${encodeURIComponent(adgroupId)}`;
  const res = await fetch(`${BASE}${path}${qs}`, {
    method: "GET",
    headers: headers(creds.apiKey, creds.secretKey, creds.customerId, "GET", path),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ads ${adgroupId} ${res.status}: ${await res.text()}`);
  const arr = await res.json();

  // 🔹 SHOPPING_PRODUCT_AD만 필터링
  return (arr || [])
    .filter(a => a.type === "SHOPPING_PRODUCT_AD")
    .map(a => {
      const ref = a.referenceData || {};
      const attr = a.adAttr || {};
      return {
        id: a.nccAdId,
        name: ref.productName || ref.productTitle || a.name || a.nccAdId,
        bidAmt: attr.bidAmt ?? null,
        mallProductId: ref.mallProductId ?? null,
        imageUrl: ref.imageUrl ?? null,
        productName: ref.productName ?? null,
      };
    });
}

async function listAdgroups(creds, campaignId) {
  const path = "/ncc/adgroups";
  const qs = campaignId ? `?nccCampaignId=${encodeURIComponent(campaignId)}` : "";
  const res = await fetch(`${BASE}${path}${qs}`, {
    method: "GET",
    headers: headers(creds.apiKey, creds.secretKey, creds.customerId, "GET", path),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`adgroups ${res.status}: ${await res.text()}`);
  const arr = await res.json();
  return (arr || []).map(g => ({ id: g.nccAdgroupId, name: g.name }));
}

async function listAds(creds, { adgroupId, campaignId }) {
  if (adgroupId) {
    return await listAdsOfGroup(creds, adgroupId);
  }
  const groups = await listAdgroups(creds, campaignId || null);
  const CONC = 10;
  let all = [];
  for (let i = 0; i < groups.length; i += CONC) {
    const part = groups.slice(i, i + CONC);
    const chunks = await Promise.all(part.map(g => listAdsOfGroup(creds, g.id)));
    for (const c of chunks) all.push(...c);
  }
  return all;
}

// 단일 소재 id로 /stats 호출 (기존 그대로)
async function fetchStatPerAd(creds, adId, start, end) {
  const path = "/stats";
  const params = new URLSearchParams();
  params.set("id", adId);
  params.set("fields", JSON.stringify(["impCnt","clkCnt","salesAmt","ctr","cpc","avgRnk"]));
  params.set("timeRange", JSON.stringify({ since: start, until: end }));

  const res = await fetch(`${BASE}${path}?${params.toString()}`, {
    method: "GET",
    headers: headers(creds.apiKey, creds.secretKey, creds.customerId, "GET", path),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`stats ${adId} ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const arr = Array.isArray(data) ? data : (data?.data || data?.items || []);
  let agg = { imp:0, clk:0, amt:0, ctr:0, cpc:0, rnk:0, n:0 };
  for (const it of arr) {
    const list = Array.isArray(it?.items) ? it.items : [it];
    for (const x of list) {
      agg.imp += Number(x.impCnt ?? 0);
      agg.clk += Number(x.clkCnt ?? 0);
      agg.amt += Number(x.salesAmt ?? 0);
      agg.ctr += Number(x.ctr ?? 0);
      agg.cpc += Number(x.cpc ?? 0);
      agg.rnk += Number(x.avgRnk ?? 0);
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
  };
}

// ✅ 메인 핸들러
export async function GET(req) {
  try {
    const creds = env();
    const { start, end, adgroupId, campaignId } = range(req.url);

    const ads = await listAds(creds, { adgroupId, campaignId });
    if (!ads.length) return Response.json({ start, end, total: 0, rows: [] });

    const CONC = 10;
    const rows = [];
    let total = 0;
    for (let i = 0; i < ads.length; i += CONC) {
      const part = ads.slice(i, i + CONC);
      const stats = await Promise.all(
        part.map(async a => ({
          id: a.id,
          name: a.name,
          ...(await fetchStatPerAd(creds, a.id, start, end)),
          // 🔹 신규 필드들 그대로 전달
          nccAdId: a.id,
          bidAmt: a.bidAmt,
          mallProductId: a.mallProductId,
          imageUrl: a.imageUrl,
          productName: a.productName,
        }))
      );
      for (const r of stats) {
        rows.push(r);
        total += r.salesAmt;
      }
    }
    rows.sort((a, b) => b.salesAmt - a.salesAmt);
    return Response.json({
      start, end,
      adgroupId: adgroupId || null,
      campaignId: campaignId || null,
      total: Math.round(total), rows
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500 });
  }
}
