export const runtime = "nodejs";

/* ---- 유틸 ---- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safeArr = (v) => (Array.isArray(v) ? v : []);
const toQS = (obj) => {
  const qs = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  });
  return qs.toString();
};

/** ✅ 서버에서도 항상 절대 URL을 만들기 위한 baseUrl */
function getBaseUrl(req) {
  // 1) 배포 환경 (Vercel) 우선
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  // 2) 요청에서 origin/host 사용
  try {
    const { origin } = new URL(req.url);
    if (origin && origin !== "null") return origin;
  } catch {}
  const host = req.headers.get("host") || "localhost:3000";
  const proto = process.env.NODE_ENV === "development" ? "http" : "https";
  return `${proto}://${host}`;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const start = searchParams.get("start");
    const end   = searchParams.get("end");
    const campaignId = searchParams.get("campaignId") || "";
    const adgroupId  = searchParams.get("adgroupId") || "";
    if (!start || !end) {
      return Response.json({ error: "start/end required" }, { status: 400 });
    }

    const base = getBaseUrl(req); // 👈 여기가 핵심

    // 1) 통계 호출 (절대 URL)
    const statsQS = toQS({ start, end, campaignId, adgroupId });
    const statsRes = await fetch(`${base}/api/_naver/stats/ads?${statsQS}`, {
      headers: { "x-internal": "1" },
    });
    const stats = await statsRes.json();
    if (!statsRes.ok || stats?.error) {
      throw new Error(stats?.error || `upstream ${statsRes.status}`);
    }

    let rows = safeArr(stats.rows);
    const total = Number(stats.total) || 0;

    // 2) 메타(이름) 호출 (절대 URL)
    const ids = rows.map((r) => r.id).filter(Boolean);
    const metaMap = await fetchAdsMetaMap(ids, base);

    // 3) 이름 주입
    rows = rows.map((r) => ({
      ...r,
      name: metaMap.get(r.id)?.name || r.name || r.id,
    }));

    rows.sort((a, b) => (b?.salesAmt || 0) - (a?.salesAmt || 0));

    return Response.json({ start, end, total, rows });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500 });
  }
}

/** 소재 메타 조회: 절대 URL 사용 */
async function fetchAdsMetaMap(ids, base) {
  const map = new Map();
  if (!ids.length) return map;

  const chunkSize = 80;
  const interDelayMs = 300;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const qs = toQS({ ids: chunk.join(",") });

    const res = await fetch(`${base}/api/_naver/ads?${qs}`, {
      headers: { "x-internal": "1" },
    });
    const data = await res.json();
    if (res.ok && Array.isArray(data)) {
      for (const a of data) {
        const id = a.nccAdId || a.id;
        if (id) map.set(id, { name: a.name || a.adName || null });
      }
    }
    await sleep(interDelayMs);
  }
  return map;
}
