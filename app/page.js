"use client";

import { useEffect, useMemo, useState } from "react";

/* ---------- 유틸 ---------- */
const fmtKRW = (n) => `₩${Math.round(Number(n) || 0).toLocaleString("ko-KR")}`;
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v)}%` : "-");
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
  const today = kstYesterdayDash(); // 1번 탭과 동일한 유틸 재사용 (어제 날짜)
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);

  // 조건 3개 스켈레톤용 상태
  const [conditions, setConditions] = useState([
    { enabled: true, field: "cost", op: ">=", value: "" },
    { enabled: false, field: "mainRoas", op: ">=", value: "" },
    { enabled: false, field: "roas", op: ">=", value: "" },
  ]);

  // 액션 타입: "bid_amount" | "bid_percent" | "onoff"
  const [actionType, setActionType] = useState("bid_amount");

  // 시뮬레이션 계수
  const [kParam, setKParam] = useState(1.0);
  const [tParam, setTParam] = useState(0.3);

  const fields = [
    { value: "cost", label: "광고비" },
    { value: "avgRnk", label: "평균순위" },
    { value: "mainConv", label: "주 전환수" },
    { value: "mainConvAmt", label: "주 전환매출" },
    { value: "mainRoas", label: "주 ROAS" },
    { value: "conv", label: "전환수" },
    { value: "convAmt", label: "전환매출" },
    { value: "roas", label: "ROAS" },
  ];

  const ops = [
    { value: ">=", label: "이상 (≥)" },
    { value: "<=", label: "이하 (≤)" },
    { value: "==", label: "같음 (=)" },
  ];

  const presetButtons = [
    {
      label: "어제",
      apply: () => {
        setStart(today);
        setEnd(today);
      },
    },
    {
      label: "최근 7일",
      apply: () => {
        const d = new Date(`${today}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 6);
        const yyyy = d.getUTCFullYear();
        const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(d.getUTCDate()).padStart(2, "0");
        setStart(`${yyyy}-${mm}-${dd}`);
        setEnd(today);
      },
    },
    {
      label: "최근 30일",
      apply: () => {
        const d = new Date(`${today}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 29);
        const yyyy = d.getUTCFullYear();
        const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(d.getUTCDate()).padStart(2, "0");
        setStart(`${yyyy}-${mm}-${dd}`);
        setEnd(today);
      },
    },
  ];

  const wrapBox = {
    border: "1px solid #1f2937",
    borderRadius: 12,
    padding: 16,
    background: "#020617",
    marginBottom: 12,
  };

  const label = {
    fontSize: 12,
    color: "#9ca3af",
    marginBottom: 4,
  };

  const sel = {
    background: "#020617",
    color: "#e5e7eb",
    border: "1px solid #27324a",
    borderRadius: 8,
    padding: "6px 8px",
    fontSize: 12,
  };

  const btn = {
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid #334155",
    background: "#0f172a",
    color: "#e5e7eb",
    fontSize: 12,
    cursor: "pointer",
  };

  return (
    <div style={{ maxWidth: 1120 }}>
      {/* 헤더 */}
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
          소재 일괄 컨트롤 (룰 & 시뮬레이션)
        </h1>
        <p style={{ fontSize: 12, color: "#9ca3af" }}>
          기간별 소재 성과를 불러와 조건을 설정하고, 대량 입찰/ON/OFF를 적용하기 전에
          시뮬레이션합니다.
        </p>
      </header>

      {/* STEP 1: 기간 선택 & 데이터 로드 */}
      <section style={wrapBox}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600 }}>1. 기간 선택 & 데이터 로드</h2>
          <span style={{ fontSize: 11, color: "#6b7280" }}>* 현재는 레이아웃만 구현된 상태</span>
        </div>

        {/* 날짜 + 프리셋 + 조회 버튼 */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "flex-end",
            marginBottom: 12,
          }}
        >
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

          <div style={{ display: "flex", gap: 8 }}>
            {presetButtons.map((p) => (
              <button key={p.label} style={btn} onClick={p.apply}>
                {p.label}
              </button>
            ))}
          </div>

          <button
            style={{ ...btn, background: "#1d4ed8", borderColor: "#1d4ed8" }}
            // TODO: 여기서 실제로 /api/stats/ads 호출 붙일 예정
          >
            소재 데이터 조회
          </button>
        </div>

        {/* 데이터 요약 박스 (일단은 placeholder) */}
        <div
          style={{
            marginTop: 8,
            padding: 10,
            borderRadius: 10,
            border: "1px dashed #1f2937",
            background: "#020617",
          }}
        >
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>
            조회된 기간 기준 소재 성과 요약 (예: 전체 비용 / 전환수 / ROAS 등)
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
              gap: 8,
              fontSize: 12,
            }}
          >
            <BulkSummaryItem label="총 비용" value="-" />
            <BulkSummaryItem label="총 전환수" value="-" />
            <BulkSummaryItem label="총 전환매출" value="-" />
            <BulkSummaryItem label="ROAS" value="-" />
            <BulkSummaryItem label="총 주 전환수" value="-" />
            <BulkSummaryItem label="총 주 전환매출" value="-" />
            <BulkSummaryItem label="주 ROAS" value="-" />
            <BulkSummaryItem label="일평균 비용" value="-" />
            <BulkSummaryItem label="일평균 전환수" value="-" />
            <BulkSummaryItem label="일평균 전환매출" value="-" />
            <BulkSummaryItem label="일평균 ROAS" value="-" />
            <BulkSummaryItem label="일평균 주 전환수" value="-" />
            <BulkSummaryItem label="일평균 주 전환매출" value="-" />
            <BulkSummaryItem label="일평균 주 ROAS" value="-" />
          </div>
        </div>
      </section>

      {/* STEP 2: 룰 설정 (조건 + 액션) */}
      <section style={wrapBox}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
          2. 룰 설정 (조건 + 액션)
        </h2>
        <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 10 }}>
          광고비, ROAS, 주 전환 등 지표를 기준으로 최대 3개의 AND 조건을 설정하고, 대상
          소재에 대해 입찰가 또는 ON/OFF 액션을 정의합니다.
        </p>

        {/* 조건 영역 */}
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            borderRadius: 10,
            border: "1px solid #1f2937",
            background: "#020617",
          }}
        >
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>
            액션 대상 조건 (최대 3개 AND)
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {conditions.map((cond, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  opacity: cond.enabled ? 1 : 0.4,
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 11,
                    width: 68,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={cond.enabled}
                    onChange={(e) => {
                      const next = [...conditions];
                      next[idx] = { ...next[idx], enabled: e.target.checked };
                      setConditions(next);
                    }}
                  />
                  조건 {idx + 1}
                </label>

                <select
                  value={cond.field}
                  onChange={(e) => {
                    const next = [...conditions];
                    next[idx] = { ...next[idx], field: e.target.value };
                    setConditions(next);
                  }}
                  style={{ ...sel, minWidth: 140 }}
                >
                  {fields.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>

                <select
                  value={cond.op}
                  onChange={(e) => {
                    const next = [...conditions];
                    next[idx] = { ...next[idx], op: e.target.value };
                    setConditions(next);
                  }}
                  style={{ ...sel, minWidth: 90 }}
                >
                  {ops.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>

                <input
                  type="number"
                  value={cond.value}
                  onChange={(e) => {
                    const next = [...conditions];
                    next[idx] = { ...next[idx], value: e.target.value };
                    setConditions(next);
                  }}
                  placeholder="값"
                  style={{
                    ...sel,
                    minWidth: 120,
                    padding: "6px 8px",
                  }}
                />

                <span style={{ fontSize: 11, color: "#6b7280" }}>
                  {/* 나중에 field에 따라 단위(원, %, 건수 등) 표시해줘도 좋음 */}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 액션 영역 */}
        <div
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #1f2937",
            background: "#020617",
          }}
        >
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>
            액션 내용 (입찰가 또는 ON/OFF 중 1개)
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 16,
              alignItems: "flex-start",
            }}
          >
            {/* 액션 타입 선택 */}
            <div style={{ minWidth: 180 }}>
              <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>
                액션 종류
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  fontSize: 12,
                }}
              >
                <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="radio"
                    name="actionType"
                    value="bid_amount"
                    checked={actionType === "bid_amount"}
                    onChange={(e) => setActionType(e.target.value)}
                  />
                  입찰가 금액 조정
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="radio"
                    name="actionType"
                    value="bid_percent"
                    checked={actionType === "bid_percent"}
                    onChange={(e) => setActionType(e.target.value)}
                  />
                  입찰가 % 조정
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="radio"
                    name="actionType"
                    value="onoff"
                    checked={actionType === "onoff"}
                    onChange={(e) => setActionType(e.target.value)}
                  />
                  소재 ON/OFF
                </label>
              </div>
            </div>

            {/* 액션 상세 설정 (스켈레톤) */}
            <div style={{ flex: 1, minWidth: 260 }}>
              {actionType === "bid_amount" && (
                <div style={{ fontSize: 12 }}>
                  <div style={{ ...label, marginBottom: 4 }}>입찰가 금액 조정</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select style={{ ...sel, minWidth: 90 }}>
                      <option value="decrease">감소</option>
                      <option value="increase">증가</option>
                    </select>
                    <input
                      type="number"
                      placeholder="금액 (원)"
                      style={{ ...sel, minWidth: 120 }}
                    />
                    <span style={{ fontSize: 11, color: "#9ca3af" }}>
                      (최소·최대 입찰 한도는 추후 옵션으로 추가)
                    </span>
                  </div>
                </div>
              )}

              {actionType === "bid_percent" && (
                <div style={{ fontSize: 12 }}>
                  <div style={{ ...label, marginBottom: 4 }}>입찰가 % 조정</div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <select style={{ ...sel, minWidth: 90 }}>
                        <option value="decrease">감소</option>
                        <option value="increase">증가</option>
                      </select>
                      <input
                        type="number"
                        placeholder="변경 비율 (%)"
                        style={{ ...sel, minWidth: 120 }}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <input
                        type="number"
                        placeholder="최소 입찰가 (원)"
                        style={{ ...sel, minWidth: 140 }}
                      />
                      <input
                        type="number"
                        placeholder="최대 입찰가 (원)"
                        style={{ ...sel, minWidth: 140 }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {actionType === "onoff" && (
                <div style={{ fontSize: 12 }}>
                  <div style={{ ...label, marginBottom: 4 }}>소재 ON/OFF 전환</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select style={{ ...sel, minWidth: 140 }}>
                      <option value="off">지정된 소재 OFF</option>
                      <option value="on">지정된 소재 ON</option>
                    </select>
                    <span style={{ fontSize: 11, color: "#9ca3af" }}>
                      (ON의 경우 과거 데이터가 없어 시뮬은 제한적)
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* STEP 3: 프리뷰 & 시뮬레이션 */}
      <section style={wrapBox}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
          3. 프리뷰 & 시뮬레이션
        </h2>
        <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 10 }}>
          설정한 룰에 해당하는 소재 목록과, 적용 전/후 전체 성과 변화를 시뮬레이션한 뒤
          최종 적용 여부를 결정합니다.
        </p>

        {/* 시뮬레이션 계수 설정 */}
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            borderRadius: 10,
            border: "1px solid #1f2937",
            background: "#020617",
          }}
        >
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>
            시뮬레이션 계수 (k, t를 조절하여 입찰 변화에 대한 성과 반응 민감도를 조정)
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12 }}>
            <div>
              <div style={label}>성과 민감도 k</div>
              <input
                type="number"
                step="0.1"
                value={kParam}
                onChange={(e) => setKParam(Number(e.target.value))}
                style={{ ...sel, minWidth: 80 }}
              />
            </div>
            <div>
              <div style={label}>ROAS 기울기 t</div>
              <input
                type="number"
                step="0.1"
                value={tParam}
                onChange={(e) => setTParam(Number(e.target.value))}
                style={{ ...sel, minWidth: 80 }}
              />
            </div>
            <button
              style={{ ...btn }}
              onClick={() => {
                setKParam(1.0);
                setTParam(0.3);
              }}
            >
              기본값으로 초기화 (k=1.0, t=0.3)
            </button>
          </div>
        </div>

        {/* 대상 개요 + BEFORE/AFTER 테이블 (placeholder) */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px, 1.1fr) minmax(260px, 1.4fr)",
            gap: 12,
            alignItems: "flex-start",
          }}
        >
          {/* 대상 개요 */}
          <div
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid #1f2937",
              background: "#020617",
              fontSize: 12,
            }}
          >
            <div style={{ ...label, marginBottom: 4 }}>액션 대상 개요</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div>선택된 조건에 해당하는 소재 수: <strong>-</strong> 개</div>
              <div>해당 소재들의 기간 광고비 합계: <strong>-</strong></div>
              <div>해당 소재들의 기간 전환수/매출: <strong>-</strong></div>
              <div>해당 소재들의 ROAS / 주 ROAS: <strong>-</strong></div>
            </div>
          </div>

          {/* BEFORE / AFTER 요약 */}
          <div
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid #1f2937",
              background: "#020617",
              fontSize: 12,
            }}
          >
            <div style={{ ...label, marginBottom: 4 }}>전체 성과 BEFORE / AFTER (예상)</div>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "6px 4px",
                      borderBottom: "1px solid #1f2937",
                    }}
                  >
                    지표
                  </th>
                  <th
                    style={{
                      textAlign: "right",
                      padding: "6px 4px",
                      borderBottom: "1px solid #1f2937",
                    }}
                  >
                    BEFORE
                  </th>
                  <th
                    style={{
                      textAlign: "right",
                      padding: "6px 4px",
                      borderBottom: "1px solid #1f2937",
                    }}
                  >
                    AFTER(예상)
                  </th>
                  <th
                    style={{
                      textAlign: "right",
                      padding: "6px 4px",
                      borderBottom: "1px solid #1f2937",
                    }}
                  >
                    변화량
                  </th>
                </tr>
              </thead>
              <tbody>
                {["광고비", "전환수", "전환매출", "ROAS", "주 전환수", "주 전환매출", "주 ROAS"].map(
                  (metric) => (
                    <tr key={metric}>
                      <td
                        style={{
                          padding: "4px",
                          borderBottom: "1px solid #0b1120",
                        }}
                      >
                        {metric}
                      </td>
                      <td
                        style={{
                          padding: "4px",
                          textAlign: "right",
                          borderBottom: "1px solid #0b1120",
                        }}
                      >
                        -
                      </td>
                      <td
                        style={{
                          padding: "4px",
                          textAlign: "right",
                          borderBottom: "1px solid #0b1120",
                        }}
                      >
                        -
                      </td>
                      <td
                        style={{
                          padding: "4px",
                          textAlign: "right",
                          borderBottom: "1px solid #0b1120",
                          color: "#a5b4fc",
                        }}
                      >
                        -
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 적용 버튼 영역 */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 12,
          }}
        >
          <button style={{ ...btn, background: "#111827" }}>
            취소
          </button>
          <button
            style={{
              ...btn,
              background: "#16a34a",
              borderColor: "#16a34a",
              fontWeight: 600,
            }}
            disabled
            title="데이터/룰/시뮬레이션 로직 연결 후 활성화 예정"
          >
            적용하기 (추후 활성화)
          </button>
        </div>
      </section>
    </div>
  );
}

function BulkSummaryItem({ label, value }) {
  return (
    <div
      style={{
        padding: 8,
        borderRadius: 8,
        border: "1px solid #1f2937",
        background: "#020617",
      }}
    >
      <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
