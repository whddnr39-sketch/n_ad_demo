export const runtime = "nodejs";
import crypto from "crypto";

const BASE = "https://api.searchad.naver.com";

function sign(secretKey, method, path) {
  const ts = String(Date.now());
  const sig = crypto.createHmac("sha256", secretKey).update(`${ts}.${method}.${path}`).digest("base64");
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

// GET /api/adgroups?campaignId=cmp-...
export async function GET(req) {
  try {
    const { apiKey, secretKey, customerId } = env();
    const u = new URL(req.url);
    const campaignId = u.searchParams.get("campaignId"); // 선택: 특정 캠페인만

    const path = "/ncc/adgroups";
    const qs = campaignId ? `?nccCampaignId=${encodeURIComponent(campaignId)}` : "";
    const res = await fetch(`${BASE}${path}${qs}`, {
      method: "GET",
      headers: headers(apiKey, secretKey, customerId, "GET", path),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`adgroups ${res.status}: ${await res.text()}`);
    const data = await res.json();

    const groups = (data || []).map(g => ({
      id: g.nccAdgroupId,
      name: g.name,
      campaignId: g.nccCampaignId,
      status: g.status,
      regTm: g.regTm,
      editTm: g.editTm,
    }));
    return Response.json({ adgroups: groups });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500 });
  }
}
