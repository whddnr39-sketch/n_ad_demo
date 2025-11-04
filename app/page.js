"use client";

import { useState, useEffect } from "react";

export default function Page() {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [level, setLevel] = useState("ads");
  const [campaigns, setCampaigns] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/campaigns")
      .then((r) => r.json())
      .then(setCampaigns);
  }, []);

  const loadGroups = (cid) => {
    setSelectedCampaign(cid);
    if (!cid) return;
    fetch(`/api/adgroups?campaignId=${cid}`)
      .then((r) => r.json())
      .then(setGroups);
  };

  const fetchStats = async () => {
    if (!start || !end) {
      alert("조회 기간을 입력하세요");
      return;
    }

    setLoading(true);
    const url =
      level === "campaigns"
        ? `/api/stats/campaigns?start=${start}&end=${end}`
        : level === "adgroups"
        ? `/api/stats/adgroups?start=${start}&end=${end}&campaignId=${selectedCampaign}`
        : `/api/stats/ads?start=${start}&end=${end}&adgroupId=${selectedGroup}`;

    const res = await fetch(url);
    const json = await res.json();
    setRows(json.rows || []);
    setTotal(json.total || 0);
    setLoading(false);
  };

  return (
    <main className="p-6">
      <h1 className="text-xl font-bold mb-4">네이버 광고비 통계</h1>

      <div className="flex gap-2 mb-4">
        <input
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="border p-2"
        />
        <input
          type="date"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className="border p-2"
        />
        <select value={level} onChange={(e) => setLevel(e.target.value)} className="border p-2">
          <option value="campaigns">캠페인</option>
          <option value="adgroups">광고그룹</option>
          <option value="ads">소재</option>
        </select>

        {level !== "campaigns" && (
          <select
            value={selectedCampaign}
            onChange={(e) => loadGroups(e.target.value)}
            className="border p-2"
          >
            <option value="">캠페인 선택</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        {level === "ads" && (
          <select
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
            className="border p-2"
          >
            <option value="">광고그룹 선택</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}

        <button onClick={fetchStats} className="bg-blue-600 text-white px-4 py-2 rounded">
          {loading ? "조회 중..." : "조회"}
        </button>
      </div>

      <table className="w-full border text-sm">
        <thead>
          <tr className="bg-gray-100 border-b">
            {level === "ads" && (
              <>
                <th className="p-2 border">소재ID</th>
                <th className="p-2 border">썸네일</th>
                <th className="p-2 border">상품명</th>
                <th className="p-2 border">몰상품ID</th>
                <th className="p-2 border">입찰가(원)</th>
              </>
            )}
            <th className="p-2 border">노출수</th>
            <th className="p-2 border">클릭수</th>
            <th className="p-2 border">CTR(%)</th>
            <th className="p-2 border">CPC</th>
            <th className="p-2 border">평균순위</th>
            <th className="p-2 border">비용(원)</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={11} className="text-center p-4 text-gray-500">
                데이터가 없습니다.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id} className="border-b hover:bg-gray-50">
                {level === "ads" && (
                  <>
                    <td className="border p-2 text-gray-600">{r.nccAdId}</td>
                    <td className="border p-2">
                      {r.imageUrl ? (
                        <img
                          src={r.imageUrl}
                          alt="thumbnail"
                          width={56}
                          height={56}
                          className="rounded"
                        />
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="border p-2">
                      {r.productName ? (
                        <span className="font-medium">{r.productName}</span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="border p-2">{r.mallProductId || "-"}</td>
                    <td className="border p-2 text-right">
                      {r.bidAmt ? r.bidAmt.toLocaleString() : "-"}
                    </td>
                  </>
                )}
                <td className="border p-2 text-right">{r.impCnt}</td>
                <td className="border p-2 text-right">{r.clkCnt}</td>
                <td className="border p-2 text-right">{r.ctr}</td>
                <td className="border p-2 text-right">{r.cpc}</td>
                <td className="border p-2 text-right">{r.avgRnk}</td>
                <td className="border p-2 text-right font-semibold">
                  {r.salesAmt?.toLocaleString() || 0}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="text-right mt-4 font-semibold">
        총비용: {total.toLocaleString()} 원
      </div>
    </main>
  );
}
