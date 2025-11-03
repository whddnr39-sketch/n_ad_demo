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
  if (!start || !end) throw new Error("start/end 쿼리 파라미터가 필요합니다. 예: ?start=2025-11-01&end=2025-11-02");
  return { start, end };
}

// 내부용: 캠페인 ID 목록을 먼저 가져옴
async function listCampaignIds({ API_KEY, SECRET_KEY, CUSTOMER_ID }) {
  const base = "https://api.searchad.naver.com";
  const path = "/ncc/campaigns";
  const res = await fetch(base + path, {
    method: "GET",
    headers: makeHeaders({
      apiKey: API_KEY,
      secretKey: SECRET_KEY,
      customerId: CUSTOMER_ID,
      method: "GET",
      path,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`campaigns ${res.status}: ${await res.text()}`);
  const arr = await res.json();
  return (arr || []).map((c) => ({ id: c.nccCampaignId, name: c.name }));
}

// GET /api/stats/campaigns?start=YYYY-MM-DD&end=YYYY-MM-DD
// 반환: 각 캠페인의 salesAmt(비용) 합계와 함께 지표들
export async function GET(request) {
  try {
    const { API_KEY, SECRET_KEY, CUSTOMER_ID } = readAccount();
    const { start, end } = parseDateRange(request.url);

    // 1) 캠페인 목록(이름 매핑용)
    const all = await listCampaignIds({ API_KEY, SECRET_KEY, CUSTOMER_ID });
    const idArr = all.map((x) => x.id);
    if (idArr.length === 0) return Response.json({ rows: [], total: 0 });

    // 2) /stats 호출 (ids + fields + timeRange)
    const base = "https://api.searchad.naver.com";
    const path = "/stats";
    const method = "GET";

    const params = new URLSearchParams();
    params.set("ids", JSON.stringify(idArr));                // ["cmp-...","cmp-..."]
    params.set("fields", JSON.stringify([
      "impCnt","clkCnt","salesAmt","ctr","cpc","avgRnk"
    ]));
    params.set("timeRange", JSON.stringify({ since: start, until: end }));
    // 필요 시: params.set("timeIncrement","all") 등

    const url = `${base}${path}?${params.toString()}`;

    const res = await fetch(url, {
      method,
      headers: makeHeaders({
        apiKey: API_KEY,
        secretKey: SECRET_KEY,
        customerId: CUSTOMER_ID,
        method,
        path,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`stats ${res.status}: ${text}`);
    }

    const data = await res.json(); // 형식: [{ id:"cmp-...", items:[{...fields}] }, ...] 등
    // 다양한 응답 케이스를 방어적으로 처리
    const items = Array.isArray(data) ? data : (data?.data || []);
    const nameById = Object.fromEntries(all.map(x => [x.id, x.name]));

    let total = 0;
    const rows = [];

    for (const r of items) {
      // 일부 계정은 r.items 대신 r 자체에 지표가 올 수도 있어 방어 처리
      const id = r.id || r.nccCampaignId || r.campaignId;
      const name = nameById[id] || id;

      let agg = { impCnt:0, clkCnt:0, salesAmt:0, ctr:0, cpc:0, avgRnk:0, points:0 };

      const list = Array.isArray(r.items) ? r.items : [r];
      for (const it of list) {
        const imp = Number(it.impCnt ?? 0);
        const clk = Number(it.clkCnt ?? 0);
        const amt = Number(it.salesAmt ?? 0);
        const ctr = Number(it.ctr ?? 0);
        const cpc = Number(it.cpc ?? 0);
        const rnk = Number(it.avgRnk ?? 0);

        agg.impCnt += imp;
        agg.clkCnt += clk;
        agg.salesAmt += amt;
        // 평균 지표는 가중 평균(노출/클릭 기준) 등으로 다시 산출 가능.
        agg.ctr += ctr; 
        agg.cpc += cpc;
        agg.avgRnk += rnk;
        agg.points += 1;
      }

      if (agg.points > 0) {
        agg.ctr = agg.ctr / agg.points;
        agg.cpc = agg.cpc / agg.points;
        agg.avgRnk = agg.avgRnk / agg.points;
      }

      rows.push({
        id,
        name,
        impCnt: Math.round(agg.impCnt),
        clkCnt: Math.round(agg.clkCnt),
        salesAmt: Math.round(agg.salesAmt), // = 비용
        ctr: agg.ctr,
        cpc: agg.cpc,
        avgRnk: agg.avgRnk,
      });

      total += agg.salesAmt;
    }

    // 비용(salesAmt) 내림차순 정렬
    rows.sort((a, b) => b.salesAmt - a.salesAmt);

    return Response.json({ start, end, total: Math.round(total), rows });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500 });
  }
}
