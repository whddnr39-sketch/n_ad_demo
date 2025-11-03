// app/api/stats/campaigns/route.js
export const runtime = "nodejs";
import crypto from "crypto";

const BASE = "https://api.searchad.naver.com";

function sign({ secretKey, method, path }) {
  const ts = String(Date.now());
  const msg = `${ts}.${method}.${path}`;
  const sig = crypto.createHmac("sha256", secretKey).update(msg).digest("base64");
  return { ts, sig };
}

function headers({ apiKey, secretKey, customerId, method, path }) {
  const { ts, sig } = sign({ secretKey, method, path });
  return {
    "X-Timestamp": ts,
    "X-API-KEY": apiKey,
    "X-Customer": String(customerId),
    "X-Signature": sig,
    "Content-Type": "application/json",
  };
}

function readEnv() {
  const API_KEY = process.env.API_KEY || process.env.NAVER_API_KEY;
  const SECRET_KEY = process.env.SECRET_KEY || process.env.NAVER_SECRET_KEY;
  const CUSTOMER_ID = process.env.CUSTOMER_ID || process.env.NAVER_CUSTOMER_ID;
  if (!API_KEY || !SECRET_KEY || !CUSTOMER_ID) {
    throw new Error("환경변수(API_KEY/SECRET_KEY/CUSTOMER_ID)가 필요합니다.");
  }
  return { API_KEY, SECRET_KEY, CUSTOMER_ID };
}

function parseRange(url) {
  const u = new URL(url);
  const start = u.searchParams.get("start");
  const end = u.searchParams.get("end");
  if (!start || !end) throw new Error("start/end 파라미터가 필요합니다. 예) ?start=2025-11-01&end=2025-11-02");
  return { start, end };
}

// 1) 캠페인 목록
async function listCampaigns(env) {
  const path = "/ncc/campaigns";
  const res = await fetch(BASE + path, {
    method: "GET",
    headers: headers({ ...env, method: "GET", path }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`campaigns ${res.status}: ${await res.text()}`);
  const arr = await res.json();
  return (arr || []).map(c => ({ id: c.nccCampaignId, name: c.name }));
}

// 2) 캠페인 단건 통계(/stats?id=...)
async function fetchStatPerCampaign(env, id, start, end) {
  const path = "/stats";
  const params = new URLSearchParams();
  params.set("id", id); // ← 단일 id로 호출 (ids 사용 안 함)
  params.set("fields", JSON.stringify(["impCnt", "clkCnt", "salesAmt", "ctr", "cpc", "avgRnk"]));
  params.set("timeRange", JSON.stringify({ since: start, until: end }));
  const url = `${BASE}${path}?${params.toString()}`;

  const res = await fetch(url, {
    method: "GET",
    headers: headers({ ...env, method: "GET", path }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`stats ${id} ${res.status}: ${await res.text()}`);
  // 응답이 배열/객체 계정별로 다를 수 있어 방어적으로 처리
  const data = await res.json();
  const items = Array.isArray(data) ? data : (data?.data || data?.items || []);
  // 합산
  let agg = { impCnt: 0, clkCnt: 0, salesAmt: 0, ctrSum: 0, cpcSum: 0, rnkSum: 0, n: 0 };
  for (const it of items) {
    const v = it.items ? it.items : [it];
    for (const x of v) {
      agg.impCnt += Number(x.impCnt ?? 0);
      agg.clkCnt += Number(x.clkCnt ?? 0);
      agg.salesAmt += Number(x.salesAmt ?? 0);
      agg.ctrSum += Number(x.ctr ?? 0);
      agg.cpcSum += Number(x.cpc ?? 0);
      agg.rnkSum += Number(x.avgRnk ?? 0);
      agg.n += 1;
    }
  }
  return {
    impCnt: Math.round(agg.impCnt),
    clkCnt: Math.round(agg.clkCnt),
    salesAmt: Math.round(agg.salesAmt),
    ctr: agg.n ? agg.ctrSum / agg.n : 0,
    cpc: agg.n ? agg.cpcSum / agg.n : 0,
    avgRnk: agg.n ? agg.rnkSum / agg.n : 0,
  };
}

export async function GET(req) {
  try {
    const env = readEnv();
    const { start, end } = parseRange(req.url);

    const list = await listCampaigns(env);
    if (list.length === 0) return Response.json({ start, end, total: 0, rows: [] });

    // 동시 호출 (너무 많으면 병렬 폭 제한)
    const CONCURRENCY = 10;
    const rows = [];
    let total = 0;

    for (let i = 0; i < list.length; i += CONCURRENCY) {
      const slice = list.slice(i, i + CONCURRENCY);
      const stats = await Promise.all(
        slice.map(async c => {
          const s = await fetchStatPerCampaign(env, c.id, start, end);
          return { id: c.id, name: c.name, ...s };
        })
      );
      for (const r of stats) {
        rows.push(r);
        total += r.salesAmt;
      }
    }

    rows.sort((a, b) => b.salesAmt - a.salesAmt);
    return Response.json({ start, end, total: Math.round(total), rows });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500 });
  }
}
