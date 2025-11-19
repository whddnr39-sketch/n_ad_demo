import crypto from "crypto";

// ======================= 공통 유틸 =======================

// HMAC 서명 생성 (네이버 검색광고 포맷)
function generateSignature(timestamp, method, path) {
  const secret = process.env.NAVER_SECRET_KEY;
  const message = `${timestamp}.${method}.${path}`;
  return crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("base64");
}

// 네이버 API 호출 헬퍼 (stat / master 공용)
async function callNaverAPI(method, path, body) {
  const timestamp = Date.now().toString();
  const signature = generateSignature(timestamp, method, path);

  const headers = {
    "X-Timestamp": timestamp,
    "X-API-KEY": process.env.NAVER_API_KEY,
    "X-Customer": process.env.NAVER_CUSTOMER_ID,
    "X-Signature": signature,
    "Content-Type": "application/json",
  };

  const res = await fetch(`https://api.naver.com${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`NAVER API Error (${path}) → status ${res.status}, body: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`NAVER API JSON parse error (${path}) → body: ${text}`);
  }
}

// ======================= 상태 폴링 (STAT / MASTER) =======================

async function waitUntilBuiltStat(jobId) {
  const path = `/stat-reports/${jobId}`;

  while (true) {
    const timestamp = Date.now().toString();
    const signature = generateSignature(timestamp, "GET", path);

    const res = await fetch(`https://api.naver.com${path}`, {
      method: "GET",
      headers: {
        "X-Timestamp": timestamp,
        "X-API-KEY": process.env.NAVER_API_KEY,
        "X-Customer": process.env.NAVER_CUSTOMER_ID,
        "X-Signature": signature,
      },
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error(
        `NAVER STAT status Error (${path}) → status ${res.status}, body: ${text}`
      );
    }

    if (!text.trim()) {
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(
        `NAVER STAT status JSON parse error (${path}) → body: ${text}`
      );
    }

    if (json.status === "BUILT" || json.status === "COMPLETED") {
      return json.downloadUrl;
    }

    await new Promise((r) => setTimeout(r, 1200));
  }
}

async function waitUntilBuiltMaster(jobId) {
  const path = `/master-reports/${jobId}`;
  let attempt = 0;
  const MAX_ATTEMPTS = 60; // 대략 1분 정도

  while (true) {
    attempt += 1;

    const timestamp = Date.now().toString();
    const signature = generateSignature(timestamp, "GET", path);

    const res = await fetch(`https://api.naver.com${path}`, {
      method: "GET",
      headers: {
        "X-Timestamp": timestamp,
        "X-API-KEY": process.env.NAVER_API_KEY,
        "X-Customer": process.env.NAVER_CUSTOMER_ID,
        "X-Signature": signature,
      },
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error(
        `NAVER MASTER status Error (${path}) → status ${res.status}, body: ${text}`
      );
    }

    if (!text.trim()) {
      if (attempt >= MAX_ATTEMPTS) {
        throw new Error(
          `NAVER MASTER status timeout (empty body). jobId=${jobId}, attempts=${attempt}`
        );
      }
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(
        `NAVER MASTER status JSON parse error (${path}) → body: ${text}`
      );
    }

    if (json.status === "BUILT" || json.status === "COMPLETED") {
      return json.downloadUrl;
    }

    if (attempt >= MAX_ATTEMPTS) {
      throw new Error(
        `NAVER MASTER status timeout (not BUILT). jobId=${jobId}, status=${json.status}, attempts=${attempt}`
      );
    }

    await new Promise((r) => setTimeout(r, 1200));
  }
}

// ======================= TSV 다운로드 =======================

async function downloadTSV(url) {
  const uri = new URL(url);
  const path = uri.pathname; // "/report-download"만 서명에 사용

  const timestamp = Date.now().toString();
  const signature = generateSignature(timestamp, "GET", path);

  const headers = {
    "X-Timestamp": timestamp,
    "X-API-KEY": process.env.NAVER_API_KEY,
    "X-Customer": process.env.NAVER_CUSTOMER_ID,
    "X-Signature": signature,
  };

  const res = await fetch(url, { method: "GET", headers });
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`TSV Download Error → status ${res.status}, body: ${text}`);
  }

  if (!text.trim()) return [];

  return text
    .trim()
    .split("\n")
    .map((line) => line.split("\t"));
}

// ======================= 날짜 범위 유틸 =======================

function getDateRange(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  const out = [];

  while (s <= e) {
    const y = s.getFullYear();
    const m = String(s.getMonth() + 1).padStart(2, "0");
    const d = String(s.getDate()).padStart(2, "0");
    out.push(`${y}${m}${d}`); // YYYYMMDD
    s.setDate(s.getDate() + 1);
  }
  return out;
}

// ======================= STAT 집계 로직 (adId 기준 SUM) =======================

function aggregateRow(map, cols, type) {
  // AD / AD_CONVERSION 공통 인덱스:
  // 0: 날짜
  // 2: campaignId
  // 5: adId
  const adId = cols[5];
  if (!adId) return;

  const campaignId = cols[2];

  if (!map.has(adId)) {
    map.set(adId, {
      adId,
      campaignId,
      imp: 0,
      clk: 0,
      cost: 0,
      convCnt: 0,
      convAmt: 0,
    });
  }

  const obj = map.get(adId);
  obj.campaignId = campaignId;

  if (type === "AD") {
    // 네 TSV 샘플 기준:
    // 9:  노출수
    // 10: 클릭수
    // 11: 비용(VAT 제외)
    obj.imp += Number(cols[9] || 0);
    obj.clk += Number(cols[10] || 0);

    // VAT 포함(10% 추가) → 1.1배
    obj.cost += Number(cols[11] || 0) * 1.1;
  } else if (type === "AD_CONVERSION") {
    // AD_CONVERSION 기준 (이전 검산 기준):
    // 11: 전환 수
    // 12: 전환 매출
    obj.convCnt += Number(cols[11] || 0);
    obj.convAmt += Number(cols[12] || 0);
  }
}

// 날짜 배열 + reportTp(AD/AD_CONVERSION)를 받아서 바로 Map에 합산
async function collectStatAgg(dates, reportTp) {
  const agg = new Map();

  for (const date of dates) {
    const job = await callNaverAPI("POST", "/stat-reports", {
      reportTp,
      statDt: date,
    });

    const downloadUrl = await waitUntilBuiltStat(job.reportJobId);
    const rows = await downloadTSV(downloadUrl);

    for (const cols of rows) {
      aggregateRow(agg, cols, reportTp);
    }
  }

  return agg;
}

// ======================= MASTER 매핑 (ShoppingProduct) =======================

// masterReport(ShoppingProduct) → adId → { adName, mallProductId }
function buildMasterMap(rows) {
  const map = new Map();

  for (const cols of rows) {
    // 스펙 기준:
    // 3. adId           → index 2
    // 6. 광고명         → index 5
    // 14. mallProductId → index 13
    const adId = cols[2];
    if (!adId) continue;

    const adName = cols[14] || null;
    const mallProductId = cols[13] || null;

    // 동일 adId 여러 번 나와도 마지막 값으로 덮어씀
    map.set(adId, { adName, mallProductId });
  }

  return map;
}

// ======================= MASTER 캐싱 =======================

let masterCacheMap = null;
let masterCacheUpdatedAt = 0;
const MASTER_CACHE_TTL = 24 * 60 * 60 * 1000; // 1일

async function getMasterMapCached(forceReload = false) {
  const now = Date.now();

  if (
    !forceReload &&
    masterCacheMap &&
    masterCacheUpdatedAt &&
    now - masterCacheUpdatedAt < MASTER_CACHE_TTL
  ) {
    return masterCacheMap;
  }

  // fromTime 없이 master-reports 생성
  const job = await callNaverAPI("POST", "/master-reports", {
    item: "ShoppingProduct",
  });

  // ❗ master-reports의 jobId는 id
  const jobId = job.id;
  if (!jobId) {
    throw new Error(
      `MASTER jobId(id)를 찾을 수 없습니다. 응답: ${JSON.stringify(job)}`
    );
  }

  const downloadUrl = await waitUntilBuiltMaster(jobId);
  const rows = await downloadTSV(downloadUrl);
  const map = buildMasterMap(rows);

  masterCacheMap = map;
  masterCacheUpdatedAt = now;

  return map;
}

// ======================= 메인 핸들러 =======================

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const start = searchParams.get("start"); // YYYY-MM-DD
    const end = searchParams.get("end");
    const forceMaster = searchParams.get("forceMaster") === "1";

    if (!start || !end) {
      return Response.json(
        { error: "start, end 쿼리 파라미터가 필요합니다." },
        { status: 400 }
      );
    }

    const dates = getDateRange(start, end);

    // ① STAT: AD / AD_CONVERSION 각각 기간 합산
    const adAgg = await collectStatAgg(dates, "AD");
    const convAgg = await collectStatAgg(dates, "AD_CONVERSION");

    // ② MASTER: ShoppingProduct 매핑 (캐시 사용)
    const masterMap = await getMasterMapCached(forceMaster);

    // ③ adId 기준으로 세 덩어리 조인
    const final = [];

    for (const [adId, base] of adAgg.entries()) {
      const conv = convAgg.get(adId) || { convCnt: 0, convAmt: 0 };
      const mapping = masterMap.get(adId) || {};

      final.push({
        adId,
        campaignId: base.campaignId || null,
        mallProductId: mapping.mallProductId || null,
        adName: mapping.adName || null,
        imp: base.imp,
        clk: base.clk,
        cost: base.cost,
        convCnt: conv.convCnt,
        convAmt: conv.convAmt,
      });
    }

    return Response.json(final);
  } catch (err) {
    console.error(err);
    return Response.json(
      { error: String(err.message || err) },
      { status: 500 }
    );
  }
}
