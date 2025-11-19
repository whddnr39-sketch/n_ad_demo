import crypto from "crypto";

// ======================= 공통 유틸 =======================

function logStep(...args) {
  const ts = new Date().toISOString();
  console.log("[MASTER]", ts, ...args);
}

// HMAC 서명 생성
function generateSignature(timestamp, method, path) {
  const secret = process.env.NAVER_SECRET_KEY;
  const message = `${timestamp}.${method}.${path}`;
  return crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("base64");
}

// 네이버 API 호출 헬퍼
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

  logStep("callNaverAPI START", method, path, "body:", body || null);

  const res = await fetch(`https://api.naver.com${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();

  logStep("callNaverAPI END", method, path, "status:", res.status);

  if (!res.ok) {
    throw new Error(`NAVER API Error (${path}) → status ${res.status}, body: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`NAVER API JSON parse error (${path}) → body: ${text}`);
  }
}

// ======================= 상태 폴링 (MASTER) =======================

async function waitUntilBuiltMaster(jobId) {
  const path = `/master-reports/${jobId}`;
  let attempt = 0;
  const MAX_ATTEMPTS = 60; // 대략 60 * 1.2초 ≒ 1분 정도

  logStep("waitUntilBuiltMaster START", { jobId });

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

    logStep("POLL", { jobId, attempt, statusCode: res.status, bodyPreview: text.slice(0, 80) });

    if (!res.ok) {
      throw new Error(
        `NAVER MASTER status Error (${path}) → status ${res.status}, body: ${text}`
      );
    }

    if (!text.trim()) {
      // 빈 응답이면 아직 준비 안 된 걸로 보고 재시도
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

    logStep("POLL JSON", {
      jobId,
      attempt,
      status: json.status,
      hasDownloadUrl: !!json.downloadUrl,
    });

    if (json.status === "BUILT" || json.status === "COMPLETED") {
      logStep("waitUntilBuiltMaster DONE", { jobId, attempt });
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
  const path = uri.pathname; // "/report-download"

  const timestamp = Date.now().toString();
  const signature = generateSignature(timestamp, "GET", path);

  logStep("downloadTSV START", { url });

  const headers = {
    "X-Timestamp": timestamp,
    "X-API-KEY": process.env.NAVER_API_KEY,
    "X-Customer": process.env.NAVER_CUSTOMER_ID,
    "X-Signature": signature,
  };

  const res = await fetch(url, { method: "GET", headers });
  const text = await res.text();

  logStep("downloadTSV END", {
    status: res.status,
    length: text.length,
    preview: text.slice(0, 80),
  });

  if (!res.ok) {
    throw new Error(`TSV Download Error → status ${res.status}, body: ${text}`);
  }

  if (!text.trim()) return [];

  const rows = text
    .trim()
    .split("\n")
    .map((line) => line.split("\t"));

  logStep("downloadTSV PARSED", { rowCount: rows.length });

  return rows;
}

// ======================= MASTER 매핑 로직 =======================

function buildMasterList(rows) {
  const map = new Map();

  for (const cols of rows) {
    // 3. adId           → index 2
    // 6. 광고명         → index 5
    // 14. mallProductId → index 13
    const adId = cols[2];
    if (!adId) continue;

    const adName = cols[5] || null;
    const mallProductId = cols[13] || null;

    map.set(adId, { adId, adName, mallProductId });
  }

  const list = Array.from(map.values());
  logStep("buildMasterList DONE", { uniqueAdCount: list.length });

  return list;
}

// ======================= 캐싱 =======================

let masterCache = null;
let masterCacheUpdatedAt = 0;
const MASTER_CACHE_TTL = 24 * 60 * 60 * 1000; // 1일

async function getMasterListCached(forceReload = false) {
  const now = Date.now();

  if (
    !forceReload &&
    masterCache &&
    masterCacheUpdatedAt &&
    now - masterCacheUpdatedAt < MASTER_CACHE_TTL
  ) {
    logStep("CACHE HIT", {
      ageMs: now - masterCacheUpdatedAt,
      length: masterCache.length,
    });
    return masterCache;
  }

  logStep("CACHE MISS → 요청 시작", { forceReload });

  const job = await callNaverAPI("POST", "/master-reports", {
    item: "ShoppingProduct", // fromTime 없음
  });

  logStep("MASTER REPORT CREATED", {
    reportJobId: job.id,
    status: job.status,
  });

  const downloadUrl = await waitUntilBuiltMaster(job.id);
  logStep("MASTER DOWNLOAD URL READY", { downloadUrl });

  const rows = await downloadTSV(downloadUrl);
  const list = buildMasterList(rows);

  masterCache = list;
  masterCacheUpdatedAt = now;

  logStep("CACHE UPDATED", { length: list.length });

  return list;
}

// ======================= 핸들러 =======================

export async function GET(req) {
  const t0 = Date.now();
  logStep("GET /api/naver/master-shopping START");

  try {
    const { searchParams } = new URL(req.url);
    const force = searchParams.get("force") === "1";

    const list = await getMasterListCached(force);

    const elapsed = Date.now() - t0;
    logStep("GET /api/naver/master-shopping DONE", {
      count: list.length,
      elapsedMs: elapsed,
    });

    return Response.json(list);
  } catch (err) {
    const elapsed = Date.now() - t0;
    logStep("GET /api/naver/master-shopping ERROR", {
      elapsedMs: elapsed,
      error: String(err.message || err),
    });

    return Response.json(
      { error: String(err.message || err) },
      { status: 500 }
    );
  }
}
