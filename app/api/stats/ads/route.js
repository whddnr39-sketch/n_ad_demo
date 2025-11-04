// app/api/stats/ads/route.js
export const runtime = "nodejs";

// --- (필요 시) 간단 유틸 ---
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safeArr = (v) => (Array.isArray(v) ? v : []);
const toQS = (obj) => {
  const qs = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  });
  return qs.toString();
};

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    const campaignId = searchParams.get("campaignId") || "";
    const adgroupId = searchParams.get("adgroupId") || "";
    if (!start || !end) {
      return Response.json({ error: "start/end required" }, { status: 400 });
    }

    // 1) 통계 불러오기 (내부 프록시 경로는 기존에 사용 중인 것으로 맞춰주세요)
    const statsQS = toQS({ start, end, campaignId, adgroupId });
    const statsRes = await fetch(`/api/_naver/stats/ads?${statsQS}`, {
      headers: { "x-internal": "1" },
    });
    const stats = await statsRes.json();
    if (!statsRes.ok || stats?.error) {
      throw new Error(stats?.error || `upstream ${statsRes.status}`);
    }

    let rows = safeArr(stats.rows);
    const total = Number(stats.total) || 0;

    // 2) 소재 메타(이름) 취득: /api/_naver/ads?ids=...
    const ids = rows.map((r) => r.id).filter(Boolean);
    const metaMap = await fetchAdsMetaMap(ids);

    // 3) 이름 주입
    rows = rows.map((r) => ({
      ...r,
      name: metaMap.get(r.id)?.name || r.name || r.id, // 메타 이름 우선
    }));

    // (선택) 정렬 유지
    rows.sort((a, b) => (b?.salesAmt || 0) - (a?.salesAmt || 0));

    return Response.json({ start, end, total, rows });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
    });
  }
}

/**
 * 소재 메타 조회
 * 내부 프록시: GET /api/_naver/ads?ids=ID1,ID2,...
 *  - 실제 네이버 SearchAd의 GET /ncc/ads?ids=... 를 감싼 라우트라고 가정
 */
async function fetchAdsMetaMap(ids) {
  const map = new Map();
  if (!ids.length) return map;

  const chunkSize = 80;           // 너무 크게 보내면 400/429 유발 가능
  const interDelayMs = 300;       // 호출 간 짧은 대기(429 완화)

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const qs = toQS({ ids: chunk.join(",") });

    const res = await fetch(`/api/_naver/ads?${qs}`, {
      headers: { "x-internal": "1" },
    });
    const data = await res.json();
    if (res.ok && Array.isArray(data)) {
      for (const a of data) {
        const id = a.nccAdId || a.id;
        if (!id) continue;
        map.set(id, { name: a.name || a.adName || null });
      }
    }
    await sleep(interDelayMs);
  }

  return map;
}
