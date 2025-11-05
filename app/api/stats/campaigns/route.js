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
  if (!apiKey || !secretKey || !customerId) {
    throw new Error("apiKey/secretKey/customerId가 비어 있습니다 (env 확인).");
  }
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
  // ✅ 소문자 키로 매핑해서 반환
  return { apiKey: API_KEY, secretKey: SECRET_KEY, customerId: CUSTOMER_ID };
}

function parseRange(url) {
  const u = new URL(url);
  const start = u.searchParams.get("start");
  const end = u.searchParams.get("end");
  if (!start || !end) throw new Error("start/end 파라미터 필요. 예) ?start=2025-11-01&end=2025-11-02");
  return { start, end };
}

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

// 단일 캠페인 id로 /stats 조회
async function fetchStatPerCampaign(env, id, start, end) {
  const path = "/stats";
  const params = new URLSearchParams();
  params.set("id", id); // ← 단일 id
  params.set("fields", JSON.stringify(["impCnt","clkCnt","salesAmt","ctr","cpc","avgRnk","ccnt","convAmt"])); // ✅ 전환수(ccnt), 전환매출(convAmt) 포함
  params.set("timeRange", JSON.stringify({ since: start, until: end }));
  const url = `${BASE}${path}?${params.toString()}`;

  const res = await fetch(url, {
    method: "GET",
    headers: headers({ ...env, method: "GET", path }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`stats ${id} ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const arr = Array.isArray(data) ? data : (data?.data || data?.items || []);
  let agg = { impCnt:0, clkCnt:0, salesAmt:0, ctrSum:0, cpcSum:0, rnkSum:0, convSum:0, convAmtSum:0, n:0 };

  for (const it of arr) {
    const list = Array.isArray(it?.items) ? it.items : [it];
    for (const x of list) {
      agg.impCnt += Number(x.impCnt ?? 0);
      agg.clkCnt += Number(x.clkCnt ?? 0);
      agg.salesAmt += Number(x.salesAmt ?? 0);
      agg.ctrSum += Number(x.ctr ?? 0);
      agg.cpcSum += Number(x.cpc ?? 0);
      agg.rnkSum += Number(x.avgRnk ?? 0);
      agg.convSum += Number(x.ccnt ?? 0);      // ✅ 전환수 합산
      agg.convAmtSum += Number(x.convAmt ?? 0);   // ✅ 전환매출액 합산 
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
    ccnt: Math.round(agg.convSum),          // ✅ 전환수 반환
    convAmt: Math.round(agg.convAmtSum),    // ✅ 전환매출액 반환 
  };
}

export async function GET(req) {
  try {
    const env = readEnv();                         // ← 소문자 키로 받음
    const { start, end } = parseRange(req.url);

    const list = await listCampaigns(env);
    if (list.length === 0) return Response.json({ start, end, total: 0, rows: [] });

    // 병렬 호출 제한
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
