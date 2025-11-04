"use client";
import { useEffect, useMemo, useRef, useState } from "react";

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

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [preloaded, setPreloaded] = useState(false);

  // 간단 메모리 캐시: key = `${start}:${end}`
  const cacheRef = useRef(new Map());

  // 날짜 바꾸면 캐시 사용 중지(다시 미리 로드 필요)
  useEffect(() => { setPreloaded(false); setRows([]); setTotal(0); }, [start, end]);

  // 프리셋
  const presets = [
    { label: "어제", range: () => ({ s: yday, e: yday }) },
    { label: "최근 7일", range: () => {
        const e = yday; const d = new Date(`${yday}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 6);
        const s = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
        return { s, e };
      } },
    { label: "최근 30일", range: () => {
        const e = yday; const d = new Date(`${yday}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 29);
        const s = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
        return { s, e };
      } },
  ];

  // 캐시에서 보여주기
  function showFromCache(key, which) {
    const bucket = cacheRef.current.get(key);
    if (!bucket) return;
    const j = bucket[which] || { rows: [], total: 0 };
    setRows(j.rows || []);
    setTotal(j.total || 0);
  }

  // 탭 전환 시 캐시만 사용
  function onChangeTab(next) {
    setTab(next);
    const key = `${start}:${end}`;
    if (preloaded && cacheRef.current.has(key)) showFromCache(key, next);
    else { setRows([]); setTotal(0); }
  }

  // 기간 미리 로드(각 엔드포인트 1회 호출 → 캐시에 저장)
  async function preload() {
    try {
      setErr(""); setLoading(true);

      const key = `${start}:${end}`;
      // 이미 캐시가 있으면 재호출 없이 사용
      if (cacheRef.current.has(key)) {
        setPreloaded(true);
        showFromCache(key, tab);
        return;
      }

      const [campRes, grpRes, adRes] = await Promise.all([
        fetch(`/api/stats/campaigns?start=${start}&end=${end}`).then(r=>r.json()),
        fetch(`/api/stats/adgroups?start=${start}&end=${end}`).then(r=>r.json()),
        fetch(`/api/stats/ads?start=${start}&end=${end}`).then(r=>r.json()),
      ]);
      if (campRes.error) throw new Error(campRes.error);
      if (grpRes.error) throw new Error(grpRes.error);
      if (adRes.error) throw new Error(adRes.error);

      cacheRef.current.set(key, {
        campaign: campRes,
        adgroup: grpRes,
        ad: adRes,
      });

      setPreloaded(true);
      showFromCache(key, tab);
    } catch (e) {
      setErr(String(e?.message || e));
      setPreloaded(false);
      setRows([]); setTotal(0);
    } finally { setLoading(false); }
  }

  /* ----- styles ----- */
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
          <h1 style={{ fontSize:18, fontWeight:700 }}>네이버 광고 집계 (기간 미리 로드)</h1>
          <span style={{ fontSize:12, color:"#93a3b8" }}>KST 기준</span>
        </div>

        {/* 기간 & 미리 로드 */}
        <div style={{ ...box, marginBottom:16 }}>
          <div style={{ fontWeight:700, marginBottom:8 }}>Step 1. 기간 선택 후 “미리 로드”</div>
          <div style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"center" }}>
            <div>
              <div style={label}>시작일</div>
              <input type="date" value={start} max={end} onChange={(e)=>setStart(e.target.value)} style={sel} />
            </div>
            <div>
              <div style={label}>종료일</div>
              <input type="date" value={end} min={start} onChange={(e)=>setEnd(e.target.value)} style={sel} />
            </div>
            <div style={{ display:"flex", gap:8 }}>
              {presets.map(p=>(
                <button key={p.label} style={btn} onClick={()=>{ const {s,e}=p.range(); setStart(s); setEnd(e); }}>
                  {p.label}
                </button>
              ))}
            </div>
            <div style={{ marginLeft:"auto" }}>
              <button style={{ ...btn, background:"#25436a" }} onClick={preload}>
                {loading ? "미리 로드 중…" : "미리 로드"}
              </button>
            </div>
          </div>
          <div style={{ marginTop:8, fontSize:13 }}>
            {preloaded ? "✅ 미리 로드 완료 — 탭 전환 시 추가 호출 없이 표시됩니다." : "기간을 선택하고 미리 로드를 실행하세요."}
          </div>
          {!!err && <div style={{ marginTop:8, fontSize:12, color:"#fca5a5" }}>* {err}</div>}
        </div>

        {/* 탭 */}
        <div style={{ display:"flex", gap:8, marginBottom:12 }}>
          {[
            {key:"campaign", label:"캠페인"},
            {key:"adgroup", label:"그룹"},
            {key:"ad", label:"소재"},
          ].map(t=>(
            <button key={t.key} onClick={()=>onChangeTab(t.key)} style={{ ...btn, background: tab===t.key ? "#25436a" : "#1f2937" }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* 합계 */}
        <div style={{ ...box, marginBottom:16, opacity: preloaded ? 1 : 0.6, pointerEvents: preloaded ? "auto" : "none" }}>
          <div style={{ fontSize:12, color:"#9ca3af", marginBottom:6 }}>기간 합계</div>
          <div style={{ fontSize:36, fontWeight:800 }}>{fmtKRW(total)}</div>
        </div>

        {/* 테이블 */}
        <div style={{ ...box, opacity: preloaded ? 1 : 0.5, pointerEvents: preloaded ? "auto" : "none" }}>
          <div style={{ fontSize:12, color:"#9ca3af", marginBottom:6 }}>
            {tab==="campaign" ? "캠페인" : tab==="adgroup" ? "그룹" : "소재"} {rows.length.toLocaleString("ko-KR")}건
            {!preloaded && " — 기간 미리 로드가 필요합니다."}
          </div>

          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ textAlign:"left", background:"#0b1020" }}>
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
                {rows.map(r=>(
                  <tr key={r.id}>
                    <td style={{ padding:"8px", borderBottom:"1px solid #1f2937" }}>{r.name}</td>
                    <td style={{ padding:"8px", borderBottom:"1px solid #1f2937" }}>{num(r.impCnt)}</td>
                    <td style={{ padding:"8px", borderBottom:"1px solid #1f2937" }}>{num(r.clkCnt)}</td>
                    <td style={{ padding:"8px", borderBottom:"1px solid #1f2937" }}>{pct(r.ctr)}</td>
                    <td style={{ padding:"8px", borderBottom:"1px solid #1f2937" }}>{num(r.cpc)}</td>
                    <td style={{ padding:"8px", borderBottom:"1px solid #1f2937" }}>{num(r.avgRnk)}</td>
                    <td style={{ padding:"8px", borderBottom:"1px solid #1f2937", textAlign:"right" }}>{fmtKRW(r.salesAmt)}</td>
                  </tr>
                ))}
                {!rows.length && preloaded && (
                  <tr><td colSpan={7} style={{ padding:"14px", color:"#9ca3af", textAlign:"center" }}>데이터가 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
