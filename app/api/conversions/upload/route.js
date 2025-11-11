export const runtime = "nodejs";

import * as XLSX from "xlsx";

/** 숫자 변환: "123,456원" / "  55,900 " / 55900 -> 55900 */
function toNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[^\d.-]/g, "").trim();
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Excel serial(날짜) → Date (KST 자정 비교용으로 UTC 자정 문자열을 뽑아 쓸 것) */
function excelSerialToDate(serial) {
  // Excel epoch: 1899-12-30 (leap bug 고려치)
  const utcDays = Math.floor(serial - 25569); // 25569 = days between 1899-12-30 and 1970-01-01
  const utcValue = utcDays * 86400 * 1000;
  const frac = serial - Math.floor(serial);
  const utcTime = Math.round(frac * 86400 * 1000);
  return new Date(utcValue + utcTime);
}

/** 셀 값을 Date로 최대한 보정해서 반환 (유효하지 않으면 null) */
function toDate(v) {
  if (!v && v !== 0) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return excelSerialToDate(v);
  const s = String(v).trim();
  // 허용 포맷: YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD 등
  const norm = s.replace(/[./]/g, "-");
  const d = new Date(norm);
  return isNaN(d.getTime()) ? null : d;
}

/** YYYY-MM-DD 문자열로 고정 (UTC 자정 기준) */
function ymdUTC(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** 주어진 날짜가 [start,end] (YYYY-MM-DD, KST) 범위에 포함되는지 체크 */
function inRangeKST(dateObj, startStr, endStr) {
  // 비교 단위를 날짜(일)로만 보고, 문자열 비교 단순화 위해 UTC 자정으로 변환
  const dYmd = ymdUTC(dateObj);
  return dYmd >= startStr && dYmd <= endStr;
}

export async function POST(req) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const start = (form.get("start") || "").trim(); // YYYY-MM-DD
    const end = (form.get("end") || "").trim();     // YYYY-MM-DD

    if (!file || typeof file.arrayBuffer !== "function") {
      return new Response(JSON.stringify({ error: "file(xlsx) 파트를 첨부하세요." }), { status: 400 });
    }
    if (!start || !end) {
      return new Response(JSON.stringify({ error: "start/end(YYYY-MM-DD) 파라미터가 필요합니다." }), { status: 400 });
    }

    // 파일 읽기
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    if (!wb.SheetNames?.length) {
      return new Response(JSON.stringify({ error: "시트가 비어있습니다." }), { status: 400 });
    }

    // 첫 시트만 사용
    const ws = wb.Sheets[wb.SheetNames[0]];
    // defval: 빈 셀도 누락되지 않도록, raw: true 로 원시값 유지(숫자/일자 보정은 우리가 처리)
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });

    // 컬럼 이름(헤더) 기대치
    // 날짜: "결제 일 2"
    // 전환 매출: "결제한 금액(실제 결제한 금액)"
    // 전환 수: count 로 계산 (행 수)
    // 매칭 키: "yg_method"
    // 전제: "yg_type" 에 "*naver_s*" 포함
    const COL_DATE = "결제 일 2";
    const COL_AMT = "결제한 금액(실제 결제한 금액)";
    const COL_YG_METHOD = "yg_method";
    const COL_YG_TYPE = "yg_type";

    const byMallProductId = {};
    let totalCcnt = 0;
    let totalConvAmt = 0;

    for (const r of rows) {
      // 전제조건: yg_type 에 naver_s 포함
      const ygType = (r[COL_YG_TYPE] ?? "").toString();
      if (!ygType || ygType.indexOf("naver_s") === -1) continue;

      // 날짜 필터
      const d = toDate(r[COL_DATE]);
      if (!d) continue;
      if (!inRangeKST(d, start, end)) continue;

      // 키 추출
      const mallProductId = (r[COL_YG_METHOD] ?? "").toString().trim();
      if (!mallProductId) continue;

      // 금액
      const amt = toNumber(r[COL_AMT]);

      if (!byMallProductId[mallProductId]) {
        byMallProductId[mallProductId] = { ccnt: 0, convAmt: 0 };
      }
      byMallProductId[mallProductId].ccnt += 1;       // 전환 수: 행 건수 count
      byMallProductId[mallProductId].convAmt += amt;  // 전환 매출: 합계

      totalCcnt += 1;
      totalConvAmt += amt;
    }

    // 정수화
    for (const k of Object.keys(byMallProductId)) {
      byMallProductId[k].ccnt = Math.round(byMallProductId[k].ccnt);
      byMallProductId[k].convAmt = Math.round(byMallProductId[k].convAmt);
    }

    const body = {
      meta: { start, end, tz: "Asia/Seoul", sheet: wb.SheetNames[0] },
      byMallProductId,
      total: { ccnt: Math.round(totalCcnt), convAmt: Math.round(totalConvAmt) },
    };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500 });
  }
}
