// Minimal TMDB v3 client: auth, concurrency limit, retries, and a JSON disk cache.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const BASE = "https://api.themoviedb.org/3";

export function createClient({ apiKey, fetchImpl = globalThis.fetch, concurrency = 16, log = () => {} }) {
  if (!apiKey) throw new Error("TMDB_API_KEY is not set. Use either a v3 API key or a v4 read access token.");
  // v4 read access tokens are JWTs ("eyJ..."); anything else is treated as a v3 key.
  const bearer = apiKey.startsWith("eyJ");
  let active = 0;
  const queue = [];
  let requests = 0;

  const acquire = () => new Promise((res) => (active < concurrency ? (active++, res()) : queue.push(res)));
  const release = () => { const next = queue.shift(); next ? next() : active--; };

  async function get(path, params = {}) {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    if (!bearer) url.searchParams.set("api_key", apiKey);
    const headers = { accept: "application/json", ...(bearer ? { authorization: `Bearer ${apiKey}` } : {}) };

    await acquire();
    try {
      for (let attempt = 1; ; attempt++) {
        requests++;
        let res;
        try {
          res = await fetchImpl(url, { headers });
        } catch (err) {
          if (attempt >= 5) throw err;
          await sleep(500 * 2 ** attempt);
          continue;
        }
        if (res.ok) return res.json();
        if (res.status === 404) return null;
        if (res.status === 401) throw new Error("TMDB rejected the API key (401). Check the TMDB_API_KEY secret.");
        if ((res.status === 429 || res.status >= 500) && attempt < 5) {
          const retryAfter = Number(res.headers?.get?.("retry-after")) || 0;
          await sleep(Math.max(retryAfter * 1000, 500 * 2 ** attempt));
          continue;
        }
        throw new Error(`TMDB ${res.status} for ${path}`);
      }
    } finally {
      release();
    }
  }

  return { get, stats: () => ({ requests }) };
}

/** A key/value cache persisted as one JSON file, with per-entry timestamps. */
export async function openCache(file, now = Date.now()) {
  let data = {};
  try { data = JSON.parse(await readFile(file, "utf8")); } catch { /* first run */ }
  let hits = 0, misses = 0;
  return {
    get(key, maxAgeMs) {
      const e = data[key];
      if (e && now - e.t < maxAgeMs) { hits++; return e.v; }
      misses++;
      return undefined;
    },
    set(key, v) { data[key] = { t: now, v }; },
    async save() {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(data));
    },
    stats: () => ({ hits, misses, entries: Object.keys(data).length }),
  };
}

/** Run fn over items with a concurrency cap, keeping order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
