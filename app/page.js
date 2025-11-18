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

/* ---------- 페이지 루트: 탭 컨테이너 ---------- */
export default function Page() {
  const [activeTab, setActiveTab] = useState("stats"); // "stats" | "bulk"

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "#020617",
        color: "#e5e7eb",
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {/* 좌측 탭 네비게이션 */}
      <aside
        style={{
          width: 220,
          borderRight: "1px solid #111827",
          padding: "16px 12px",
          background: "#020617",
        }}
      >
        <div style={{ marginBottom: 24, fontSize: 16, fontWeight: 600 }}>
          Naver Ads Console
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <TabButton
            label="광고비 조회"
            description="캠페인/그룹/소재별 성과 및 개별 입찰·ON/OFF"
            active={activeTab === "stats"}
            onClick={() => setActiveTab("stats")}
          />
          <TabButton
            label="소재 일괄 컨트롤"
            description="조건 기반 대량 입찰·상태 변경 & 시뮬레이션"
            active={activeTab === "bulk"}
            onClick={() => setActiveTab("bulk")}
          />
        </nav>
      </aside>

      {/* 우측 메인 영역 */}
      <main style={{ flex: 1, padding: "20px 24px" }}>
        {activeTab === "stats" && <StatsTab />}
        {activeTab === "bulk" && <BulkControlTab />}
      </main>
    </div>
  );
}

function TabButton({ label, description, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "8px 10px",
        borderRadius: 8,
        border: "1px solid " + (active ? "#38bdf8" : "#111827"),
        background: active ? "#0f172a" : "#020617",
        cursor: "pointer",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
        {description}
      </div>
    </button>
  );
}

function SummaryItem({ label, value }) {
  return (
    <div
      style={{
        padding: 8,
        borderRadius: 8,
        border: "1px solid #1f2937",
        background: "#020617",
      }}
    >
      <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{value}</div>
    </div>
  );
}


/* ---------- 1번 탭: 기존 광고비 조회/개별 컨트롤 ---------- */
function StatsTab() {
  // 주 전환(xlsx) 업로드 상태
  const [convFile, setConvFile] = useState(null);
  const [mainConvMap, setMainConvMap] = useState({}); // { mallProductId: { mainccnt, mainconvAmt } }
  const [uploading, setUploading] = useState(false);
  const [bidInputs, setBidInputs] = useState({}); // 소재별 입력한 입찰가
  const [savingBidId, setSavingBidId] = useState(null); // 입찰가 저장 중인 소재 id
  const [togglingId, setTogglingId] = useState(null); // ON/OFF 토글 중인 소재 id

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

  // 날짜 범위 일수 계산
  const dayCount = useMemo(() => {
  if (!start || !end) return 0;
  try {
    const s = new Date(`${start}T00:00:00`);
    const e = new Date(`${end}T00:00:00`);
    const diffMs = e.getTime() - s.getTime();
    if (diffMs < 0) return 0;
    const days = diffMs / (1000 * 60 * 60 * 24) + 1; // 양 끝 포함
    return days;
  } catch {
    return 0;
  }
}, [start, end]);

const summary = useMemo(() => {
  let totalCost = 0;
  let totalConv = 0;
  let totalConvAmt = 0;
  let totalMainConv = 0;
  let totalMainConvAmt = 0;

  for (const r of rows) {
    totalCost += Number(r.salesAmt) || 0;
    totalConv += Number(r.ccnt) || 0;
    totalConvAmt += Number(r.convAmt) || 0;

    const key = r.mallProductId;
    const main = (mainConvMap && mainConvMap[key]) || {};
    totalMainConv += Number(main.mainccnt) || 0;
    totalMainConvAmt += Number(main.mainconvAmt) || 0;
  }

  const roas = totalCost > 0 ? (totalConvAmt / totalCost) * 100 : 0;
  const mainRoas = totalCost > 0 ? (totalMainConvAmt / totalCost) * 100 : 0;

  const days = dayCount > 0 ? dayCount : 1;

  const dailyCost = totalCost / days;
  const dailyConv = totalConv / days;
  const dailyConvAmt = totalConvAmt / days;
  const dailyMainConv = totalMainConv / days;
  const dailyMainConvAmt = totalMainConvAmt / days;

  const dailyRoas =
    dailyCost > 0 ? (dailyConvAmt / dailyCost) * 100 : 0;
  const dailyMainRoas =
    dailyCost > 0 ? (dailyMainConvAmt / dailyCost) * 100 : 0;

  return {
    total: {
      cost: totalCost,
      conv: totalConv,
      convAmt: totalConvAmt,
      roas,
      mainConv: totalMainConv,
      mainConvAmt: totalMainConvAmt,
      mainRoas,
    },
    daily: {
      cost: dailyCost,
      conv: dailyConv,
      convAmt: dailyConvAmt,
      roas: dailyRoas,
      mainConv: dailyMainConv,
      mainConvAmt: dailyMainConvAmt,
      mainRoas: dailyMainRoas,
    },
  };
}, [rows, mainConvMap, dayCount]);



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
        const r = await fetch(
          `/api/adgroups?campaignId=${encodeURIComponent(selectedCampaign)}`
        );
        const j = await r.json();
        const list = (j.adgroups || []).map((g) => ({ id: g.id, name: g.name }));
        setAdgroups(list);
      } catch (e) {
        console.error(e);
        setErr("광고그룹 목록을 불러오지 못했습니다.");
      }
    })();
  }, [selectedCampaign]);

  // 소재 레벨에서 rows가 바뀔 때, 각 소재의 현재 입찰가를 입력창 기본값으로 세팅
  useEffect(() => {
    if (level !== "ad") return;
    const next = {};
    for (const r of rows) {
      next[r.nccAdId] = r.bidAmt ?? "";
    }
    setBidInputs(next);
  }, [rows, level]);

  const presets = [
    { label: "어제", range: () => ({ s: yday, e: yday }) },
    {
      label: "최근 7일",
      range: () => {
        const e = yday;
        const d = new Date(`${yday}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 6);
        const s = `${d.getUTCFullYear()}-${String(
          d.getUTCMonth() + 1
        ).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
        return { s, e };
      },
    },
    {
      label: "최근 30일",
      range: () => {
        const e = yday;
        const d = new Date(`${yday}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 29);
        const s = `${d.getUTCFullYear()}-${String(
          d.getUTCMonth() + 1
        ).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
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
        const qs = selectedCampaign
          ? `&campaignId=${encodeURIComponent(selectedCampaign)}`
          : "";
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

  // 개별 소재 입찰가 변경
  async function updateBid(adId) {
    const raw = bidInputs[adId];
    const bidAmt = Number(raw);

    if (!Number.isFinite(bidAmt) || bidAmt <= 0) {
      alert("입찰가는 0보다 큰 숫자로 입력해 주세요.");
      return;
    }

    try {
      setSavingBidId(adId);
      const res = await fetch(`/api/ads/${encodeURIComponent(adId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adId,
          adAttr: {
            bidAmt,
            useGroupBidAmt: false,
          },
        }),
      });

      const j = await res.json();
      if (!res.ok || j.error) {
        throw new Error(j.error || `입찰가 변경 실패 (${res.status})`);
      }

      // 성공 시 rows 안의 해당 소재 bidAmt도 갱신
      setRows((prev) =>
        prev.map((r) => (r.nccAdId === adId ? { ...r, bidAmt } : r))
      );
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setSavingBidId(null);
    }
  }

  // 개별 소재 ON/OFF 토글 (userLock: false=ON, true=OFF)
  async function toggleAd(adId, currentUserLock) {
    const nextLock = !currentUserLock; // true면 OFF, false면 ON

    try {
      setTogglingId(adId);
      const res = await fetch(`/api/ads/${encodeURIComponent(adId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adId,
          userLock: nextLock,
        }),
      });

      const j = await res.json();
      if (!res.ok || j.error) {
        throw new Error(j.error || `ON/OFF 변경 실패 (${res.status})`);
      }

      // 성공 시 rows 안의 해당 소재 userLock 갱신
      setRows((prev) =>
        prev.map((r) =>
          r.nccAdId === adId ? { ...r, userLock: nextLock } : r
        )
      );
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setTogglingId(null);
    }
  }

  async function uploadConversions() {
    if (!convFile) {
      setErr("업로드할 xlsx 파일을 선택해주세요.");
      return;
    }
    try {
      setErr("");
      setUploading(true);

      const fd = new FormData();
      fd.append("file", convFile);
      fd.append("start", start);
      fd.append("end", end);

      const r = await fetch("/api/conversions/upload", {
        method: "POST",
        body: fd,
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || "업로드 실패");

      // 응답을 { mallProductId: {mainccnt, mainconvAmt} } 맵으로 정리
      const map = j.byMallProductId || {};
      setMainConvMap(map);
    } catch (e) {
      console.error(e);
      setErr(String(e.message || e));
    } finally {
      setUploading(false);
    }
  }

  /* ---------- 스타일 ---------- */
  const card = {
    width: "min(1040px, 95vw)",
    background: "#0f172a",
    border: "1px solid #1f2940",
    borderRadius: 20,
    padding: 24,
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
  };
  const box = {
    background: "#111827",
    border: "1px solid #1f2937",
    borderRadius: 16,
    padding: 16,
  };
  const label = { fontSize: 12, color: "#9ca3af", marginBottom: 6 };
  const row = {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
    alignItems: "center",
  };
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
    <div style={card}>
      {/* 헤더 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 700 }}>
          네이버 광고 집계 (캠페인 → 그룹 → 소재)
        </h1>
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
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                }}
              >
                <input
                  type="radio"
                  name="level"
                  value={lv}
                  checked={level === lv}
                  onChange={(e) => setLevel(e.target.value)}
                />
                {lv === "campaign"
                  ? "캠페인"
                  : lv === "adgroup"
                  ? "그룹"
                  : "소재"}
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
              <option value="">
                {adgroups.length ? "전체" : "캠페인 선택 필요"}
              </option>
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
            <input
              type="date"
              value={start}
              max={end}
              onChange={(e) => setStart(e.target.value)}
              style={sel}
            />
          </div>
          <div>
            <div style={label}>종료일</div>
            <input
              type="date"
              value={end}
              min={start}
              onChange={(e) => setEnd(e.target.value)}
              style={sel}
            />
          </div>

          {/* 주 전환(xlsx) 업로드 */}
          <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
            <div>
              <div style={label}>주 전환(xlsx)</div>
              <input
                type="file"
                accept=".xlsx"
                onChange={(e) =>
                  setConvFile(e.target.files?.[0] || null)
                }
                style={{ ...sel, padding: "8px", minWidth: 220 }}
              />
            </div>
            <button
              style={{ ...btn, background: "#2b6b3f" }}
              onClick={uploadConversions}
              disabled={uploading || !convFile}
              title="현재 선택한 시작/종료일 범위로 집계됩니다"
            >
              {uploading ? "업로드 중…" : "업로드"}
            </button>
          </div>

          {/* 프리셋 */}
          <div
            style={{ display: "flex", gap: 8, alignItems: "end" }}
          >
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
            <button
              style={{ ...btn, background: "#25436a" }}
              onClick={query}
            >
              {loading ? "조회 중…" : "조회"}
            </button>
          </div>
        </div>

        {!!err && (
          <div style={{ fontSize: 12, color: "#fca5a5" }}>
            * {err}
          </div>
        )}
      </div>

{/* 합계 & 일평균 요약 */}
<div style={{ ...box, marginBottom: 16 }}>
  <div style={{ marginBottom: 8, fontSize: 12, color: "#9ca3af" }}>
    기간 합계 / 일평균
  </div>

  {/* 기간 합계 */}
  <div style={{ marginBottom: 10 }}>
    <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
      기간 합계
    </div>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
        gap: 8,
        fontSize: 12,
      }}
    >
      <SummaryItem label="총 비용" value={fmtKRW(summary.total.cost)} />
      <SummaryItem label="총 전환수" value={num(summary.total.conv)} />
      <SummaryItem
        label="총 전환매출"
        value={fmtKRW(summary.total.convAmt)}
      />
      <SummaryItem label="ROAS" value={pct(summary.total.roas)} />
      <SummaryItem
        label="총 주 전환수"
        value={num(summary.total.mainConv)}
      />
      <SummaryItem
        label="총 주 전환매출"
        value={fmtKRW(summary.total.mainConvAmt)}
      />
      <SummaryItem
        label="주 ROAS"
        value={pct(summary.total.mainRoas)}
      />
    </div>
  </div>

  {/* 일평균 */}
  <div style={{ borderTop: "1px solid #1f2937", paddingTop: 10 }}>
    <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
      일평균
    </div>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
        gap: 8,
        fontSize: 12,
      }}
    >
      <SummaryItem label="총 비용" value={fmtKRW(summary.daily.cost)} />
      <SummaryItem label="총 전환수" value={num(summary.daily.conv)} />
      <SummaryItem
        label="총 전환매출"
        value={fmtKRW(summary.daily.convAmt)}
      />
      <SummaryItem label="ROAS" value={pct(summary.daily.roas)} />
      <SummaryItem
        label="총 주 전환수"
        value={num(summary.daily.mainConv)}
      />
      <SummaryItem
        label="총 주 전환매출"
        value={fmtKRW(summary.daily.mainConvAmt)}
      />
      <SummaryItem
        label="주 ROAS"
        value={pct(summary.daily.mainRoas)}
      />
    </div>
  </div>
</div>


      {/* 테이블 */}
      <div style={box}>
        <div style={label}>
          결과 {rows.length.toLocaleString("ko-KR")}건{" "}
          {loading ? "(로딩…)" : ""}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr
                style={{
                  textAlign: "left",
                  background: "#0b1020",
                }}
              >
                {level === "ad" && (
                  <>
                    <th
                      style={{
                        padding: "10px 8px",
                        borderBottom: "1px solid #1f2937",
                      }}
                    >
                      썸네일
                    </th>
                    <th
                      style={{
                        padding: "10px 8px",
                        borderBottom: "1px solid #1f2937",
                      }}
                    >
                      상품명
                    </th>
                    <th
                      style={{
                        padding: "10px 8px",
                        borderBottom: "1px solid #1f2937",
                      }}
                    >
                      몰상품ID
                    </th>
                    <th
                      style={{
                        padding: "10px 8px",
                        borderBottom: "1px solid #1f2937",
                      }}
                    >
                      광고ID
                    </th>
                    <th
                      style={{
                        padding: "10px 8px",
                        borderBottom: "1px solid #1f2937",
                        textAlign: "right",
                      }}
                    >
                      입찰가
                    </th>
                    <th
                      style={{
                        padding: "10px 8px",
                        borderBottom: "1px solid #1f2937",
                      }}
                    >
                      상태
                    </th>
                  </>
                )}
                <th
                  style={{
                    padding: "10px 8px",
                    borderBottom: "1px solid #1f2937",
                  }}
                >
                  노출
                </th>
                <th
                  style={{
                    padding: "10px 8px",
                    borderBottom: "1px solid #1f2937",
                  }}
                >
                  클릭
                </th>
                <th
                  style={{
                    padding: "10px 8px",
                    borderBottom: "1px solid #1f2937",
                  }}
                >
                  CTR
                </th>
                <th
                  style={{
                    padding: "10px 8px",
                    borderBottom: "1px solid #1f2937",
                  }}
                >
                  CPC
                </th>
                <th
                  style={{
                    padding: "10px 8px",
                    borderBottom: "1px solid #1f2937",
                  }}
                >
                  평균순위
                </th>
                <th
                  style={{
                    padding: "10px 8px",
                    borderBottom: "1px solid #1f2937",
                    textAlign: "right",
                  }}
                >
                  비용
                </th>
                <th
                  style={{
                    padding: "10px 8px",
                    borderBottom: "1px solid #1f2937",
                    textAlign: "right",
                  }}
                >
                  전환수
                </th>
                <th
                  style={{
                    padding: "10px 8px",
                    borderBottom: "1px solid #1f2937",
                    textAlign: "right",
                  }}
                >
                  전환매출
                </th>
                <th
                  style={{
                    padding: "10px 8px",
                    borderBottom: "1px solid #1f2937",
                    textAlign: "right",
                  }}
                >
                  주 전환수
                </th>
                <th
                  style={{
                    padding: "10px 8px",
                    borderBottom: "1px solid #1f2937",
                    textAlign: "right",
                  }}
                >
                  주 전환매출
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const matchKey = r.mallProductId;
                const main =
                  mainConvMap?.[matchKey] ?? {
                    mainccnt: 0,
                    mainconvAmt: 0,
                  };
                const bidValue = bidInputs[r.nccAdId] ?? "";
                const isSavingBid = savingBidId === r.nccAdId;
                const isToggling = togglingId === r.nccAdId;
                const isOff = !!r.userLock; // true면 OFF

                return (
                  <tr key={r.nccAdId}>
                    {level === "ad" && (
                      <>
                        <td
                          style={{
                            padding: "8px",
                            borderBottom:
                              "1px solid #1f2937",
                          }}
                        >
                          {r.imageUrl ? (
                            <img
                              src={r.imageUrl}
                              alt="thumbnail"
                              width={60}
                              height={60}
                              style={{
                                borderRadius: 8,
                                objectFit: "cover",
                              }}
                            />
                          ) : (
                            "-"
                          )}
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            borderBottom:
                              "1px solid #1f2937",
                          }}
                        >
                          {r.productName || "-"}
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            borderBottom:
                              "1px solid #1f2937",
                          }}
                        >
                          {r.mallProductId || "-"}
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            borderBottom:
                              "1px solid #1f2937",
                          }}
                        >
                          {r.nccAdId || "-"}
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            borderBottom:
                              "1px solid #1f2937",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                            }}
                          >
                            <input
                              type="number"
                              min={50}
                              max={2000}
                              step={10}
                              value={bidValue}
                              onChange={(e) => {
                                const raw =
                                  e.target.value;
                                setBidInputs(
                                  (prev) => ({
                                    ...prev,
                                    [r.nccAdId]: raw,
                                  })
                                );
                              }}
                              onBlur={(e) => {
                                const raw =
                                  e.target.value;

                                if (
                                  raw === "" ||
                                  raw == null
                                ) {
                                  setBidInputs(
                                    (prev) => ({
                                      ...prev,
                                      [r.nccAdId]: "",
                                    })
                                  );
                                  return;
                                }

                                let v = Number(raw);
                                if (
                                  Number.isNaN(v)
                                ) {
                                  return;
                                }

                                if (v < 50) v = 50;
                                if (v > 2000) v = 2000;

                                v =
                                  Math.round(
                                    v / 10
                                  ) * 10;

                                setBidInputs(
                                  (prev) => ({
                                    ...prev,
                                    [r.nccAdId]: v,
                                  })
                                );
                              }}
                              style={{
                                width: 70,
                                padding:
                                  "4px 6px",
                                background:
                                  "#020617",
                                border:
                                  "1px solid #334155",
                                borderRadius: 6,
                                color: "#e5e7eb",
                                fontSize: 12,
                              }}
                            />
                            <button
                              onClick={() =>
                                updateBid(
                                  r.nccAdId
                                )
                              }
                              disabled={
                                isSavingBid
                              }
                              style={{
                                fontSize: 12,
                                padding:
                                  "4px 8px",
                                borderRadius: 6,
                                border:
                                  "1px solid #334155",
                                background:
                                  isSavingBid
                                    ? "#1e293b"
                                    : "#0f172a",
                                cursor: isSavingBid
                                  ? "default"
                                  : "pointer",
                              }}
                            >
                              {isSavingBid
                                ? "저장중…"
                                : "변경"}
                            </button>
                          </div>
                        </td>

                        {/* ON/OFF 토글 */}
                        <td
                          style={{
                            padding: "8px",
                            borderBottom:
                              "1px solid #1f2937",
                          }}
                        >
                          <button
                            onClick={() =>
                              toggleAd(
                                r.nccAdId,
                                r.userLock
                              )
                            }
                            disabled={
                              isToggling
                            }
                            style={{
                              fontSize: 12,
                              padding:
                                "4px 10px",
                              borderRadius: 999,
                              border:
                                "1px solid #4b5563",
                              background: isOff
                                ? "#111827"
                                : "#16a34a22",
                              color: isOff
                                ? "#9ca3af"
                                : "#bbf7d0",
                              cursor: isToggling
                                ? "default"
                                : "pointer",
                            }}
                          >
                            {isToggling
                              ? "변경중…"
                              : isOff
                              ? "OFF"
                              : "ON"}
                          </button>
                        </td>
                      </>
                    )}

                    <td
                      style={{
                        padding: "8px",
                        borderBottom:
                          "1px solid #1f2937",
                      }}
                    >
                      {num(r.impCnt)}
                    </td>
                    <td
                      style={{
                        padding: "8px",
                        borderBottom:
                          "1px solid #1f2937",
                      }}
                    >
                      {num(r.clkCnt)}
                    </td>
                    <td
                      style={{
                        padding: "8px",
                        borderBottom:
                          "1px solid #1f2937",
                      }}
                    >
                      {pct(r.ctr)}
                    </td>
                    <td
                      style={{
                        padding: "8px",
                        borderBottom:
                          "1px solid #1f2937",
                      }}
                    >
                      {num(r.cpc)}
                    </td>
                    <td
                      style={{
                        padding: "8px",
                        borderBottom:
                          "1px solid #1f2937",
                      }}
                    >
                      {num(r.avgRnk)}
                    </td>
                    <td
                      style={{
                        padding: "8px",
                        borderBottom:
                          "1px solid #1f2937",
                        textAlign: "right",
                      }}
                    >
                      {fmtKRW(r.salesAmt)}
                    </td>
                    <td
                      style={{
                        padding: "8px",
                        borderBottom:
                          "1px solid #1f2937",
                      }}
                    >
                      {num(r.ccnt)}
                    </td>
                    <td
                      style={{
                        padding: "8px",
                        borderBottom:
                          "1px solid #1f2937",
                        textAlign: "right",
                      }}
                    >
                      {fmtKRW(r.convAmt)}
                    </td>

                    {/* 주 전환 데이터 표시 (엑셀 매칭) */}
                    <td
                      style={{
                        padding: "8px",
                        borderBottom:
                          "1px solid #1f2937",
                      }}
                    >
                      {num(main.mainccnt)}
                    </td>
                    <td
                      style={{
                        padding: "8px",
                        borderBottom:
                          "1px solid #1f2937",
                        textAlign: "right",
                      }}
                    >
                      {fmtKRW(main.mainconvAmt)}
                    </td>
                  </tr>
                );
              })}

              {!rows.length && !loading && (
                <tr>
                  <td
                    colSpan={level === "ad" ? 11 : 7}
                    style={{
                      padding: "14px",
                      color: "#9ca3af",
                      textAlign: "center",
                    }}
                  >
                    데이터가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------- 2번 탭: 소재 일괄 컨트롤 (룰 & 시뮬) 스켈레톤 ---------- */
function BulkControlTab() {
  return (
    <div style={{ maxWidth: 1040 }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
          소재 일괄 컨트롤 (룰 & 시뮬레이션)
        </h1>
        <p style={{ fontSize: 12, color: "#9ca3af" }}>
          기간별 소재 성과를 불러와 조건을 설정하고, 대량 입찰/ON/OFF를 적용하기 전에
          시뮬레이션합니다.
        </p>
      </header>

      <section
        style={{
          border: "1px solid #1f2937",
          borderRadius: 12,
          padding: 16,
          background: "#020617",
          marginBottom: 8,
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
          1. 기간 선택 & 데이터 로드
        </h2>
        <p style={{ fontSize: 12, color: "#9ca3af" }}>
          특정 기간(예: 최근 7일)을 선택하고, 해당 기간의 모든 소재 성과 데이터를
          불러옵니다.
        </p>
      </section>

      <section
        style={{
          border: "1px solid #1f2937",
          borderRadius: 12,
          padding: 16,
          background: "#020617",
          marginBottom: 8,
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
          2. 룰 설정 (조건 + 액션)
        </h2>
        <p style={{ fontSize: 12, color: "#9ca3af" }}>
          광고비 / ROAS / 주전환ROAS 등 조건을 설정하고, 입찰가 조정 또는 ON/OFF 액션을
          정의합니다.
        </p>
      </section>

      <section
        style={{
          border: "1px solid #1f2937",
          borderRadius: 12,
          padding: 16,
          background: "#020617",
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
          3. 프리뷰 & 시뮬레이션
        </h2>
        <p style={{ fontSize: 12, color: "#9ca3af" }}>
          선택된 룰이 적용될 대상 소재와, 적용 전/후 전체 성과(광고비, 전환, 매출, ROAS)를
          미리 확인한 뒤 확정합니다.
        </p>
      </section>
    </div>
  );
}
