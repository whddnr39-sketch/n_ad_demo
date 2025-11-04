// app/api/_utils.js
export const runtime = "nodejs";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 429가 오면 Retry-After(초) 헤더를 우선 존중하고,
 * 없으면 1s, 2s, 3s... 기하급수 백오프.
 */
export async function fetchJsonWithRetry(url, options = {}, maxRetry = 4) {
  for (let i = 0; i <= maxRetry; i++) {
    const res = await fetch(url, options);
    if (res.status !== 429) {
      // 정상/기타 에러는 그대로 반환
      const data = await safeJson(res);
      return { status: res.status, data };
    }
    // 429 → 대기 후 재시도
    const ra = Number(res.headers.get("retry-after")) || 0;
    const backoffSec = Math.max(ra, i + 1); // retry-after 우선, 없으면 1,2,3,4...
    await sleep(Math.min(backoffSec, 8) * 1000);
  }
  // 마지막 시도
  const last = await fetch(url, options);
  const data = await safeJson(last);
  return { status: last.status, data };
}

async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}

/** campaignId=ID1,ID2  형태를 배열로 파싱 */
export function parseMultiIds(searchParams, key) {
  const raw = searchParams.get(key);
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** 간단 서버 캐시 (메모리) */
const _cache = globalThis.__STAT_CACHE || (globalThis.__STAT_CACHE = new Map());
export function getCache(key, ttlMs) {
  const v = _cache.get(key);
  if (!v) return null;
  if (Date.now() - v.t > ttlMs) { _cache.delete(key); return null; }
  return v.data;
}
export function setCache(key, data) {
  _cache.set(key, { t: Date.now(), data });
}
