// app/api/spend/route.js
export const runtime = "nodejs"; // crypto 사용 → Node 런타임

import crypto from "crypto";

function kstYesterdayRange() {
  const now = new Date();
  const kstMs = now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60_000;
  const y = new Date(kstMs - 24 * 60 * 60 * 1000);
  const yyyy = y.getUTCFullYear();
  const mm = String(y.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(y.getUTCDate()).padStart(2, "0");
  const d = `${yyyy}-${mm}-${dd}`;
  return { start: d, end: d };
}

function makeHeaders({ apiKey, secretKey, customerId }) {
  const ts = String(Date.now());
  const sig = crypto.createHmac("sha256", secretKey).update(ts).digest("hex");
  return {
    "X-Timestamp": ts,
    "X-API-KEY": apiKey,
    "X-Customer": String(customerId),
    "X-Signature": sig,
    "Content-Type": "application/json",
  };
}

async function fetchSpendForCustomer(customerId, start, end) {
  const base = "https://api.searchad.naver.com";
  const url = `${base}/stats?level=CAMPAIGN&timeRange=DAY&start=${start}&end=${end}`;

  const res = await fetch(url, {
    headers: makeHeaders({
      apiKey: process.env.API_KEY,        // <-- 여기!
      secretKey: process.env.SECRET_KEY,  // <-- 여기!
      customerId,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Naver API ${res.status}: ${txt}`);
  }

  const data = await res.json();
  const list = Array.isArray(data) ? data : (data?.data || []);
  let cost = 0;
  for (const row of list) {
    if (typeof row.cost === "number") cost += row.cost;
    if (Array.isArray(row.items)) {
      for (const it of row.items) {
        if (typeof it.cost === "number") cost += it.cost;
      }
    }
  }
  return cost;
}

export async function GET() {
  try {
    const { start, end } = kstYesterdayRange();
    const ids = String(process.env.CUSTOMER_ID || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    if (ids.length === 0) throw new Error("CUSTOMER_ID is empty");

    let total = 0;
    for (const id of ids) total += await fetchSpendForCustomer(id, start, end);

    return Response.json({ date: start, spend: Math.round(total) });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500 });
  }
}
