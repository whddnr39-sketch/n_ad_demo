"use client";
import { useEffect, useMemo, useState } from "react";

// KRW 포맷
const fmtKRW = (n) => `₩${Math.round(Number(n) || 0).toLocaleString("ko-KR")}`;

// 기본값: 어제 (KST)
function kstYesterdayDash() {
  const now = new Date();
  const kstMs = now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60_000;
  const y = new Date(kstMs - 24 * 60 * 60 * 1000);
  const yyyy = y.getUTCFullYear();
  const mm = String(y.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(y.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function Page() {
  const yday = useMemo(() => kstYesterdayDash(), []);
  const [start, setStart] = useState(yday);
  const [end, setEnd] = useState(yday);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState("");

  // 최초 진입 시 어제 하루 조회
  useEffect(() => {
    query();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function query() {
    setErr("");
    if (!start || !end) {
      setErr("날짜를 선택해주세요.");
      return;
    }
    const url = `/api/spend?start=${start}&end=${end}`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) throw new Error(d.error);
        setTotal(d?.total || 0);
      })
      .catch((e) => setErr(String(e?.message || e)));
  }

  // 스타일 (간결 카드 스타일)
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
    width: "min(720px, 92vw)",
    background: "#0f172a",
    border: "1px solid #1f2940",
    borderRadius: 20,
    padding: 24,
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
  };
  const box = { background: "#111827", border: "1px solid #1f2937", borderRadius: 16, padding: 20 };
  const label = { fontSize: 12, color: "#9ca3af", marginBottom: 6 };

  return (
    <div style={page}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700 }}>광고비 합계</h1>
          <span style={{ fontSize: 12, color: "#93a3b8" }}>KST 기준</span>
        </div>

        {/* 기간 선택 */}
        <div style={{ ...box, marginBottom: 16 }}>
          <div style={{ ...label }}>기간 선택</div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div style={label}>시작일</div>
              <input
                type="date"
                value={start}
                max={end}
                onChange={(e) => setStart(e.target.value)}
                style={{
                  background: "#0b1020",
                  color: "#e5e7eb",
                  border: "1px solid #27324a",
                  borderRadius: 10,
                  padding: "10px 12px",
                  fontSize: 14,
                }}
              />
            </div>

            <div>
              <div style={label}>종료일</div>
              <input
                type="date"
                value={end}
                min={start}
                onChange={(e) => setEnd(e.target.value)}
                style={{
                  background: "#0b1020",
                  color: "#e5e7eb",
                  border: "1px solid #27324a",
                  borderRadius: 10,
                  padding: "10px 12px",
                  fontSize: 14,
                }}
              />
            </div>

            <button
              onClick={query}
              style={{
                marginTop: 20,
                height: 40,
                padding: "0 16px",
                background: "#1f2937",
                border: "1px solid #2b3a55",
                borderRadius: 10,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              조회
            </button>
          </div>
        </div>

        {/* 합계 */}
        <div style={box}>
          <div style={label}>기간 합계</div>
          <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.1 }}>{fmtKRW(total)}</div>
        </div>

        {err ? (
          <div style={{ marginTop: 12, fontSize: 12, color: "#fca5a5" }}>* {err}</div>
        ) : null}
      </div>
    </div>
  );
}
