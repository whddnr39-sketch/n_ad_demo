import crypto from "crypto";

// ======================= 공통 유틸 =======================

// HMAC 서명 생성
function generateSignature(timestamp, method, path) {
  const secret = process.env.NAVER_SECRET_KEY;
  const message = `${timestamp}.${method}.${path}`;
  return crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("base64");
}

// 네이버 API 호출 헬퍼 (stat 전용)
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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NAVER API Error (${path}) → ${text}`);
  }

  return res.json();
}

// ======================= 상태 폴링 (stat-reports만) =======================

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

// ======================= TSV 다운로드 =======================

async function downloadTSV(url) {
  const uri = new URL(url);
  const path = uri.pathname; // "/report-download" 만 서명에 사용

  const timestamp = Date.now().toString();
  const signature = generateSignature(timestamp, "GET", path);

  const headers = {
    "X-Timestamp": timestamp,
    "X-API-KEY": process.env.NAVER_API_KEY,
    "X-Customer": process.env.NAVER_CUSTOMER_ID,
    "X-Signature": signature,
  };

  const res = await fetch(url, { method: "GET", headers });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TSV Download Error → ${text}`);
  }

  const text = await res.text();

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

// ======================= 집계 로직 (adId 기준 SUM) =======================

// AD / AD_CONVERSION 한 줄씩 받아서 adId 기준으로 합산
function aggregateRow(map, cols, type) {
  const adId = cols[5];
  if (!adId) return;

  const campaignId = cols[2];  // ← 추가된 부분

  if (!map.has(adId)) {
    map.set(adId, {
      adId,
      campaignId,   // ← 여기 저장
      imp: 0,
      clk: 0,
      cost: 0,
      convCnt: 0,
      convAmt: 0,
    });
  }

  const obj = map.get(adId);

  // campaignId 계속 갱신 (여러 날짜라도 동일함)
  obj.campaignId = campaignId;

  if (type === "AD") {
    obj.imp += Number(cols[9] || 0);    // 노출
    obj.clk += Number(cols[10] || 0);   // 클릭

    // cost(VAT 포함 = 1.1배)
    obj.cost += Number(cols[11] || 0) * 1.1;
  } 
  else if (type === "AD_CONVERSION") {

    obj.convCnt += Number(cols[11] || 0); // 전환 수
    obj.convAmt += Number(cols[12] || 0); // 전환 매출
  }
}

// 날짜 배열 + reportTp(AD/AD_CONVERSION)를 받아서 바로 Map에 합산
async function collectStatAgg(dates, reportTp) {
  const agg = new Map();

  for (const date of dates) {
    // 1) 보고서 생성
    const job = await callNaverAPI("POST", "/stat-reports", {
      reportTp,
      statDt: date,
    });

    // 2) BUILT 될 때까지 폴링
    const url = await waitUntilBuiltStat(job.reportJobId);

    // 3) TSV 다운로드
    const rows = await downloadTSV(url);

    // 4) 행 단위 합산
    for (const cols of rows) {
      aggregateRow(agg, cols, reportTp);
    }
  }

  return agg;
}

// ======================= 메인 핸들러 =======================

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const start = searchParams.get("start"); // YYYY-MM-DD
    const end = searchParams.get("end");

    if (!start || !end) {
      return Response.json(
        { error: "start, end 쿼리 파라미터가 필요합니다." },
        { status: 400 }
      );
    }

    const dates = getDateRange(start, end);

    // ① AD / AD_CONVERSION 각각 기간 합산
    const adAgg = await collectStatAgg(dates, "AD");
    const convAgg = await collectStatAgg(dates, "AD_CONVERSION");

    // ② adId 기준으로 두 Map을 합쳐서 최종 결과 만들기
    const final = [];

    for (const [adId, base] of adAgg.entries()) {
      const conv = convAgg.get(adId) || { convCnt: 0, convAmt: 0 };

      final.push({
        adId,
        campaignId: base.campaignId,   // ← 추가
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
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
