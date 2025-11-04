"use client";
import { useEffect, useMemo, useState } from "react";

/* ---------- 유틸 ---------- */
const fmtKRW = (n) => `₩${Math.round(Number(n) || 0).toLocaleString("ko-KR")}`;
const pct = (v) => (Number.isFinite(v) ? `${(v * 1).toFixed(2)}%` : "-");
const num = (v) => (Number.isFinite(v) ? Number(v).toLocaleString("ko-KR") : "-");

function kstYesterdayDash() {
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60_000);
  const y = new Date(kst.getTime() - 24 * 60 * 60 * 1000);
  const yyyy = y.getUTCFullYear();
  const mm = String(y.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(y.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/* ---------- 페이지 ---------- */
export default function Page() {
  // 날짜
  const yday = useMemo(() => kstYesterdayDash(), []);
  const [start, setStart] = useState(yday);
  const [end, setEnd] = useState(yday);

  // 드롭다운 데이터
  const [campaigns, setCampaigns] = useState([]); // {id,name}
  const [adgroups, setAdgroups] = useState([]); // {id,name}
  const [selectedCampaign, setSelectedCampaign] = useState("");
  const [selectedAdgroup, setSelectedAdgroup] = useState("");

  // 조회 대상 레벨
  const [level, setLevel] = useState("campaign"); // "campaign" | "adgroup" | "ad"

  // 결과
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  /* 초기: 캠페인 목록 */
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/campaigns");
        const j = await r.json();
        const list = (j.campaigns || []).map((c) => ({ id: c.id, name: c.name }));
        setCampaigns(list);
      } catch (e) {
        console.error(e);
        setErr("캠페인 목록을 불러오지 못했습니다.");
      }
    })();
  }, []);

  /* 캠페인 선택 시: 그룹 목록 로드 & 그룹 선택 초기화 */
  useEffect(() => {
    (async () => {
      setAdgroups([]);
      setSelectedAdgroup("");
      if (!selectedCampaign) return;
      try {
        const r = await fetch(`/api/adgroups?campaignId=${encodeURIComponent(selectedCampaign)}`);
        const j = await r.json();
        const list = (j.adgroups || []).map((g) => ({ id: g.id, name: g.name }));
        setAdgroups(list);
      } catch (e) {
        console.error(e);
        setErr("광고그룹 목록을 불러오지 못했습니다.");
      }
    })();
  }, [selectedCampaign]);

  const presets = [
    { label: "어제", range: () => ({ s: yday, e: yday }) },
    {
      label: "최근 7일",
      range: () => {
        const e = yday;
        const d = new Date(`${yday}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 6);
        const s = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
          d.getUTCDate()
        ).padStart(2, "0")}`;
        return { s, e };
      },
    },
    {
      label: "최근 30일",
      range: () => {
        const e = yday;
        const d = new Date(`${yday}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 29);
        const s = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
          d.getUTCDate()
        ).padStart(2, "0")}`;
        return { s, e };
      },
    },
  ];

  async function query() {
    try {
      setErr("");
      setLoading(true);
      let url = "";
      if (level === "campaign") {
        url = `/api/stats/campaigns?start=${start}&end=${end}`;
      } else if (level === "adgroup") {
        const qs = selectedCampaign ? `&campaignId=${encodeURIComponent(selectedCampaign)}` : "";
        url = `/api/stats/adgroups?start=${start}&end=${end}${qs}`;
      } else {
        const qs = selectedAdgroup
          ? `&adgroupId=${encodeURIComponent(selectedAdgroup)}`
          : selectedCampaign
          ? `&campaignId=${encodeURIComponent(selectedCampaign)}`
          : "";
        url = `/api/stats/ads?start=${start}&end=${end}${qs}`;
      }

      const r = await fetch(url);
      const j = await r.json();
      if (j.error) throw new Error(j.error);

      setRows(j.rows || []);
      setTotal(j.total || 0);
    } catch (e) {
      console.error(e);
      setErr(String(e?.message || e));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  /* ---------- 스타일 ---------- */
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
    width: "min(1040px, 95vw)",
    background: "#0f172a",
    border: "1px solid #1f2940",
    borderRadius: 20,
    padding: 24,
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
  };
  const box = { background: "#111827", border: "1px solid #1f2937", borderRadius: 16, padding: 16 };
  const label = { fontSize: 12, color: "#9ca3af", marginBottom: 6 };
  const row = { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" };
  const sel = {
    background: "#0b1020",
    color: "#e5e7eb",
    border: "1px solid #27324a",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 14,
  };
  const btn = {
    height: 40,
    padding: "0 16px",
    background: "#1f2937",
    border: "1px solid #2b3a55",
    borderRadius: 10,
    cursor: "pointer",
    fontWeight: 600,
  };
  const radioWrap = {
    display: "flex",
    gap: 8,
    padding: 6,
    background: "#0b1020",
    border: "1px solid #27324a",
    borderRadius: 10,
  };

  return (
    <div style={page}>
      <div style={card}>
        {/* 헤더 */}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700 }}>네이버 광고 집계 (캠페인 → 그룹 → 소재)</h1>
          <span style={{ fontSize: 12, color: "#93a3b8" }}>KST 기준</span>
        </div>

        {/* 컨트롤 바 */}
        <div style={{ ...box, marginBottom: 16 }}>
          <div style={label}>조회 조건</div>

          <div style={{ ...row, marginBottom: 10 }}>
            <div style={radioWrap}>
              {["campaign", "adgroup", "ad"].map((lv) => (
                <label
                  key={lv}
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
                >
                  <input
                    type="radio"
                    name="level"
                    value={lv}
                    checked={level === lv}
                    onChange={(e) => setLevel(e.target.value)}
                  />
                  {lv === "campaign" ? "캠페인" : lv === "adgroup" ? "그룹" : "소재"}
                </label>
              ))}
            </div>

            {/* 캠페인 */}
            <div>
              <div style={label}>캠페인</div>
              <select
                value={selectedCampaign}
                onChange={(e) => setSelectedCampaign(e.target.value)}
                style={{ ...sel, minWidth: 260 }}
              >
                <option value="">전체</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 그룹 */}
            <div>
              <div style={label}>그룹</div>
              <select
                value={selectedAdgroup}
                onChange={(e) => setSelectedAdgroup(e.target.value)}
                style={{ ...sel, minWidth: 220 }}
                disabled={!adgroups.length}
              >
                <option value="">{adgroups.length ? "전체" : "캠페인 선택 필요"}</option>
                {adgroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 날짜 */}
            <div>
              <div style={label}>시작일</div>
              <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} style={sel} />
            </div>
            <div>
              <div style={label}>종료일</div>
              <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} style={sel} />
            </div>

            {/* 프리셋 */}
            <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
              {presets.map((p) => (
                <button
                  key={p.label}
                  style={btn}
                  onClick={() => {
                    const { s, e } = p.range();
                    setStart(s);
                    setEnd(e);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "end" }}>
              <button style={{ ...btn, background: "#25436a" }} onClick={query}>
                {loading ? "조회 중…" : "조회"}
              </button>
            </div>
          </div>

          {!!err && <div style={{ fontSize: 12, color: "#fca5a5" }}>* {err}</div>}
        </div>

        {/* 합계 */}
        <div style={{ ...box, marginBottom: 16 }}>
          <div style={label}>기간 합계</div>
          <div style={{ fontSize: 36, fontWeight: 800 }}>{fmtKRW(total)}</div>
        </div>

        {/* 테이블 */}
        <div style={box}>
          <div style={label}>
            결과 {rows.length.toLocaleString("ko-KR")}건 {loading ? "(로딩…)" : ""}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", background: "#0b1020" }}>
                  {level === "ad" && (
                    <>
                      <th style={{ padding: "10px 8px", borderBottom: "1px solid #1f2937" }}>썸네일</th>
                      <th style={{ padding: "10px 8px", borderBottom: "1px solid #1f2937" }}>상품명</th>
                      <th style={{ padding: "10px 8px", borderBottom: "1px solid #1f2937" }}>몰상품ID</th>
                      <th style={{ padding: "10px 8px", borderBottom: "1px solid #1f2937", textAlign: "right" }}>입찰가</th>
                    </>
                  )}
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid #1f2937" }}>이름</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid #1f2937" }}>노출</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid #1f2937" }}>클릭</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid #1f2937" }}>CTR</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid #1f2937" }}>CPC</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid #1f2937" }}>평균순위</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid #1f2937", textAlign: "right" }}>비용</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    {level === "ad" && (
                      <>
                        <td style={{ padding: "8px", borderBottom: "1px solid #1f2937" }}>
                          {r.imageUrl ? (
                            <img
                              src={r.imageUrl}
                              alt="thumbnail"
                              width={60}
                              height={60}
                              style={{ borderRadius: 8, objectFit: "cover" }}
                            />
                          ) : (
                            "-"
                          )}
                        </td>
                        <td style={{ padding: "8px", borderBottom: "1px solid #1f2937" }}>
                          {r.productName || "-"}
                        </td>
                        <td style={{ padding: "8px", borderBottom: "1px solid #1f2937" }}>
                          {r.mallProductId || "-"}
                        </td>
                        <td style={{ padding: "8px", borderBottom: "1px solid #1f2937", textAlign: "right" }}>
                          {r.bidAmt ? num(r.bidAmt) : "-"}
                        </td>
                      </>
                    )}
                    <td style={{ padding: "8px", borderBottom: "1px solid #1f2937" }}>{r.name}</td>
                    <td style={{ padding: "8px", borderBottom: "1px solid #1f2937" }}>{num(r.impCnt)}</td>
                    <td style={{ padding: "8px", borderBottom: "1px solid #1f2937" }}>{num(r.clkCnt)}</td>
                    <td style={{ padding: "8px", borderBottom: "1px solid #1f2937" }}>{pct(r.ctr)}</td>
                    <td style={{ padding: "8px", borderBottom: "1px solid #1f2937" }}>{num(r.cpc)}</td>
                    <td style={{ padding: "8px", borderBottom: "1px solid #1f2937" }}>{num(r.avgRnk)}</td>
                    <td style={{ padding: "8px", borderBottom: "1px solid #1f2937", textAlign: "right" }}>
                      {fmtKRW(r.salesAmt)}
                    </td>
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
        </div>
      </div>
    </div>
  );
}
