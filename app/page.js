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

  // 🔥 주 전환(xlsx) 관련 공통 상태 (탭 간 공유)
  const [convFile, setConvFile] = useState(null);
  const [mainConvMap, setMainConvMap] = useState({}); // { mallProductId: { mainccnt, mainconvAmt } }
  const [uploading, setUploading] = useState(false);

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
        {activeTab === "stats" && (
          <StatsTab
            mainConvMap={mainConvMap}
            setMainConvMap={setMainConvMap}
            convFile={convFile}
            setConvFile={setConvFile}
            uploading={uploading}
            setUploading={setUploading}
          />
        )}
        {activeTab === "bulk" && (
          <BulkControlTab
            mainConvMap={mainConvMap}
          />
        )}
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
function StatsTab({
  mainConvMap,
  setMainConvMap,
  convFile,
  setConvFile,
  uploading,
  setUploading,
}) {
  // 주 전환(xlsx) 업로드 state는 이제 상위(Page)에서 받음

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
                <th style={{ padding:"10px 8px", borderBottom:"1px solid #1f2937" }}>이름</th>
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
                    <td style={{ padding:"8px", borderBottom:"1px solid #1f2937" }}>{r.name}</td>
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

/* ---------- 2번 탭: 소재 일괄 컨트롤 (룰 & 시뮬) ---------- */
function BulkControlTab({ mainConvMap }) {
  const today = kstYesterdayDash(); // 1번 탭과 동일하게 어제를 기본값으로 사용
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);

  const [applyLoading, setApplyLoading] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [applyResult, setApplyResult] = useState(null); // { total, success, fail }

const [applyLogRows, setApplyLogRows] = useState([]);   // CSV 로그용 row 배열
const [isApplyModalOpen, setIsApplyModalOpen] = useState(false); // 모달 on/off


  // STEP1: 조회된 소재 데이터 (/api/naver/ad-summary 응답)
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // STEP2: 조건 상태
  const [conditions, setConditions] = useState([
    { enabled: true, field: "cost", op: ">=", value: "" },
    { enabled: false, field: "mainRoas", op: ">=", value: "" },
    { enabled: false, field: "roas", op: ">=", value: "" },
  ]);

  // 액션 타입: "bid_amount" | "bid_percent" | "onoff"
  const [actionType, setActionType] = useState("bid_amount");

  // 시뮬레이션 계수
  const [kParam, setKParam] = useState(0.7);
  const [tParam, setTParam] = useState(0.7);

  // 액션 상세 입력값 (Step2)
  const [bidAmountMode, setBidAmountMode] = useState("decrease"); // 금액 증/감
  const [bidAmountDelta, setBidAmountDelta] = useState("");       // 금액 (원)

  const [bidPercentMode, setBidPercentMode] = useState("decrease"); // % 증/감
  const [bidPercentDelta, setBidPercentDelta] = useState("");       // % 값

  const [onoffMode, setOnoffMode] = useState("off"); // "off" | "on"

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

  const thStyle = {
    padding: "6px 6px",
    border: "1px solid #27324a",
    fontSize: 11,
    whiteSpace: "nowrap",
    background: "#020617",
    color: "#e5e7eb",
  };

  const tdStyle = {
    padding: "6px 6px",
    border: "1px solid #111827",
    fontSize: 11,
    color: "#e5e7eb",
  };

  // 간단 포맷터
  const fmtNum = (v) => {
    if (v == null || isNaN(v)) return "-";
    return Number(v).toLocaleString("ko-KR");
  };
  const fmtKRWLocal = (v) => {
    if (v == null || isNaN(v)) return "-";
    return Number(v).toLocaleString("ko-KR");
  };
  const fmtPct = (v) => {
    if (v == null || isNaN(v)) return "-";
    return `${v.toFixed(1)}%`;
  };

  const calcRoas = (convAmt, cost) => {
    if (!cost || cost === 0) return "-";
    const roas = (Number(convAmt || 0) / Number(cost)) * 100;
    return `${roas.toFixed(1)}%`;
  };

  // 🔢 기간 일수 계산 (양 끝 포함)
  const dayCount = useMemo(() => {
    if (!start || !end) return 0;
    try {
      const s = new Date(`${start}T00:00:00`);
      const e = new Date(`${end}T00:00:00`);
      const diffMs = e.getTime() - s.getTime();
      if (diffMs < 0) return 0;
      return diffMs / (1000 * 60 * 60 * 24) + 1;
    } catch {
      return 0;
    }
  }, [start, end]);

  // 📊 STEP1 요약: 합계 + 일평균 (전체 기준)
  const summary = useMemo(() => {
    let totalCost = 0;
    let totalConv = 0;
    let totalConvAmt = 0;
    let totalMainConv = 0;
    let totalMainConvAmt = 0;

    for (const r of rows) {
      totalCost += Number(r.cost) || 0;
      totalConv += Number(r.convCnt) || 0;
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

    const dailyRoas = dailyCost > 0 ? (dailyConvAmt / dailyCost) * 100 : 0;
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

  // STEP2: 조건 필터링 + 대상 요약
  const filtered = useMemo(() => {
    const activeConds = (conditions || []).filter(
      (c) => c && c.enabled && c.field && c.value !== ""
    );

    const buildSummary = (targetRows) => {
      let totalCost = 0;
      let totalConv = 0;
      let totalConvAmt = 0;
      let totalMainConv = 0;
      let totalMainConvAmt = 0;

      for (const r of targetRows) {
        totalCost += Number(r.cost) || 0;
        totalConv += Number(r.convCnt) || 0;
        totalConvAmt += Number(r.convAmt) || 0;

        const key = r.mallProductId;
        const main = (mainConvMap && mainConvMap[key]) || {};
        totalMainConv += Number(main.mainccnt) || 0;
        totalMainConvAmt += Number(main.mainconvAmt) || 0;
      }

      const roas = totalCost > 0 ? (totalConvAmt / totalCost) * 100 : 0;
      const mainRoas =
        totalCost > 0 ? (totalMainConvAmt / totalCost) * 100 : 0;

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
    };

    // 조건이 하나도 없으면 전체 rows 기준 (= 전체를 대상이라고도 볼 수 있음)
    if (!activeConds.length) {
      return {
        rows,
        summary: buildSummary(rows),
      };
    }

    const getMetric = (r, field) => {
      const key = r.mallProductId;
      const main = (mainConvMap && mainConvMap[key]) || {};
      switch (field) {
        case "cost":
          return Number(r.cost) || 0;
        case "conv":
          return Number(r.convCnt) || 0;
        case "convAmt":
          return Number(r.convAmt) || 0;
        case "roas": {
          const cost = Number(r.cost) || 0;
          const amt = Number(r.convAmt) || 0;
          return cost > 0 ? (amt / cost) * 100 : 0;
        }
        case "mainConv":
          return Number(main.mainccnt) || 0;
        case "mainConvAmt":
          return Number(main.mainconvAmt) || 0;
        case "mainRoas": {
          const cost = Number(r.cost) || 0;
          const amt = Number(main.mainconvAmt) || 0;
          return cost > 0 ? (amt / cost) * 100 : 0;
        }
        case "avgRnk":
          return Number(r.avgRnk) || 0;
        default:
          return null;
      }
    };

    const checkOp = (metric, op, rawValue) => {
      if (metric == null || Number.isNaN(metric)) return false;
      const v = Number(rawValue);
      if (!Number.isFinite(v)) return false;
      if (op === ">=") return metric >= v;
      if (op === "<=") return metric <= v;
      if (op === "==") return metric === v;
      return true;
    };

    const filteredRows = rows.filter((r) =>
      activeConds.every((c) =>
        checkOp(getMetric(r, c.field), c.op, c.value)
      )
    );

    return {
      rows: filteredRows,
      summary: buildSummary(filteredRows),
    };
  }, [rows, conditions, mainConvMap, dayCount]);

  // STEP3: BEFORE(전체) / AFTER(전체) + 대상만 BEFORE/AFTER 시뮬레이션
  const simulation = useMemo(() => {
    if (!summary || !summary.total) return null;

    const beforeAll = summary.total; // STEP1 전체 요약 = BEFORE

    const hasTarget =
      filtered &&
      filtered.summary &&
      Array.isArray(filtered.rows) &&
      filtered.rows.length > 0;

    if (!hasTarget) {
      // 대상이 없으면 전체 성과는 그대로
      return {
        beforeAll,
        afterAll: { ...beforeAll },
        beforeTarget: null,
        afterTarget: null,
      };
    }

    const beforeTarget = filtered.summary.total;

    // 전체 = 대상 + 나머지
    const beforeOthers = {
      cost: beforeAll.cost - beforeTarget.cost,
      conv: beforeAll.conv - beforeTarget.conv,
      convAmt: beforeAll.convAmt - beforeTarget.convAmt,
      mainConv: beforeAll.mainConv - beforeTarget.mainConv,
      mainConvAmt: beforeAll.mainConvAmt - beforeTarget.mainConvAmt,
    };

    // 1) 입찰 변화율 (bidAmt 기반)
    let bidGrowth = 1; // 대상 소재 광고비가 몇 배가 될지

    const bidRows = filtered.rows.filter((r) => {
      const b = Number(r.bidAmt);
      return Number.isFinite(b) && b > 0;
    });

    if (bidRows.length === 0) {
      bidGrowth = 1;
    } else if (actionType === "bid_amount") {
      const delta = Number(bidAmountDelta);
      if (Number.isFinite(delta) && delta !== 0) {
        let beforeSum = 0;
        let afterSum = 0;
        for (const r of bidRows) {
          const b = Number(r.bidAmt) || 0;
          beforeSum += b;
          const newB =
            bidAmountMode === "increase" ? b + delta : Math.max(0, b - delta);
          afterSum += newB;
        }
        bidGrowth = beforeSum > 0 ? afterSum / beforeSum : 1;
      }
    } else if (actionType === "bid_percent") {
      const pct = Number(bidPercentDelta);
      if (Number.isFinite(pct) && pct !== 0) {
        const sign = bidPercentMode === "increase" ? 1 : -1;
        bidGrowth = 1 + (pct / 100) * sign;
      }
    } else if (actionType === "onoff") {
      bidGrowth = onoffMode === "off" ? 0 : 1;
    }

    // 2) 시뮬레이션 계수 k, t 적용
    const kBase = Number.isFinite(kParam) && kParam > 0 ? kParam : 1;
    const costFactor = bidGrowth * kBase; // 대상 광고비 배수

    // t: 전환이 광고비 변화를 얼마나 따라갈지 (t=1 → 100%, t=0.5 → 50%)
    const t = Number.isFinite(tParam) ? tParam : 1;

    // 광고비가 costFactor배로 변할 때
    // 전환/매출 배수 = 1 + t * (costFactor - 1)
    // 예) costFactor=0.5, t=1   → 1 + 1*(0.5-1)  = 0.5  (50% 감소)
    //     costFactor=0.5, t=0.5 → 1 + 0.5*(0.5-1)= 0.75 (25% 감소)
    let perfFactor = 1 + t * (costFactor - 1);
    if (perfFactor < 0) perfFactor = 0; // 안전장치


    const calcRoasNum = (amt, cost) =>
      cost > 0 ? (amt / cost) * 100 : 0;

    // 3) 대상 AFTER
    const afterTarget = {
      cost: beforeTarget.cost * costFactor,
      conv: beforeTarget.conv * perfFactor,
      convAmt: beforeTarget.convAmt * perfFactor,
      mainConv: beforeTarget.mainConv * perfFactor,
      mainConvAmt: beforeTarget.mainConvAmt * perfFactor,
    };
    afterTarget.roas = calcRoasNum(afterTarget.convAmt, afterTarget.cost);
    afterTarget.mainRoas = calcRoasNum(
      afterTarget.mainConvAmt,
      afterTarget.cost
    );

    // 4) 나머지는 그대로
    const afterOthers = { ...beforeOthers };

    // 5) 전체 AFTER = 대상 AFTER + 나머지 BEFORE
    const afterAll = {
      cost: afterTarget.cost + afterOthers.cost,
      conv: afterTarget.conv + afterOthers.conv,
      convAmt: afterTarget.convAmt + afterOthers.convAmt,
      mainConv: afterTarget.mainConv + afterOthers.mainConv,
      mainConvAmt: afterTarget.mainConvAmt + afterOthers.mainConvAmt,
    };
    afterAll.roas = calcRoasNum(afterAll.convAmt, afterAll.cost);
    afterAll.mainRoas = calcRoasNum(afterAll.mainConvAmt, afterAll.cost);

    return {
      beforeAll,
      afterAll,
      beforeTarget,
      afterTarget,
    };
  }, [
    summary,
    filtered,
    actionType,
    bidAmountMode,
    bidAmountDelta,
    bidPercentMode,
    bidPercentDelta,
    onoffMode,
    kParam,
    tParam,
  ]);

    // ✅ 실제로 보낼 bulk 액션 payload 생성
  function buildBulkActions() {
    if (!filtered || !Array.isArray(filtered.rows) || !filtered.rows.length) {
      return [];
    }

    const items = [];

    for (const r of filtered.rows) {
      const adId = r.adId;
      if (!adId) continue;

      // ON/OFF 액션
      if (actionType === "onoff") {
        const status = onoffMode === "off" ? "OFF" : "ON";
        items.push({
          adId,
          type: "onoff",
          status,
        });
        continue;
      }

      // 입찰 액션 (bid_amount / bid_percent)
      const currentBid = Number(r.bidAmt);
      if (!Number.isFinite(currentBid) || currentBid <= 0) {
        // 유효한 입찰가가 없으면 스킵
        continue;
      }

      if (actionType === "bid_amount") {
        const delta = Number(bidAmountDelta);
        if (!Number.isFinite(delta) || delta === 0) continue;

        let newBid =
          bidAmountMode === "increase"
            ? currentBid + delta
            : Math.max(0, currentBid - delta);

        // 필요하다면 최소 단위/최댓값 등 추가 제한 가능
        newBid = Math.round(newBid);

        items.push({
          adId,
          type: "bid",
          newBid,
        });
      } else if (actionType === "bid_percent") {
        const pct = Number(bidPercentDelta);
        if (!Number.isFinite(pct) || pct === 0) continue;

        const sign = bidPercentMode === "increase" ? 1 : -1;
        const factor = 1 + (pct / 100) * sign;
        let newBid = currentBid * factor;

        newBid = Math.round(newBid);

        items.push({
          adId,
          type: "bid",
          newBid,
        });
      }
    }

    return items;
  }

    // ✅ "적용하기" 버튼 클릭 시 실제로 API 호출
    // ✅ "적용하기" 버튼 클릭 시 실제로 API 호출
  async function handleApplyBulk() {
    setApplyError("");
    setApplyResult(null);
    setApplyLogRows([]);
    setIsApplyModalOpen(false);

    const items = buildBulkActions(); // 앞에서 만들어둔 함수

    if (!items.length) {
      setApplyError("적용할 대상이 없습니다. 조건/액션 설정을 확인해 주세요.");
      return;
    }

    try {
      setApplyLoading(true);

      const res = await fetch("/api/naver/ad-bulk-action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ items }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || `적용 실패 (${res.status})`);
      }

      const total = data.total ?? items.length;
      const success = data.success ?? total;
      const fail = data.fail ?? 0;
      const errors = Array.isArray(data.errors) ? data.errors : [];

      // 에러 매핑 (adId + type + newBid/status 기준으로 매칭)
      const errorMap = new Map();
      for (const e of errors) {
        const it = e.item || {};
        const keyParts = [];
        if (it.adId) keyParts.push(it.adId);
        if (it.type) keyParts.push(it.type);
        if (it.newBid !== undefined) keyParts.push(`bid:${it.newBid}`);
        if (it.status) keyParts.push(`status:${it.status}`);
        const key = keyParts.join("|") || JSON.stringify(it);
        errorMap.set(key, e);
      }

      // 로그 row 구성
      const logs = items.map((it) => {
        const keyParts = [];
        if (it.adId) keyParts.push(it.adId);
        if (it.type) keyParts.push(it.type);
        if (it.newBid !== undefined) keyParts.push(`bid:${it.newBid}`);
        if (it.status) keyParts.push(`status:${it.status}`);
        const key = keyParts.join("|") || JSON.stringify(it);

        const err = errorMap.get(key);
        return {
          adId: it.adId || "",
          type: it.type || "",
          newBid: it.newBid ?? "",
          status: it.status ?? "",
          result: err ? "FAIL" : "SUCCESS",
          errorMessage: err?.error || "",
          httpStatus: err?.status ?? "",
        };
      });

      setApplyLogRows(logs);
      setApplyResult({ total, success, fail });
      setIsApplyModalOpen(true); // ✅ 모달 열기
    } catch (e) {
      console.error(e);
      setApplyError(String(e.message || e));
      setIsApplyModalOpen(true); // 에러도 모달로 보여줌
    } finally {
      setApplyLoading(false);
    }
  }


  // ✅ 적용 결과 로그를 CSV로 다운로드
  function downloadApplyLogCsv() {
    if (!applyLogRows || !applyLogRows.length) return;

    const headers = [
      "adId",
      "type",
      "newBid",
      "status",
      "result",
      "errorMessage",
      "httpStatus",
    ];

    const lines = [];

    // 헤더
    lines.push(headers.join(","));

    // 각 row
    for (const row of applyLogRows) {
      const line = headers
        .map((key) => {
          let val = row[key] ?? "";
          if (val === null || val === undefined) val = "";
          val = String(val);

          // CSV 이스케이프 (",", 줄바꿈, 따옴표 처리)
          if (
            val.includes(",") ||
            val.includes("\n") ||
            val.includes('"')
          ) {
            val = `"${val.replace(/"/g, '""')}"`;
          }
          return val;
        })
        .join(",");

      lines.push(line);
    }

    const csv = lines.join("\n");
    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.href = url;
    a.download = `bulk_action_log_${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }


  // 🚀 STEP1: 소재 데이터 조회
  async function loadBulk() {
    try {
      setErr("");
      setLoading(true);
      setRows([]);

      const res = await fetch(
        `/api/naver/ad-summary?start=${start}&end=${end}`
      );
      const j = await res.json();

      if (!res.ok || j.error) {
        throw new Error(j.error || `조회 실패 (${res.status})`);
      }

      if (Array.isArray(j)) {
        setRows(j);
      } else {
        setRows([]);
      }
    } catch (e) {
      console.error(e);
      setRows([]);
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

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
        <div
          style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}
        >
          <h2 style={{ fontSize: 14, fontWeight: 600 }}>
            1. 기간 선택 & 데이터 로드
          </h2>
          <span style={{ fontSize: 11, color: "#6b7280" }}>
            {rows.length
              ? `조회된 소재 수: ${rows.length.toLocaleString("ko-KR")}개`
              : "* 먼저 기간을 선택하고 '소재 데이터 조회'를 눌러주세요"}
          </span>
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
            style={{
              ...btn,
              background: "#1d4ed8",
              borderColor: "#1d4ed8",
              fontWeight: 600,
            }}
            onClick={loadBulk}
            disabled={loading}
          >
            {loading ? "조회 중…" : "소재 데이터 조회"}
          </button>
        </div>

        {err && (
          <div style={{ fontSize: 12, color: "#fca5a5", marginBottom: 8 }}>
            * {err}
          </div>
        )}

        {/* 데이터 요약 박스 */}
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
            조회된 기간 기준 소재 성과 요약 (합계 / 일평균)
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 8,
              fontSize: 12,
            }}
          >
            <BulkSummaryItem label="총 비용" value={fmtKRW(summary.total.cost)} />
            <BulkSummaryItem
              label="총 전환수"
              value={fmtNum(summary.total.conv)}
            />
            <BulkSummaryItem
              label="총 전환매출"
              value={fmtKRW(summary.total.convAmt)}
            />
            <BulkSummaryItem
              label="ROAS"
              value={fmtPct(summary.total.roas)}
            />
            <BulkSummaryItem
              label="총 주 전환수"
              value={fmtNum(summary.total.mainConv)}
            />
            <BulkSummaryItem
              label="총 주 전환매출"
              value={fmtKRW(summary.total.mainConvAmt)}
            />
            <BulkSummaryItem
              label="주 ROAS"
              value={fmtPct(summary.total.mainRoas)}
            />
            <BulkSummaryItem
              label="일평균 비용"
              value={fmtKRW(summary.daily.cost)}
            />
            <BulkSummaryItem
              label="일평균 전환수"
              value={fmtNum(summary.daily.conv)}
            />
            <BulkSummaryItem
              label="일평균 전환매출"
              value={fmtKRW(summary.daily.convAmt)}
            />
            <BulkSummaryItem
              label="일평균 ROAS"
              value={fmtPct(summary.daily.roas)}
            />
            <BulkSummaryItem
              label="일평균 주 전환수"
              value={fmtNum(summary.daily.mainConv)}
            />
            <BulkSummaryItem
              label="일평균 주 전환매출"
              value={fmtKRW(summary.daily.mainConvAmt)}
            />
            <BulkSummaryItem
              label="일평균 주 ROAS"
              value={fmtPct(summary.daily.mainRoas)}
            />
          </div>
        </div>

        {/* STEP1 결과 테이블 */}
        <div style={{ marginTop: 16 }}>
          {rows.length === 0 && !loading && (
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              아직 조회된 데이터가 없습니다.
            </div>
          )}

          {rows.length > 0 && (
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table
                style={{
                  borderCollapse: "collapse",
                  width: "100%",
                  minWidth: 1000,
                  background: "#020617",
                }}
              >
                <thead>
                  <tr>
                    <th style={thStyle}>이름</th>
                    <th style={thStyle}>광고 ID</th>
                    <th style={thStyle}>상품 ID</th>
                    <th style={thStyle}>입찰가</th>
                    <th style={thStyle}>노출수</th>
                    <th style={thStyle}>클릭수</th>
                    <th style={thStyle}>광고비</th>
                    <th style={thStyle}>전환수</th>
                    <th style={thStyle}>전환매출</th>
                    <th style={thStyle}>ROAS</th>
                    <th style={thStyle}>주 전환수</th>
                    <th style={thStyle}>주 전환매출</th>
                    <th style={thStyle}>주 ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => {
                    const roas = calcRoas(r.convAmt, r.cost);

                    const adName = r.adName || "-";
                    const productId = r.mallProductId || "-";
                    const bidAmt = r.bidAmt ?? "-";

                    const main =
                      (mainConvMap && mainConvMap[r.mallProductId]) || {};
                    const mainConv = Number(main.mainccnt) || 0;
                    const mainConvAmt = Number(main.mainconvAmt) || 0;
                    const mainRoasVal =
                      r.cost && r.cost > 0
                        ? `${((mainConvAmt / r.cost) * 100).toFixed(1)}%`
                        : "-";

                    return (
                      <tr
                        key={`${r.adId}-${idx}`}
                        style={{
                          background: idx % 2 === 0 ? "#020617" : "#020617",
                        }}
                      >
                        <td style={tdStyle}>{adName}</td>
                        <td style={tdStyle}>{r.adId}</td>
                        <td style={tdStyle}>{productId}</td>
                        <td style={tdStyle}>{bidAmt}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {fmtNum(r.imp)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {fmtNum(r.clk)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {fmtKRWLocal(Math.round(r.cost || 0))}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {fmtNum(r.convCnt)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {fmtKRWLocal(r.convAmt || 0)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{roas}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {mainConv ? fmtNum(mainConv) : "-"}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {mainConvAmt ? fmtKRWLocal(mainConvAmt) : "-"}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {mainRoasVal}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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

                <span style={{ fontSize: 11, color: "#6b7280" }} />
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

            {/* 액션 상세 설정 */}
            <div style={{ flex: 1, minWidth: 260 }}>
              {actionType === "bid_amount" && (
                <div style={{ fontSize: 12 }}>
                  <div style={{ ...label, marginBottom: 4 }}>입찰가 금액 조정</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select
                      style={{ ...sel, minWidth: 90 }}
                      value={bidAmountMode}
                      onChange={(e) => setBidAmountMode(e.target.value)}
                    >
                      <option value="decrease">감소</option>
                      <option value="increase">증가</option>
                    </select>
                    <input
                      type="number"
                      placeholder="금액 (원)"
                      style={{ ...sel, minWidth: 120 }}
                      value={bidAmountDelta}
                      onChange={(e) => setBidAmountDelta(e.target.value)}
                    />
                    <span style={{ fontSize: 11, color: "#9ca3af" }}>
                      (각 소재의 기존 입찰가 대비 +/- 금액)
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
                      <select
                        style={{ ...sel, minWidth: 90 }}
                        value={bidPercentMode}
                        onChange={(e) => setBidPercentMode(e.target.value)}
                      >
                        <option value="decrease">감소</option>
                        <option value="increase">증가</option>
                      </select>
                      <input
                        type="number"
                        placeholder="변경 비율 (%)"
                        style={{ ...sel, minWidth: 120 }}
                        value={bidPercentDelta}
                        onChange={(e) => setBidPercentDelta(e.target.value)}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {[10, 20, 30, 50].map((p) => (
                        <button
                          key={p}
                          type="button"
                          style={btn}
                          onClick={() => {
                            setBidPercentDelta(String(p));
                          }}
                        >
                          {p}%
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {actionType === "onoff" && (
                <div style={{ fontSize: 12 }}>
                  <div style={{ ...label, marginBottom: 4 }}>소재 ON/OFF 전환</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select
                      style={{ ...sel, minWidth: 140 }}
                      value={onoffMode}
                      onChange={(e) => setOnoffMode(e.target.value)}
                    >
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

        {/* 현재 조건에 해당하는 대상 요약 */}
        <div
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 10,
            border: "1px solid #1f2937",
            background: "#020617",
          }}
        >
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
            현재 설정된 조건에 해당하는 소재 대상 요약
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>
            전체 {rows.length.toLocaleString("ko-KR")}개 중{" "}
            <span style={{ color: "#e5e7eb" }}>
              {filtered.rows.length.toLocaleString("ko-KR")}개
            </span>{" "}
            가 조건을 만족합니다.
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 8,
              fontSize: 12,
            }}
          >
            <BulkSummaryItem
              label="대상 광고비 합계"
              value={fmtKRW(filtered.summary.total.cost)}
            />
            <BulkSummaryItem
              label="대상 전환수 합계"
              value={fmtNum(filtered.summary.total.conv)}
            />
            <BulkSummaryItem
              label="대상 전환매출 합계"
              value={fmtKRW(filtered.summary.total.convAmt)}
            />
            <BulkSummaryItem
              label="대상 ROAS"
              value={
                Number.isFinite(filtered.summary.total.roas)
                  ? `${filtered.summary.total.roas.toFixed(1)}%`
                  : "-"
              }
            />
            <BulkSummaryItem
              label="대상 주 전환수"
              value={fmtNum(filtered.summary.total.mainConv)}
            />
            <BulkSummaryItem
              label="대상 주 전환매출"
              value={fmtKRW(filtered.summary.total.mainConvAmt)}
            />
            <BulkSummaryItem
              label="대상 주 ROAS"
              value={
                Number.isFinite(filtered.summary.total.mainRoas)
                  ? `${filtered.summary.total.mainRoas.toFixed(1)}%`
                  : "-"
              }
            />
          </div>
        </div>
      </section>

      {/* STEP 3: 프리뷰 & 시뮬레이션 */}
      <section style={wrapBox}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
          3. 프리뷰 & 시뮬레이션
        </h2>
        <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 10 }}>
          설정한 룰에 해당하는 소재 목록과, 시뮬레이션 계수(k, t)를 적용했을 때의
          BEFORE / AFTER 성과를 비교해서 최종 적용 여부를 판단합니다.
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
            시뮬레이션 계수 (k, t)
          </div>

          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>
            - <strong>k</strong>: 광고비에 곱해지는 배수 (예: k=1.2 → 광고비는 입찰가보다 20% 더 민감하게 움직임) <br />
            - <strong>t</strong>: 전환수/전환매출에 곱해지는 증가율 (예: t=0.5 → 전환은 광고비의 50% 만큼만 따라감)
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12 }}>
            <div>
              <div style={label}>성과 민감도 k</div>
              <input
                type="number"
                step="0.7"
                value={kParam}
                onChange={(e) => setKParam(Number(e.target.value))}
                style={{ ...sel, minWidth: 80 }}
              />
            </div>
            <div>
              <div style={label}>ROAS 기울기 t</div>
              <input
                type="number"
                step="0.7"
                value={tParam}
                onChange={(e) => setTParam(Number(e.target.value))}
                style={{ ...sel, minWidth: 80 }}
              />
            </div>
            <button
              style={btn}
              onClick={() => {
                setKParam(0.7);
                setTParam(0.7);
              }}
            >
              기본값으로 초기화 (k=0.7, t=0.7)
            </button>
          </div>
        </div>

        {/* 대상 개요 + BEFORE/AFTER 테이블들 */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px, 1.1fr) minmax(260px, 1.4fr)",
            gap: 12,
            alignItems: "flex-start",
          }}
        >
          {/* 대상 개요 (BEFORE 기준) */}
          <div
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid #1f2937",
              background: "#020617",
              fontSize: 12,
            }}
          >
            <div style={{ ...label, marginBottom: 4 }}>액션 대상 개요 (BEFORE 기준)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div>
                선택된 조건에 해당하는 소재 수:{" "}
                <strong>{filtered.rows.length.toLocaleString("ko-KR")}</strong> 개
              </div>
              <div>
                대상 기간 광고비 합계:{" "}
                <strong>{fmtKRW(filtered.summary.total.cost)}</strong>
              </div>
              <div>
                대상 기간 전환수/매출:{" "}
                <strong>
                  {fmtNum(filtered.summary.total.conv)} /{" "}
                  {fmtKRW(filtered.summary.total.convAmt)}
                </strong>
              </div>
              <div>
                대상 ROAS / 주 ROAS:{" "}
                <strong>
                  {Number.isFinite(filtered.summary.total.roas)
                    ? `${filtered.summary.total.roas.toFixed(1)}%`
                    : "-"}
                  {" / "}
                  {Number.isFinite(filtered.summary.total.mainRoas)
                    ? `${filtered.summary.total.mainRoas.toFixed(1)}%`
                    : "-"}
                </strong>
              </div>
            </div>
          </div>

          {/* 전체 BEFORE / AFTER 요약 */}
          <div
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid #1f2937",
              background: "#020617",
              fontSize: 12,
            }}
          >
            <div style={{ ...label, marginBottom: 4 }}>
              전체 성과 BEFORE / AFTER (기간 합계 기준)
            </div>
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
                {[
                  "광고비",
                  "전환수",
                  "전환매출",
                  "ROAS",
                  "주 전환수",
                  "주 전환매출",
                  "주 ROAS",
                ].map((metric) => {
                  if (!simulation) {
                    return (
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
                    );
                  }

                  const bt = simulation.beforeAll;
                  const at = simulation.afterAll;

                  let beforeVal = "-";
                  let afterVal = "-";
                  let diffVal = "-";

                  let beforeNum = 0;
                  let afterNum = 0;

                  switch (metric) {
                    case "광고비":
                      beforeNum = bt.cost;
                      afterNum = at.cost;
                      beforeVal = fmtKRW(beforeNum);
                      afterVal = fmtKRW(afterNum);
                      break;
                    case "전환수":
                      beforeNum = bt.conv;
                      afterNum = at.conv;
                      beforeVal = fmtNum(beforeNum);
                      afterVal = fmtNum(afterNum);
                      break;
                    case "전환매출":
                      beforeNum = bt.convAmt;
                      afterNum = at.convAmt;
                      beforeVal = fmtKRW(beforeNum);
                      afterVal = fmtKRW(afterNum);
                      break;
                    case "ROAS":
                      beforeNum = bt.roas;
                      afterNum = at.roas;
                      beforeVal = Number.isFinite(beforeNum)
                        ? `${beforeNum.toFixed(1)}%`
                        : "-";
                      afterVal = Number.isFinite(afterNum)
                        ? `${afterNum.toFixed(1)}%`
                        : "-";
                      break;
                    case "주 전환수":
                      beforeNum = bt.mainConv;
                      afterNum = at.mainConv;
                      beforeVal = fmtNum(beforeNum);
                      afterVal = fmtNum(afterNum);
                      break;
                    case "주 전환매출":
                      beforeNum = bt.mainConvAmt;
                      afterNum = at.mainConvAmt;
                      beforeVal = fmtKRW(beforeNum);
                      afterVal = fmtKRW(afterNum);
                      break;
                    case "주 ROAS":
                      beforeNum = bt.mainRoas;
                      afterNum = at.mainRoas;
                      beforeVal = Number.isFinite(beforeNum)
                        ? `${beforeNum.toFixed(1)}%`
                        : "-";
                      afterVal = Number.isFinite(afterNum)
                        ? `${afterNum.toFixed(1)}%`
                        : "-";
                      break;
                    default:
                      break;
                  }

                  const diff = afterNum - beforeNum;
                  if (Number.isFinite(diff)) {
                    if (metric.includes("ROAS")) {
                      diffVal = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%p`;
                    } else if (metric === "광고비" || metric.includes("매출")) {
                      diffVal = diff > 0 ? `+${fmtKRW(diff)}` : fmtKRW(diff);
                    } else {
                      diffVal = diff > 0 ? `+${fmtNum(diff)}` : fmtNum(diff);
                    }
                  }

                  return (
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
                        {beforeVal}
                      </td>
                      <td
                        style={{
                          padding: "4px",
                          textAlign: "right",
                          borderBottom: "1px solid #0b1120",
                        }}
                      >
                        {afterVal}
                      </td>
                      <td
                        style={{
                          padding: "4px",
                          textAlign: "right",
                          borderBottom: "1px solid #0b1120",
                          color: "#a5b4fc",
                        }}
                      >
                        {diffVal}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 대상만 BEFORE / AFTER 요약 (옵션) */}
        <div
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 10,
            border: "1px solid #1f2937",
            background: "#020617",
            fontSize: 12,
          }}
        >
          <div style={{ ...label, marginBottom: 4 }}>
            액션 대상만 BEFORE / AFTER (기간 합계 기준)
          </div>
          {!simulation || !simulation.beforeTarget ? (
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              조건에 해당하는 대상 소재가 없습니다.
            </div>
          ) : (
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
                    BEFORE(대상)
                  </th>
                  <th
                    style={{
                      textAlign: "right",
                      padding: "6px 4px",
                      borderBottom: "1px solid #1f2937",
                    }}
                  >
                    AFTER(대상)
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
                {[
                  "광고비",
                  "전환수",
                  "전환매출",
                  "ROAS",
                  "주 전환수",
                  "주 전환매출",
                  "주 ROAS",
                ].map((metric) => {
                  const bt = simulation.beforeTarget;
                  const at = simulation.afterTarget;

                  let beforeVal = "-";
                  let afterVal = "-";
                  let diffVal = "-";

                  let beforeNum = 0;
                  let afterNum = 0;

                  switch (metric) {
                    case "광고비":
                      beforeNum = bt.cost;
                      afterNum = at.cost;
                      beforeVal = fmtKRW(beforeNum);
                      afterVal = fmtKRW(afterNum);
                      break;
                    case "전환수":
                      beforeNum = bt.conv;
                      afterNum = at.conv;
                      beforeVal = fmtNum(beforeNum);
                      afterVal = fmtNum(afterNum);
                      break;
                    case "전환매출":
                      beforeNum = bt.convAmt;
                      afterNum = at.convAmt;
                      beforeVal = fmtKRW(beforeNum);
                      afterVal = fmtKRW(afterNum);
                      break;
                    case "ROAS":
                      beforeNum = bt.roas;
                      afterNum = at.roas;
                      beforeVal = Number.isFinite(beforeNum)
                        ? `${beforeNum.toFixed(1)}%`
                        : "-";
                      afterVal = Number.isFinite(afterNum)
                        ? `${afterNum.toFixed(1)}%`
                        : "-";
                      break;
                    case "주 전환수":
                      beforeNum = bt.mainConv;
                      afterNum = at.mainConv;
                      beforeVal = fmtNum(beforeNum);
                      afterVal = fmtNum(afterNum);
                      break;
                    case "주 전환매출":
                      beforeNum = bt.mainConvAmt;
                      afterNum = at.mainConvAmt;
                      beforeVal = fmtKRW(beforeNum);
                      afterVal = fmtKRW(afterNum);
                      break;
                    case "주 ROAS":
                      beforeNum = bt.mainRoas;
                      afterNum = at.mainRoas;
                      beforeVal = Number.isFinite(beforeNum)
                        ? `${beforeNum.toFixed(1)}%`
                        : "-";
                      afterVal = Number.isFinite(afterNum)
                        ? `${afterNum.toFixed(1)}%`
                        : "-";
                      break;
                    default:
                      break;
                  }

                  const diff = afterNum - beforeNum;
                  if (Number.isFinite(diff)) {
                    if (metric.includes("ROAS")) {
                      diffVal = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%p`;
                    } else if (metric === "광고비" || metric.includes("매출")) {
                      diffVal = diff > 0 ? `+${fmtKRW(diff)}` : fmtKRW(diff);
                    } else {
                      diffVal = diff > 0 ? `+${fmtNum(diff)}` : fmtNum(diff);
                    }
                  }

                  return (
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
                        {beforeVal}
                      </td>
                      <td
                        style={{
                          padding: "4px",
                          textAlign: "right",
                          borderBottom: "1px solid #0b1120",
                        }}
                      >
                        {afterVal}
                      </td>
                      <td
                        style={{
                          padding: "4px",
                          textAlign: "right",
                          borderBottom: "1px solid #0b1120",
                          color: "#a5b4fc",
                        }}
                      >
                        {diffVal}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 적용 버튼 영역 */}
                {/* 적용 결과 / 에러 표시 */}
        {applyError && (
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              color: "#fca5a5",
            }}
          >
            * {applyError}
          </div>
        )}
        {applyResult && (
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              color: "#a5b4fc",
            }}
          >
            적용 완료: 총 {applyResult.total}개 중{" "}
            {applyResult.success}개 성공, {applyResult.fail}개 실패
          </div>
        )}

        {/* 적용 버튼 영역 */}
                <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 12,
          }}
        >
          <button style={{ ...btn, background: "#111827" }}>취소</button>
          <button
            style={{
              ...btn,
              background: "#16a34a",
              borderColor: "#16a34a",
              fontWeight: 600,
            }}
            disabled={!filtered.rows.length || applyLoading}
            onClick={handleApplyBulk}
          >
            {applyLoading
              ? "적용 중…"
              : `적용하기 (${filtered.rows.length.toLocaleString("ko-KR")}개 소재)`}
          </button>
        </div>


      </section>
            {isApplyModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
        >
          <div
            style={{
              background: "#020617",
              border: "1px solid #1f2937",
              borderRadius: 12,
              padding: 16,
              minWidth: 320,
              maxWidth: 480,
              boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
            }}
          >
            <h3
              style={{
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 8,
                color: "#e5e7eb",
              }}
            >
              일괄 적용 결과
            </h3>

            {applyResult ? (
              <div
                style={{
                  fontSize: 12,
                  color: "#e5e7eb",
                  marginBottom: 12,
                  lineHeight: 1.6,
                }}
              >
                <div>
                  총 처리 건수:{" "}
                  <strong>
                    {applyResult.total.toLocaleString("ko-KR")}개
                  </strong>
                </div>
                <div>
                  성공:{" "}
                  <strong>
                    {applyResult.success.toLocaleString("ko-KR")}개
                  </strong>
                </div>
                <div>
                  실패:{" "}
                  <strong>
                    {applyResult.fail.toLocaleString("ko-KR")}개
                  </strong>
                </div>
              </div>
            ) : (
              <div
                style={{
                  fontSize: 12,
                  color: "#e5e7eb",
                  marginBottom: 12,
                }}
              >
                처리 결과를 불러오지 못했습니다.
              </div>
            )}

            {applyError && (
              <div
                style={{
                  fontSize: 11,
                  color: "#fca5a5",
                  marginBottom: 8,
                }}
              >
                * {applyError}
              </div>
            )}

            {applyLogRows && applyLogRows.length > 0 && (
              <button
                type="button"
                onClick={downloadApplyLogCsv}
                style={{
                  ...btn,
                  width: "100%",
                  marginBottom: 8,
                  textAlign: "center",
                  background: "#1d4ed8",
                  borderColor: "#1d4ed8",
                  fontWeight: 600,
                }}
              >
                로그 CSV 다운로드
              </button>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 4,
              }}
            >
              <button
                type="button"
                style={{ ...btn }}
                onClick={() => setIsApplyModalOpen(false)}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

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
      <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
