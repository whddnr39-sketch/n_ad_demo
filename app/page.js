"use client";
import { useMemo, useState } from "react";

// 금액 포맷 (KRW)
function formatKRW(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "-";
  return `₩${Math.round(v).toLocaleString("ko-KR")}`;
}

// KST 기준 어제 날짜 라벨 (YYYY-MM-DD)
function kstYesterdayLabel() {
  const now = new Date();
  // 로컬→KST 보정(ms)
  const kstOffsetMs = (9 * 60 + now.getTimezoneOffset()) * 60_000;
  const kstNowMs = now.getTime() + kstOffsetMs;
  const yMs = kstNowMs - 24 * 60 * 60 * 1000;
  const yDate = new Date(yMs);
  const yStr = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(yDate); // 예: 2025. 11. 02.
  const normalized = yStr.replace(/\./g, "").trim().replace(/\s+/g, "-");
  const [yy, mm, dd] = normalized.split("-");
  return `${yy}-${mm}-${dd}`;
}

export default function Page() {
  // 환경변수 기본값 (없으면 0)
  const envDefault = Number(process.env.NEXT_PUBLIC_YDAY_SPEND || 0);
  // 데모 입력값(우측 인풋)
  const [override, setOverride] = useState(envDefault ? String(envDefault) : "");
  const yday = useMemo(() => kstYesterdayLabel(), []);
  const spend = useMemo(() => {
    const input = override?.trim();
    const v = input ? Number(input.replace(/,/g, "")) : envDefault;
    return Number.isFinite(v) ? v : 0;
  }, [override, envDefault]);

  return (
    <div style={{minHeight:"100vh",background:"#0b0f1a",color:"#e5e7eb",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{width:"min(680px,92vw)",background:"#0f172a",border:"1px solid #1f2940",borderRadius:20,padding:24,boxShadow:"0 10px 30px rgba(0,0,0,0.35)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <h1 style={{fontSize:18,fontWeight:700,letterSpacing:0.2}}>어제자 광고비</h1>
          <span style={{fontSize:12,color:"#93a3b8"}}>KST 기준</span>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr",gap:16}}>
          <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:16,padding:20}}>
            <div style={{fontSize:12,color:"#9ca3af",marginBottom:6}}>일자</div>
            <div style={{fontSize:20,fontWeight:700}}>{yday}</div>
          </div>

          <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:16,padding:20}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:12,color:"#9ca3af",marginBottom:6}}>광고비 (합계)</div>
                <div style={{fontSize:32,fontWeight:800,lineHeight:1.1}}>{formatKRW(spend)}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <label style={{fontSize:12,color:"#9ca3af"}}>데모 입력</label>
                <input
                  placeholder="예: 1,234,567"
                  value={override}
                  onChange={(e)=>setOverride(e.target.value)}
                  style={{display:"block",marginTop:6,background:"#0b1020",color:"#e5e7eb",border:"1px solid #27324a",borderRadius:10,padding:"10px 12px",width:180,fontSize:14}}
                />
                <div style={{marginTop:6}}>
                  <button
                    onClick={()=>setOverride("")}
                    style={{fontSize:12,background:"#1f2937",border:"1px solid #2b3a55",padding:"6px 10px",borderRadius:8,cursor:"pointer"}}
                  >
                    env 값 사용
                  </button>
                </div>
              </div>
            </div>
            <div style={{fontSize:12,color:"#6b7280",marginTop:10}}>
              * 실제 API 연동 전까지는 입력란으로 값 데모 가능. 배포 시 <code>NEXT_PUBLIC_YDAY_SPEND</code> 환경변수를 넣으면 기본값으로 표시됩니다.
            </div>
          </div>
        </div>

        <div style={{marginTop:18,fontSize:12,color:"#93a3b8"}}>
          이후 확장: 기간 프리셋 / 캠페인-그룹-소재 계층 / CSV 조인 / Naver API 연동
        </div>
      </div>
    </div>
  );
}
