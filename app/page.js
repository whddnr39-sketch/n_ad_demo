"use client";
import { useEffect, useState } from "react";

// 금액 포맷 (₩1,234,567)
const fmtKRW = (n) =>
  `₩${Math.round(Number(n) || 0).toLocaleString("ko-KR")}`;

export default function Page() {
  const [date, setDate] = useState("");     // 예: 2025-11-02 (API에서 제공)
  const [total, setTotal] = useState(0);    // 어제 합계 (API에서 제공)
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/spend")
      .then((r) => r.json())
      .then((d) => {
        setDate(d?.date || "");
        setTotal(d?.total || 0);
      })
      .catch((e) => setErr(String(e?.message || e)));
  }, []);

  // 아주 간결한 스타일
  const page = {
    minHeight: "100vh",
    background: "#0b0f1a",
    color: "#e5e7eb",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  };
  const card = {
    width: "min(560px, 92vw)",
    background: "#0f172a",
    border: "1px solid #1f2940",
    borderRadius: 20,
    padding: 24,
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
  };
  const label = { fontSize: 12, color: "#93a3b8" };

  return (
    <div style={page}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700 }}>어제자 광고비</h1>
          <span style={label}>KST 기준</span>
        </div>

        <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 16, padding: 20, marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>일자</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{date || "-"}</div>
        </div>

        <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 16, padding: 20 }}>
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>광고비 (합계)</div>
          <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.1 }}>{fmtKRW(total)}</div>
        </div>

        {err ? (
          <div style={{ marginTop: 12, fontSize: 12, color: "#fca5a5" }}>
            * 데이터 로드 실패: {err}
          </div>
        ) : null}
      </div>
    </div>
  );
}
