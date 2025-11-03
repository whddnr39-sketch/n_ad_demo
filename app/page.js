"use client";
import { useEffect, useMemo, useState } from "react";

function formatKRW(num) {
  return num.toLocaleString("ko-KR") + "원";
}

function kstYesterdayLabel() {
  const now = new Date();
  const kstMs = now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60_000;
  const y = new Date(kstMs - 24 * 60 * 60 * 1000);
  const yyyy = y.getUTCFullYear();
  const mm = String(y.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(y.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function Page() {
  const [apiData, setApiData] = useState(null);
  const [override, setOverride] = useState("");
  const yday = useMemo(() => kstYesterdayLabel(), []);

  useEffect(() => {
    fetch("/api/spend")
      .then((r) => r.json())
      .then(setApiData)
      .catch(() => setApiData(null));
  }, []);

  const spend = useMemo(() => {
    if (apiData?.total != null) return Number(apiData.total);
    const v = override?.trim() ? Number(override.replace(/,/g, "")) : 0;
    return Number.isFinite(v) ? v : 0;
  }, [apiData, override]);

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-8">
      <h1 className="text-2xl font-bold mb-4">어제자 네이버 광고비</h1>
      <p className="text-gray-600 mb-2">기준일: {yday}</p>
      <p className="text-3xl font-semibold text-green-600">
        {formatKRW(spend)}
      </p>

      <input
        type="text"
        placeholder="직접 입력 (예: 1234567)"
        value={override}
        onChange={(e) => setOverride(e.target.value)}
        className="border rounded p-2 mt-4 text-center"
      />

      {apiData?.perAccount?.length ? (
        <ul className="mt-6 text-sm text-gray-500">
          {apiData.perAccount.map((a) => (
            <li key={a.name}>
              {a.name}: <b>{formatKRW(a.amount)}</b>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}