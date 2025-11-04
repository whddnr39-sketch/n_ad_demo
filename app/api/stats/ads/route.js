import crypto from "crypto";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const adgroupId = searchParams.get("adgroupId");
  const campaignId = searchParams.get("campaignId");

  if (!start || !end) {
    return Response.json({ error: "start and end are required" }, { status: 400 });
  }

  const API_KEY = process.env.API_KEY || process.env.NAVER_API_KEY;
  const SECRET_KEY = process.env.SECRET_KEY || process.env.NAVER_SECRET_KEY;
  const CUSTOMER_ID = process.env.CUSTOMER_ID || process.env.NAVER_CUSTOMER_ID;
  const BASE_URL = "https://api.searchad.naver.com";
  const ts = Date.now().toString();

  function makeSignature(ts, method, path) {
    const msg = `${ts}.${method}.${path}`;
    return crypto.createHmac("sha256", SECRET_KEY).update(msg).digest("base64");
  }

  const headers = (path) => ({
    "X-Timestamp": ts,
    "X-API-KEY": API_KEY,
    "X-Customer": CUSTOMER_ID,
    "X-Signature": makeSignature(ts, "GET", path),
  });

  // 1️⃣ 광고그룹 목록 조회
  const adgroupPath = "/ncc/adgroups";
  const adgroupUrl = campaignId
    ? `${BASE_URL}${adgroupPath}?nccCampaignId=${campaignId}`
    : adgroupId
    ? `${BASE_URL}${adgroupPath}?nccAdgroupId=${adgroupId}`
    : `${BASE_URL}${adgroupPath}`;

  const adgroupsRes = await fetch(adgroupUrl, { headers: headers(adgroupPath) });
  const adgroups = await adgroupsRes.json();

  // 2️⃣ 소재 목록 조회
  const adPath = "/ncc/ads";
  const adsPromises = adgroups.map((g) =>
    fetch(`${BASE_URL}${adPath}?nccAdgroupId=${g.nccAdgroupId}`, {
      headers: headers(adPath),
    }).then((r) => r.json())
  );
  const adsArrays = await Promise.all(adsPromises);
  const ads = adsArrays.flat();

  // 3️⃣ 통계 조회 및 병합
  const statsPath = "/stats";
  const statsPromises = ads.map((a) =>
    fetch(
      `${BASE_URL}${statsPath}?id=${a.nccAdId}&fields=[impCnt,clkCnt,salesAmt,ctr,cpc,avgRnk]&timeRange={\"since\":\"${start}\",\"until\":\"${end}\"}`,
      { headers: headers(statsPath) }
    ).then(async (res) => ({
      id: a.nccAdId,
      ad: a,
      data: await res.json(),
    }))
  );

  const stats = await Promise.all(statsPromises);

  const rows = stats.map(({ id, ad, data }) => {
    const s = data?.data?.[0] || {};
    const ref = ad.referenceData || {};
    return {
      id,
      nccAdId: ad.nccAdId,
      impCnt: s.impCnt || 0,
      clkCnt: s.clkCnt || 0,
      salesAmt: s.salesAmt || 0,
      ctr: s.ctr || 0,
      cpc: s.cpc || 0,
      avgRnk: s.avgRnk || 0,
      bidAmt: ad.adAttr?.bidAmt ?? null,
      mallProductId: ref.mallProductId ?? null,
      imageUrl: ref.imageUrl ?? null,
      productName: ref.productName ?? null,
    };
  });

  const total = rows.reduce((sum, r) => sum + (r.salesAmt || 0), 0);

  return Response.json({ start, end, total, rows });
}
