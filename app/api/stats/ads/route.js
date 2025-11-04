// app/api/stats/ads/route.js
export const runtime = "nodejs";
import crypto from "crypto";

const BASE = "https://api.searchad.naver.com";

function sign(secretKey, method, path) {
  const ts = String(Date.now());
  const sig = crypto.createHmac("sha256", secretKey).update(`${ts}.${method}.${path}`).digest("base64");
  return { ts, sig };
}
function headers({ apiKey, secretKey, customerId, method, path }) {
  const { ts, sig } = sign(secretKey, method, path);
  return {
    "X-Timestamp": ts,
    "X-API-KEY": apiKey,
    "X-Customer": String(customerId),
    "X-Signature": sig,
    "Content-Type": "application/json",
  };
}
function readEnv() {
  const apiKey = process.env.API_KEY;
  const secretKey = process.env.SECRET_KEY;
  const customerId = process.env.CUSTOMER_ID;
  if (!apiKey || !secretKey || !customerId) throw new Error("apiKey/secretKey/customerId가 비어 있습니다 (env 확인).");
  return { apiKey, secretKey, customerId };
}

/** ---- 목록 조회 ---- **/
async function listAdgroups(env, campaignId = null) {
  const path = "/ncc/adgroups";
  const qs = campaignId ? `?nccCampaignId=${encodeURIComponent(campaignId)}` : "";
  const res = await fetch(`${BASE}${path}${qs}`, {
    method: "GET",
    headers: headers({ ...env, method: "GET", path }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`adgroups ${res.status}: ${await res.text()}`);
  const arr = await res.json();
  return (arr || []).map(g => ({ id: g.nccAdgroupId, name: g.name, campaignId: g.nccCampaignId }));
}

async function listAdsOfGroup(env, adgroupId) {
  const path = "/ncc/ads";
  const qs = `?nccAdgroupId=${encodeURIComponent(adgroupId)}`;
  const res = await fetch(`${BASE}${path}${qs}`, {
    method: "GET",
    headers: headers({ ...env, method: "GET", path }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ads ${res.status}: ${await res.text()}`);
  const arr = await res.json();

  // 유형별로 안전하게 이름만 뽑기 (이미지/URL은 보류)
  return (arr || []).map(a => {
    const id = a.nccAdId;
    const name = a.ad?.name ?? a.ad?.headline ?? a.nccAdId;
    return { id, name, adgroupId };
  });
}

async function listAds(env, { adgroupId, campaignId }) {
  if (adgroupId) return await listAdsOfGroup(env, adgroupId);

  const groups = await listAdgroups(env, campaignId || null);
  const CONC = 10;
  let all = [];
  for (let i = 0; i < groups.length; i += CONC) {
    const part = groups.slice(i, i + CONC);
    const chunk = await Promise.all(part.map(g => listAdsOfGroup(env, g.id)));
    for (const c of chunk) all.push(...c);
  }
  return all;
}

/** ---- 통계 조회 ---- **/
async function fetchStatPerAd(env, adId, start, end) {
  const path = "/stats";
  const params = new URLSearchParams();
  params.set("id", adId);
  params.set("fields", JSON.stringify(["impCnt","clkCnt","salesAmt","ctr","cpc","avgRnk"]));
  params.set("timeRange", JSON.stringify({ since:start, until:end }));
  const res = await fetch(`${BASE}${path}?${params.toString()}`, {
    method:"GET",
    headers: headers({ ...env, method:"GET", path }),
    cache:"no-store",
  });
  if (!res.ok) throw new Error(`stats ${res.status}: ${await res.text()}`);
  return await res.json();
}

/** ---- 메인 핸들러 ---- **/
export async function GET(req) {
  try {
    const env = readEnv();
    const u = new URL(req.url);
    const start = u.searchParams.get("start");
    const end = u.searchParams.get("end");
    const adgroupId = u.searchParams.get("adgroupId");
    const campaignId = u.searchParams.get("campaignId");

    // 1) 광고(소재) 목록을 먼저 모으고 (id, name)
    const ads = await listAds(env, { adgroupId, campaignId });

    // 2) 각 소재별 통계를 붙인다
    const CONC = 12;
    let rows = [];
    let total = 0;

    for (let i = 0; i < ads.length; i += CONC) {
      const part = ads.slice(i, i + CONC);
      const stats = await Promise.all(part.map(async a => {
        const s = await fetchStatPerAd(env, a.id, start, end);
        const r = {
          id: a.id,
          name: a.name,         // ✅ 이름 포함
          impCnt: s.impCnt ?? 0,
          clkCnt: s.clkCnt ?? 0,
          salesAmt: s.salesAmt ?? 0,
          ctr: s.ctr ?? 0,
          cpc: s.cpc ?? 0,
          avgRnk: s.avgRnk ?? 0,
        };
        return r;
      }));
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
      total: Math.round(total),
      rows
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500 });
  }
}
