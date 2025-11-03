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

// 보조: 특정 캠페인의 그룹들
async function listAdgroups({ apiKey, secretKey, customerId }, campaignId) {
  const path = "/ncc/adgroups";
  const qs = campaignId ? `?nccCampaignId=${encodeURIComponent(campaignId)}` : "";
  const res = await fetch(`${BASE}${path}${qs}`, {
    method: "GET",
    headers: headers(apiKey, secretKey, customerId, "GET", path),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`adgroups ${res.status}: ${await res.text()}`);
  const arr = await res.json();
  return (arr || []).map(g => ({ id: g.nccAdgroupId, name: g.name }));
}

// 그룹 하나의 소재들
async function listAdsOfGroup({ apiKey, secretKey, customerId }, adgroupId) {
  const path = "/ncc/ads";
  const qs = `?nccAdgroupId=${encodeURIComponent(adgroupId)}`;
  const res = await fetch(`${BASE}${path}${qs}`, {
    method: "GET",
    headers: headers(apiKey, secretKey, customerId, "GET", path),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ads ${adgroupId} ${res.status}: ${await res.text()}`);
  const arr = await res.json();
  return (arr || []).map(a => ({
    id: a.nccAdId,            // 보통 'nad-' 프리픽스
    name: a.ad?.name || a.ad?.nickname || a.name || a.nccAdId,
    adgroupId: a.nccAdgroupId,
    status: a.status,
    systemType: a.systemType,
    editTm: a.editTm,
  }));
}

// GET /api/ads?adgroupId=grp-... | ?campaignId=cmp-...
export async function GET(req) {
  try {
    const creds = env();
    const u = new URL(req.url);
    const adgroupId = u.searchParams.get("adgroupId");
    const campaignId = u.searchParams.get("campaignId");

    let ads = [];
    if (adgroupId) {
      ads = await listAdsOfGroup(creds, adgroupId);
    } else if (campaignId) {
      const groups = await listAdgroups(creds, campaignId);
      // 과도한 병렬 방지
      const CONC = 10;
      for (let i = 0; i < groups.length; i += CONC) {
        const part = groups.slice(i, i + CONC);
        const chunks = await Promise.all(part.map(g => listAdsOfGroup(creds, g.id)));
        for (const c of chunks) ads.push(...c);
      }
    } else {
      // 전체: 모든 그룹을 조회 후 합치기 (느릴 수 있음)
      const groups = await listAdgroups(creds, null);
      const CONC = 10;
      for (let i = 0; i < groups.length; i += CONC) {
        const part = groups.slice(i, i + CONC);
        const chunks = await Promise.all(part.map(g => listAdsOfGroup(creds, g.id)));
        for (const c of chunks) ads.push(...c);
      }
    }

    return Response.json({ ads });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500 });
  }
}
