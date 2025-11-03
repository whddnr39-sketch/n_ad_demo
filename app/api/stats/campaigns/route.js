// app/api/stats/campaigns/route.js
export const runtime = "nodejs";
import crypto from "crypto";

function makeHeaders({ apiKey, secretKey, customerId, method, path }) {
  const ts = String(Date.now());
  const msg = `${ts}.${method}.${path}`;
  const sig = crypto.createHmac("sha256", secretKey).update(msg).digest("base64");
  return {
    "X-Timestamp": ts,
    "X-API-KEY": apiKey,
    "X-Customer": String(customerId),
    "X-Signature": sig,
    "Content-Type": "application/json",
  };
}

function readAccount() {
  const API_KEY = process.env.API_KEY || process.env.NAVER_API_KEY;
  const SECRET_KEY = process.env.SECRET_KEY || process.env.NAVER_SECRET_KEY;
  const CUSTOMER_ID = process.env.CUSTOMER_ID || process.env.NAVER_CUSTOMER_ID;
  if (!API_KEY || !SECRET_KEY || !CUSTOMER_ID) {
    throw new Error("환경변수(API_KEY/SECRET_KEY/CUSTOMER_ID)가 필요합니다.");
  }
  return { API_KEY, SECRET_KEY, CUSTOMER_ID };
}

function parseDateRange(url) {
  const u = new URL(url);
  const start = u.searchParams.get("start");
  const end = u.searchParams.get("end");
  if (!start || !end) throw new Error("start/end 쿼리 파라미터가 필요합니다. 예) ?start=2025-11-01&end=2025-11-02");
  return { start, end };
}

// 캠페인 목록(이름 매핑용)
async function listCampaigns({ API_KEY, SECRET_KEY, CUSTOMER_ID }) {
  const base = "https://api.searchad.naver.com";
  const path = "/ncc/campaigns";
  const res = await fetch(base + path, {
    method: "GET",
    headers: makeHeaders({
      apiKey: API_KEY, secretKey: SECRET_KEY, customerId: CUSTOMER_ID,
      method: "GET", path
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`campaigns ${res.status}: ${await res.text()}`);
  const arr = await res.json();
  return (arr || []).map(c => ({ id: c.nccCampaignId, name: c.name }));
}

// /stats 호출 (ids를 배치로 쪼개어 합치기)
async function fetchStatsBatched({ ids, start, end, API_KEY, SECRET_KEY, CUSTOMER_ID, batchSize = 80 }) {
  const base = "https://api.searchad.naver.com";
  const path = "/stats";
  const method = "GET";

  const rows = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const slice = ids.slice(i, i + batchSize);
    const params = new URLSearchParams();
    params.set("ids", JSON.stringify(slice));
    params.set("fields", JSON.stringify(["impCnt","clkCnt","salesAmt","ctr","cpc","avgRnk"]));
    params.set("timeRange", JSON.stringify({ since: start, until: end }));
    const url = `${base}${path}?${params.toString()}`;

    const res = await fetch(url, {
      method,
      headers: makeHeaders({
        apiKey: API_KEY, secretKey: SECRET_KEY, customerId: CUSTOMER_ID,
        method, path
      }),
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`stats ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const items = Array.isArray(data) ? data : (data?.data || []);
    rows.push(...items);
  }
  return rows;
}

// GET /api/stats/campaigns?start=YYYY-MM-DD&end=YYYY-MM-DD
export async function GET(request) {
  try {
    const { API_KEY, SECRET_KEY, CUSTOMER_ID } = readAccount();
    const { start, end } = parseDateRange(request.url);

    // 1) 이름 매핑
    const all = await listCampaigns({ API_KEY, SECRET_KEY, CUSTOMER_ID });
    const idArr = all.map(x => x.id);
    if (idArr.length === 0) return Response.json({ start, end, total: 0, rows: [] });
    const nameById = Object.fromEntries(all.map(x => [x.id, x.name]));

    // 2) 배치로 stats 조회
    const raw = await fetchStatsBatched({ ids: idArr, start, end, API_KEY, SECRET_KEY, CUSTOMER_ID });

    // 3) 집계
    const byId = new Map();
    for (const r of raw) {
      const id = r.id || r.nccCampaignId || r.campaignId;
      const list = Array.isArray(r.items) ? r.items : [r];
      if (!byId.has(id)) byId.set(id, { impCnt:0, clkCnt:0, salesAmt:0, ctrSum:0, cpcSum:0, rnkSum:0, n:0 });
      const agg = byId.get(id);
      for (const it of list) {
        agg.impCnt += Number(it.impCnt ?? 0);
        agg.clkCnt += Number(it.clkCnt ?? 0);
        agg.salesAmt += Number(it.salesAmt ?? 0);
        agg.ctrSum += Number(it.ctr ?? 0);
        agg.cpcSum += Number(it.cpc ?? 0);
        agg.rnkSum += Number(it.avgRnk ?? 0);
        agg.n += 1;
      }
    }

    let total = 0;
    const rows = [];
    for (const [id, a] of byId.entries()) {
      const row = {
        id,
        name: nameById[id] || id,
        impCnt: Math.round(a.impCnt),
        clkCnt: Math.round(a.clkCnt),
        salesAmt: Math.round(a.salesAmt),
        ctr: a.n ? a.ctrSum / a.n : 0,
        cpc: a.n ? a.cpcSum / a.n : 0,
        avgRnk: a.n ? a.rnkSum / a.n : 0,
      };
      rows.push(row);
      total += row.salesAmt;
    }

    rows.sort((x, y) => y.salesAmt - x.salesAmt);
    return Response.json({ start, end, total: Math.round(total), rows });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500 });
  }
}
