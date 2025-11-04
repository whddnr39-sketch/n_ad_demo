"use client";
import { useEffect, useMemo, useState } from "react";

/* ---------- utils ---------- */
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

/* ---------- page ---------- */
export default function Page() {
  const yday = useMemo(() => kstYesterdayDash(), []);
  const [start, setStart] = useState(yday);
  const [end, setEnd] = useState(yday);

  const [tab, setTab] = useState("campaign"); // "campaign" | "adgroup" | "ad"

  // 목록 & 선택
  const [campaigns, setCampaigns] = useState([]); // [{id,name,...}]
  const [selectedCampaignIds, setSelectedCampaignIds] = useState(new Set()); // persist across tabs

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // 초기 캠페인 리스트 로딩(이름/ID 용)
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/campaigns");
        const j = await r.json();
        setCampaigns((j.campaigns || []).map(c => ({ id: c.id, name: c.name })));
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  const presets = [
    { label: "어제", range: () => ({ s: yday, e: yday }) },
    { label: "최근 7일", range: () => {
        const e = yday, d = new Date(`${yday}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 6);
        const s = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
        return { s, e };
      }},
    { label: "최근 30일", range: () => {
        const e = yday, d = new Date(`${yday}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 29);
        const s = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
        return { s, e };
      }},
  ];

  // 데이터 조회 (탭/선택/기간에 따라)
  async function query() {
    try {
      setErr(""); setLoading(true);
      let outRows = [], outTotal = 0;

      if (tab === "campaign") {
        const r = await fetch(`/api/stats/campaigns?start=${start}&end=${end}`);
        const j = await r.json(); if (j.error) throw new Error(j.error);
        outRows = j.rows || []; outTotal = j.total || 0;

      } else if (tab === "adgroup") {
        const ids = Array.from(selectedCampaignIds);
        if (ids.length === 0) {
          const r = await fetch(`/api/stats/adgroups?start=${start}&end=${end}`);
          const j = await r.json(); if (j.error) throw new Error(j.error);
          outRows = j.rows || []; outTotal = j.total || 0;
        } else {
          // 선택된 캠페인별 호출 병렬 처리 후 병합
          const CONC = 6;
          for (let i = 0; i < ids.length; i += CONC) {
            const part = ids.slice(i, i + CONC);
            const res = await Promise.all(
              part.map(id => fetch(`/api/stats/adgroups?start=${start}&end=${end}&campaignId=${encodeURIComponent(id)}`).then(r => r.json()))
            );
            for (const j of res) {
              if (j.error) throw new Error(j.error);
              outRows.push(...(j.rows || []));
              outTotal += j.total || 0;
            }
          }
          // 동일 그룹이 중복되진 않지만 혹시 몰라 id 기준 dedupe
          const seen = new Set(); outRows = outRows.filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true)));
          outRows.sort((a,b)=>b.salesAmt-a.salesAmt);
        }

      } else { // tab === "ad"
        const ids = Array.from(selectedCampaignIds);
        if (ids.length === 0) {
          const r = await fetch(`/api/stats/ads?start=${start}&end=${end}`);
          const j = await r.json(); if (j.error) throw new Error(j.error);
          outRows = j.rows || []; outTotal = j.total || 0;
        } else {
          const CONC = 4;
          for (let i = 0; i < ids.length; i += CONC) {
            const part = ids.slice(i, i + CONC);
            const res = await Promise.all(
              part.map(id => fetch(`/api/stats/ads?start=${start}&end=${end}&campaignId=${encodeURIComponent(id)}`).then(r => r.json()))
            );
            for (const j of res) {
              if (j.error) throw new Error(j.error);
              outRows.push(...(j.rows || []));
              outTotal += j.total || 0;
            }
          }
          const seen = new Set(); outRows = outRows.filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true)));
          outRows.sort((a,b)=>b.salesAmt-a.salesAmt);
        }
      }

      setRows(outRows); setTotal(outTotal);
    } catch (e) {
      console.error(e); setRows([]); setTotal(0); setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  // 탭 바꿀 때 자동 조회 (원하면 제거)
  useEffect(() => { query(); /* eslint-disable-next-line */ }, [tab]);

  // 캠페인 선택 토글
  const toggleCampaign = (id) => {
    setSelectedCampaignIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const allCampaignIds = useMemo(() => rows.map(r => r.id), [rows]); // 캠페인 탭에서만 의미
  const allChecked = useMemo(() => {
    if (tab !== "campaign") return false;
    if (!rows.length) return false;
    return rows.every(r => selectedCampaignIds.has(r.id));
  }, [tab, rows, selectedCampaignIds]);

  const toggleAllCampaigns = () => {
    if (tab !== "campaign") return;
    setSelectedCampaignIds(prev => {
      if (allChecked) {
        // 모두 해제
        const next = new Set(prev);
        for (const id of allCampaignIds) next.delete(id);
        return next;
      } else {
        // 모두 선택(현재 페이지 rows 기준)
        const next = new Set(prev);
        for (const id of allCampaignIds) next.add(id);
        return next;
      }
    });
  };

  /* ---------- styles ---------- */
  const page = { minHeight:"100vh", background:"#0b0f1a", color:"#e5e7eb",
    display:"flex", alignItems:"center", justifyContent:"center", padding:24 };
  const card = { width:"min(1180px,95vw)", background:"#0f172a", border:"1px solid #1f2940",
    borderRadius:20, padding:24, boxShadow:"0 10px 30px rgba(0,0,0,0.35)" };
  const box = { background:"#111827", border:"1px solid #1f2937", borderRadius:16, padding:16 };
  const label = { fontSize:12, color:"#9ca3af", marginBottom:6 };
  const sel = { background:"#0b1020", color:"#e5e7eb", border:"1px solid #27324a", borderRadius:10, padding:"10px 12px", fontSize:14 };
  const btn = { height:38, padding:"0 14px", background:"#1f2937", border:"1px solid #2b3a55", borderRadius:10, cursor:"pointer", fontWeight:600 };

  return (
    <div style={page}>
      <div style={card}>
        {/* 헤더 */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
          <h1 style={{ fontSize:18, fontWeight:700 }}>네이버 광고 집계</h1>
          <span style={{ fontSize:12, color:"#93a3b8" }}>KST 기준</span>
        </div>

        {/* 탭 */}
        <div style={{ display:"flex", gap:8, marginBottom:12 }}>
          {[
            {key:"campaign", label:"캠페인"},
            {key:"adgroup", label:"그룹"},
            {key:"ad", label:"소재"},
          ].map(t => (
            <button
              key={t.key}
              onClick={()=>setTab(t.key)}
              style={{
                ...btn,
                background: tab===t.key ? "#25436a" : "#1f2937"
              }}
            >
              {t.label}
              {t.key !== "campaign" && selectedCampaignIds.size>0 && (
                <span style={{ marginLeft:6, fontSize:12, opacity:.8 }}>
                  (선택 캠페인 {selectedCampaignIds.size}개)
                </span>
              )}
            </button>
          ))}
        </div>

        {/* 컨트롤 바 */}
        <div style={{ ...box, marginBottom:16 }}>
          <div style={label}>기간 선택</div>
          <div style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"center" }}>
            <div>
              <div style={{ fontSize:12, color:"#9ca3af", marginBottom:6 }}>시작일</div>
              <input type="date" value={start} max={end} onChange={(e)=>setStart(e.target.value)} style={sel} />
            </div>
            <div>
              <div style={{ fontSize:12, color:"#9ca3af", marginBottom:6 }}>종료일</div>
              <input type="date" value={end} min={start} onChange={(e)=>setEnd(e.target.value)} style={sel} />
            </div>
            <div style={{ display:"flex", gap:8 }}>
              {presets.map(p => (
                <button key={p.label} style={btn} onClick={()=>{ const {s,e}=p.range(); setStart(s); setEnd(e); }}>
                  {p.label}
                </button>
              ))}
            </div>
            <div style={{ marginLeft:"auto" }}>
              <button style={{ ...btn, background:"#25436a" }} onClick={query}>{loading ? "조회 중…" : "조회"}</button>
            </div>
          </div>
          {!!err && <div style={{ marginTop:8, fontSize:12, color:"#fca5a5" }}>* {err}</div>}
        </div>

        {/* 합계 */}
        <div style={{ ...box, marginBottom:16 }}>
          <div style={label}>기간 합계</div>
          <div style={{ fontSize:36, fontWeight:800 }}>{fmtKRW(total)}</div>
        </div>

        {/* 테이블 */}
        <div style={box}>
          <div style={label}>
            {tab === "campaign"
              ? `캠페인 ${rows.length.toLocaleString("ko-KR")}건`
              : tab === "adgroup"
              ? `그룹 ${rows.length.toLocaleString("ko-KR")}건`
              : `소재 ${rows.length.toLocaleString("ko-KR")}건`
            } {loading ? "(로딩…)" : ""}
          </div>

          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ textAlign:"left", background:"#0b1020" }}>
                  <th style={{ padding:"10px 8px", borderBottom:"1px solid #1f2937", width: tab==="campaign" ? 40 : 0 }}>
                    {tab==="campaign" && (
                      <input type="checkbox" checked={allChecked} onChange={toggleAllCampaigns} />
                    )}
                  </th>
                  <th style={{ padding:"10px 8px", borderBottom:"1px solid #1f2937" }}>
                    {tab==="campaign" ? "캠페인" : tab==="adgroup" ? "그룹" : "소재"}
                  </th>
                  <th style={{ padding:"10px 8px", borderBottom:"1px solid #1f2937" }}>노출</th>
                  <th style={{ padding:"10px 8px", borderBottom:"1px solid #1f2937" }}>클릭</th>
                  <th style={{ padding:"10px 8px", borderBottom:"1px solid #1f2937" }}>CTR</th>
                  <th style={{ padding:"10px 8px", borderBottom:"1px solid #1f2937" }}>CPC</th>
                  <th style={{ padding:"10px 8px", borderBottom:"1px solid #1f2937" }}>평균순위</th>
                  <th style={{ padding:"10px 8px", borderBottom:"1px solid #1f2937", textAlign:"right" }}>비용</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td style={{ padding:"8px", borderBottom:"1px solid #1f2937" }}>
                      {tab==="campaign" && (
                        <input
                          type="checkbox"
                          checked={selectedCampaignIds.has(r.id)}
                          onChange={()=>toggleCampaign(r.id)}
                        />
                      )}
                    </td>
                    <td style={{ padding:"8px", borderBottom:"1px solid #1f2937" }}>{r.name}</td>
                    <td style={{ padding:"8px", borderBottom:"1px solid #1f2937" }}>{num(r.impCnt)}</td>
                    <td style={{ padding:"8px", borderBottom:"1px solid #1f2937" }}>{num(r.clkCnt)}</td>
                    <td style={{ padding:"8px", borderBottom:"1px solid #1f2937" }}>{pct(r.ctr)}</td>
                    <td style={{ padding:"8px", borderBottom:"1px solid #1f2937" }}>{num(r.cpc)}</td>
                    <td style={{ padding:"8px", borderBottom:"1px solid #1f2937" }}>{num(r.avgRnk)}</td>
                    <td style={{ padding:"8px", borderBottom:"1px solid #1f2937", textAlign:"right" }}>{fmtKRW(r.salesAmt)}</td>
                  </tr>
                ))}
                {!rows.length && !loading && (
                  <tr><td colSpan={8} style={{ padding:"14px", color:"#9ca3af", textAlign:"center" }}>데이터가 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 안내 */}
          {tab!=="campaign" && selectedCampaignIds.size>0 && (
            <div style={{ marginTop:10, fontSize:12, color:"#93a3b8" }}>
              * 캠페인 {selectedCampaignIds.size}개 기준으로 집계됨
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
