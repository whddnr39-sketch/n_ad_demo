"use client";

import { useEffect, useMemo, useState } from "react";

/* ---------------- 유틸 ---------------- */
const fmtKRW = (n) => `₩${Math.round(Number(n) || 0).toLocaleString("ko-KR")}`;
const pct = (v) => (Number.isFinite(v) ? `${(v * 1).toFixed(2)}%` : "-");
const num = (v) => (Number.isFinite(v) ? Number(v).toLocaleString("ko-KR") : "-");

/** KST yyyy-mm-dd */
function fmtDate(d) {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function kstNow() {
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60000);
  return kst;
}
function kstYesterday() {
  const d = kstNow();
  d.setDate(d.getDate() - 1);
  return d;
}

/* ---------------- 메인 컴포넌트 ---------------- */
export default function Page() {
  // 조회 단위
  const [level, setLevel] = useState("campaign"); // "campaign" | "adgroup" | "ad"

  // 날짜
  const [start, setStart] = useState(fmtDate(kstYesterday()));
  const [end, setEnd] = useState(fmtDate(kstYesterday()));

  // 선택값
  const [campaignId, setCampaignId] = useState("");
  const [adgroupId, setAdgroupId] = useState("");

  // 데이터
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);

  // 옵션(캠페인/그룹)
  const [campaigns, setCampaigns] = useState([]);
  const [adgroups, setAdgroups] = useState([]);

  // 상태
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  /* ---- 초기 캠페인 목록 ---- */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/campaigns", { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setCampaigns(data || []);
      } catch (e) {
        console.error(e);
        setErr("캠페인 목록을 불러오지 못했습니다.");
      }
    })();
  }, []);

  /* ---- 캠페인 선택 시 그룹 목록 ---- */
  useEffect(() => {
    setAdgroupId("");
    if (!campaignId) {
      setAdgroups([]);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/adgroups?campaignId=${encodeURIComponent(campaignId)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setAdgroups(data || []);
      } catch (e) {
        console.error(e);
        setErr("광고그룹 목록을 불러오지 못했습니다.");
      }
    })();
  }, [campaignId]);

  /* ---- 프리셋 ---- */
  const applyPreset = (key) => {
    const today = kstNow();
    const yest = kstYesterday();
    if (key === "yesterday") {
      const d = fmtDate(yest);
      setStart(d);
      setEnd(d);
    } else if (key === "last7") {
      const s = new Date(yest);
      s.setDate(s.getDate() - 6);
      setStart(fmtDate(s));
      setEnd(fmtDate(yest));
    } else if (key === "last30") {
      const s = new Date(yest);
      s.setDate(s.getDate() - 29);
      setStart(fmtDate(s));
      setEnd(fmtDate(yest));
    } else if (key === "today") {
      const d = fmtDate(today);
      setStart(d);
      setEnd(d);
    }
  };

  /* ---- 조회 ---- */
  const fetchData = async () => {
    setLoading(true);
    setErr("");
    try {
      // 엔드포인트 & 쿼리 구성
      let path = "/api/stats/campaigns";
      const qs = new URLSearchParams();
      qs.set("start", start);
      qs.set("end", end);

      if (level === "adgroup") {
        path = "/api/stats/adgroups";
        if (campaignId) qs.set("campaignId", campaignId);
      } else if (level === "ad") {
        path = "/api/stats/ads";
        if (adgroupId) qs.set("adgroupId", adgroupId);
        else if (campaignId) qs.set("campaignId", campaignId); // 캠페인 전체의 소재까지 허용
      }

      const url = `${path}?${qs.toString()}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      setRows(Array.isArray(data.rows) ? data.rows : []);
      setTotal(Number(data.total) || 0);
    } catch (e) {
      console.error(e);
      setErr("데이터 조회 중 오류가 발생했습니다.");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  /* ---- 테이블 컬럼 정의 ---- */
  const headers = useMemo(() => {
    const firstLabel = level === "ad" ? "소재명" : "이름";
    return [firstLabel, "노출", "클릭", "CTR", "CPC", "평균순위", "비용"];
  }, [level]);

  return (
    <div style={{ maxWidth: 1100, margin: "40px auto", padding: "0 16px", color: "#e5e7eb" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>네이버 광고비 조회 데모</h1>

      {/* 컨트롤 패널 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 12,
          background: "#0b1020",
          border: "1px solid #1f2937",
          borderRadius: 12,
          padding: 16,
          marginBottom: 18,
        }}
      >
        {/* 레벨 선택 */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ width: 72, color: "#9ca3af" }}>레벨</label>
          {[
            { key: "campaign", label: "캠페인" },
            { key: "adgroup", label: "광고그룹" },
            { key: "ad", label: "소재" },
          ].map((opt) => (
            <button
              key={opt.key}
              onClick={() => setLevel(opt.key)}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #1f2937",
                background: level === opt.key ? "#172554" : "#0f172a",
                color: level === opt.key ? "#dbeafe" : "#e5e7eb",
                cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* 날짜 */}
        <div style={{ display: "grid", gridTemplateColumns: "72px 1fr 1fr", gap: 8, alignItems: "center" }}>
          <label style={{ color: "#9ca3af" }}>날짜</label>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            style={{ background: "#111827", color: "#e5e7eb", border: "1px solid #1f2937", borderRadius: 8, padding: "6px 8px" }}
          />
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            style={{ background: "#111827", color: "#e5e7eb", border: "1px solid #1f2937", borderRadius: 8, padding: "6px 8px" }}
          />
        </div>

        {/* 프리셋 */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ width: 72, color: "#9ca3af" }}>프리셋</label>
          {[
            { k: "yesterday", t: "어제" },
            { k: "today", t: "오늘" },
            { k: "last7", t: "최근 7일" },
            { k: "last30", t: "최근 30일" },
          ].map((p) => (
            <button
              key={p.k}
              onClick={() => applyPreset(p.k)}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #1f2937",
                background: "#0f172a",
                color: "#e5e7eb",
                cursor: "pointer",
              }}
            >
              {p.t}
            </button>
          ))}
        </div>

        {/* 캠페인 / 광고그룹 선택 */}
        <div style={{ display: "grid", gridTemplateColumns: "72px 1fr 1fr", gap: 8, alignItems: "center" }}>
          <label style={{ color: "#9ca3af" }}>선택</label>
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            style={{ background: "#111827", color: "#e5e7eb", border: "1px solid #1f2937", borderRadius: 8, padding: "6px 8px" }}
          >
            <option value="">(전체 캠페인)</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name || c.id}</option>
            ))}
          </select>

          <select
            value={adgroupId}
            onChange={(e) => setAdgroupId(e.target.value)}
            disabled={!campaignId}
            style={{
              background: "#111827",
              color: campaignId ? "#e5e7eb" : "#6b7280",
              border: "1px solid #1f2937",
              borderRadius: 8,
              padding: "6px 8px",
            }}
          >
            <option value="">(전체 그룹)</option>
            {adgroups.map((g) => (
              <option key={g.id} value={g.id}>{g.name || g.id}</option>
            ))}
          </select>
        </div>

        {/* 조회 버튼 */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={fetchData}
            disabled={loading}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              background: loading ? "#1f2937" : "#2563eb",
              color: "#fff",
              border: "none",
              cursor: loading ? "default" : "pointer",
              fontWeight: 600,
              minWidth: 100,
            }}
          >
            {loading ? "조회 중..." : "조회"}
          </button>
        </div>
      </div>

      {/* 에러 영역 */}
      {err && (
        <div style={{ background: "#3f1d1d", border: "1px solid #7f1d1d", color: "#fecaca", padding: 12, borderRadius: 10, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {/* 합계 */}
      <div style={{ margin: "8px 0 12px", color: "#9ca3af" }}>
        총 비용: <b style={{ color: "#e5e7eb" }}>{fmtKRW(total)}</b>
      </div>

      {/* 테이블 */}
      <div style={{ overflowX: "auto", border: "1px solid #1f2937", borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", background: "#0b1020" }}>
              {headers.map((h) => (
                <th key={h} style={{ padding: "10px 8px", borderBottom: "1px solid #1f2937" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ padding: "8px", borderBottom: "1px solid #1f2937" }}>
                  {/* ✅ 소재 레벨일 때는 name 없으면 id로 대체 */}
                  {level === "ad" ? (r.name || r.id) : r.name}
                </td>
                <td style={{ padding: "8px", borderBottom: "1px solid #1f2937" }}>{num(r.impCnt)}</td>
                <td style={{ padding: "8px", borderBottom: "1px solid #1f2937" }}>{num(r.clkCnt)}</td>
                <td style={{ padding: "8px", borderBottom: "1px solid #1f2937" }}>{pct(r.ctr)}</td>
                <td style={{ padding: "8px", borderBottom: "1px solid #1f2937" }}>{num(r.cpc)}</td>
                <td style={{ padding: "8px", borderBottom: "1px solid #1f2937" }}>{num(r.avgRnk)}</td>
                <td style={{ padding: "8px", borderBottom: "1px solid #1f2937", textAlign: "right" }}>{fmtKRW(r.salesAmt)}</td>
              </tr>
            ))}

            {!rows.length && !loading && (
              <tr>
                <td colSpan={7} style={{ padding: "14px", color: "#9ca3af", textAlign: "center" }}>
                  데이터가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 10, color: "#6b7280", fontSize: 12 }}>
        * 소재 레벨 조회 시 표 첫 열에 <b>소재명</b>이 표시됩니다. (이미지는 추후 리포트 썸네일 URL 연동 시 추가)
      </p>
    </div>
  );
}
