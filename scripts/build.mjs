#!/usr/bin/env node
// Builds the static Stremio addon into ./dist from TMDB data.
//   TMDB_API_KEY=... node scripts/build.mjs
// Optional env: SITE_URL (public base URL, used on the install page), OUT_DIR, CACHE_FILE.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config as defaultConfig, services as defaultServices } from "../services.config.mjs";
import { createClient, openCache, mapLimit } from "../src/tmdb.mjs";
import {
  buildManifest, catalogPaths, flattenReleases, judgeMovie, judgeSeries,
  matchProviders, paginate, pickNetwork, toMeta,
} from "../src/lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOUR = 3600e3, DAY = 24 * HOUR;

export async function build({
  apiKey = process.env.TMDB_API_KEY,
  fetchImpl = globalThis.fetch,
  outDir = process.env.OUT_DIR || join(root, "dist"),
  cacheFile = process.env.CACHE_FILE || join(root, ".cache", "tmdb.json"),
  siteUrl = process.env.SITE_URL || "",
  config = defaultConfig,
  services = defaultServices,
  now = Date.now(),
  log = console.log,
} = {}) {
  const tmdb = createClient({ apiKey, fetchImpl });
  const cache = await openCache(cacheFile, now);
  const today = new Date(now).toISOString().slice(0, 10);
  const lang = config.language;
  const warnings = [];
  const warn = (m) => { warnings.push(m); log(`  ! ${m}`); };
  const report = { builtAt: new Date(now).toISOString(), services: {} };

  // ---- 1. Resolve networks (series) and providers (movies) -------------------
  log("Resolving networks and providers…");
  const providerList = cache.get("providers:" + config.region, 7 * DAY)
    ?? (await tmdb.get("/watch/providers/movie", { watch_region: config.region, language: lang }))?.results ?? [];
  cache.set("providers:" + config.region, providerList);

  async function resolveNetwork(net) {
    if (net.id) {
      const n = await tmdb.get(`/network/${net.id}`);
      if (!n) throw new Error(`Network id ${net.id} (${net.label}) not found on TMDB.`);
      if (!net.match.test(n.name)) throw new Error(`Network id ${net.id} is "${n.name}" on TMDB, which doesn't match ${net.match} for ${net.label}.`);
      return { id: n.id, name: n.name, via: "pinned id" };
    }
    const key = `net:${net.label}:${net.match}`;
    const cached = cache.get(key, 30 * DAY);
    if (cached) return cached;
    for (const [query, year] of net.anchors) {
      const s = await tmdb.get("/search/tv", { query, first_air_date_year: year, language: lang });
      for (const show of (s?.results ?? []).slice(0, 3)) {
        const d = await tmdb.get(`/tv/${show.id}`, { language: lang });
        const n = pickNetwork(d?.networks, net.match);
        if (n) {
          const found = { id: n.id, name: n.name, via: `${d.name} (${year})` };
          cache.set(key, found);
          return found;
        }
      }
    }
    return null;
  }

  const resolved = [];
  for (const svc of services) {
    const networks = [];
    for (const net of svc.networks) {
      const r = await resolveNetwork(net);
      if (r) networks.push({ label: net.label, ...r });
      else warn(`${svc.name}: couldn't resolve network "${net.label}" from its anchor shows; skipped.`);
    }
    const providerIds = matchProviders(providerList, svc.providers, svc.pinnedProviderIds);
    const providerNames = providerList.filter((p) => providerIds.includes(p.provider_id)).map((p) => p.provider_name);
    if (!providerIds.length) warn(`${svc.name}: no ${config.region} watch provider matched; movie catalog will be empty.`);
    resolved.push({ svc, networkIds: [...new Set(networks.map((n) => n.id))], networks, providerIds, providerNames });
    log(`  ${svc.name}: networks [${networks.map((n) => `${n.name}=${n.id}`).join(", ") || "none"}], providers [${providerNames.join(", ") || "none"}]`);
  }

  // ---- 2. Discover candidates -----------------------------------------------
  async function discover(path, params, limit) {
    const out = [], seen = new Set();
    for (let page = 1; page <= 500 && out.length < limit; page++) {
      const r = await tmdb.get(path, { ...params, page });
      for (const item of r?.results ?? []) if (!seen.has(item.id)) { seen.add(item.id); out.push(item); }
      if (!r || page >= (r.total_pages ?? 0)) break;
    }
    return out.slice(0, limit);
  }

  async function seriesFor({ svc, networkIds }) {
    const tally = {};
    if (!networkIds.length) return { metas: [], tally, candidates: 0 };
    const candidates = await discover("/discover/tv", {
      with_networks: networkIds.join("|"),
      sort_by: "popularity.desc",
      "vote_count.gte": config.minVotes,
      "first_air_date.lte": config.includeUnaired ? undefined : today,
      include_null_first_air_dates: false,
      include_adult: false,
      language: lang,
    }, Math.ceil(config.maxSeriesPerService * 1.5));

    const details = await mapLimit(candidates, 16, async (item) => {
      const key = `tv:${item.id}`;
      let d = cache.get(key, 7 * DAY);
      if (d && !d.imdb && !cache.get(key, 2 * DAY)) d = undefined; // retry missing IMDb ids sooner
      if (!d) {
        const r = await tmdb.get(`/tv/${item.id}`, { append_to_response: "external_ids", language: lang });
        d = { imdb: r?.external_ids?.imdb_id || null, networks: (r?.networks ?? []).map((n) => n.id) };
        cache.set(key, d);
      }
      return d;
    });

    const metas = [], seen = new Set();
    candidates.forEach((item, i) => {
      const d = details[i];
      const v = judgeSeries(d.networks, networkIds, config.seriesFirstNetworkOnly !== false);
      const reason = !v.ok ? v.reason : !d.imdb ? "no-imdb-id" : seen.has(d.imdb) ? "duplicate" : "kept";
      tally[reason] = (tally[reason] ?? 0) + 1;
      if (reason === "kept" && metas.length < config.maxSeriesPerService) { seen.add(d.imdb); metas.push(toMeta("series", item, d.imdb)); }
    });
    return { metas, tally, candidates: candidates.length };
  }

  async function moviesFor({ svc, providerIds }) {
    const tally = {};
    if (!providerIds.length) return { metas: [], tally, candidates: 0 };
    const strict = svc.strictMovies ?? config.strictMovies;
    const candidates = await discover("/discover/movie", {
      with_watch_providers: providerIds.join("|"),
      watch_region: config.region,
      with_watch_monetization_types: "flatrate|free|ads",
      sort_by: "popularity.desc",
      "vote_count.gte": config.minVotes,
      "primary_release_date.lte": today,
      include_adult: false,
      language: lang,
    }, config.maxMovieCandidatesPerService);

    const details = await mapLimit(candidates, 16, async (item) => {
      const key = `movie:${item.id}`;
      let d = cache.get(key, 14 * DAY);
      if (d && !d.imdb && !cache.get(key, 3 * DAY)) d = undefined;
      if (!d) {
        const r = await tmdb.get(`/movie/${item.id}`, { append_to_response: "release_dates", language: lang });
        d = {
          imdb: r?.imdb_id || null,
          companies: (r?.production_companies ?? []).map((c) => c.name),
          releases: flattenReleases(r?.release_dates),
        };
        cache.set(key, d);
      }
      return d;
    });

    const metas = [], seen = new Set();
    candidates.forEach((item, i) => {
      const d = details[i];
      const v = judgeMovie(d, svc, strict);
      const reason = !v.ok ? v.reason : !d.imdb ? "no-imdb-id" : seen.has(d.imdb) ? "duplicate" : "kept";
      tally[reason] = (tally[reason] ?? 0) + 1;
      if (reason === "kept" && v.reason === "short-theatrical-window") {
        tally["kept-via-theatrical-window"] = (tally["kept-via-theatrical-window"] ?? 0) + 1;
      }
      if (reason === "kept" && metas.length < config.maxMoviesPerService) { seen.add(d.imdb); metas.push(toMeta("movie", item, d.imdb)); }
    });
    return { metas, tally, candidates: candidates.length };
  }

  // Manual per-service corrections: `exclude` drops IMDb ids, `include` adds them
  // (appended after the automatic list) even if the rules or TMDB data miss them.
  async function applyOverrides(type, svc, result) {
    const ov = svc.overrides?.[type];
    if (!ov) return result;
    const exclude = new Set(ov.exclude ?? []);
    let metas = result.metas.filter((m) => !exclude.has(m.id));
    const removed = result.metas.length - metas.length;
    const have = new Set(metas.map((m) => m.id));
    let added = 0;
    for (const imdb of ov.include ?? []) {
      if (have.has(imdb) || exclude.has(imdb)) continue;
      const key = `find:${type}:${imdb}`;
      let item = cache.get(key, 30 * DAY);
      if (item === undefined) {
        const r = await tmdb.get(`/find/${imdb}`, { external_source: "imdb_id", language: lang });
        item = (type === "movie" ? r?.movie_results : r?.tv_results)?.[0] ?? null;
        cache.set(key, item);
      }
      if (!item) { warn(`${svc.name}: override include ${imdb} not found on TMDB as a ${type}.`); continue; }
      metas.push(toMeta(type, item, imdb)); have.add(imdb); added++;
    }
    if (removed) result.tally["excluded-by-override"] = removed;
    if (added) result.tally["included-by-override"] = added;
    return { ...result, metas };
  }

  // ---- 3. Write the static addon -------------------------------------------
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const writeJson = async (rel, data) => {
    const file = join(outDir, rel);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data));
  };

  let total = 0, files = 0;
  for (const r of resolved) {
    log(`Building ${r.svc.name}…`);
    const series = await applyOverrides("series", r.svc, await seriesFor(r));
    const movies = await applyOverrides("movie", r.svc, await moviesFor(r));
    for (const [type, result] of [["series", series], ["movie", movies]]) {
      total += result.metas.length;
      for (const page of paginate(result.metas, config.pageSize)) {
        for (const rel of catalogPaths(type, r.svc.name, page.skip)) { await writeJson(rel, { metas: page.items }); files++; }
      }
    }
    report.services[r.svc.name] = {
      networks: r.networks, providers: r.providerNames,
      series: { kept: series.metas.length, candidates: series.candidates, tally: series.tally },
      movies: { kept: movies.metas.length, candidates: movies.candidates, tally: movies.tally },
    };
    log(`  series ${series.metas.length}/${series.candidates}  movies ${movies.metas.length}/${movies.candidates}`);
  }

  // An empty build usually means TMDB was down or the key is wrong. Failing here
  // stops the workflow from replacing the last good deployment with empty lists.
  if (total === 0) throw new Error("Every catalog came back empty; not publishing. Check the TMDB key and the warnings above.");

  const names = services.map((s) => s.name);
  await writeJson("manifest.json", buildManifest(names));
  await writeFile(join(outDir, ".nojekyll"), "");
  await writeFile(join(outDir, "index.html"), installPage(siteUrl));
  report.warnings = warnings;
  report.tmdb = { ...tmdb.stats(), cache: cache.stats() };
  await writeJson("report.json", report);
  await cache.save();
  log(`Done: ${total} titles, ${files} files, ${tmdb.stats().requests} TMDB requests, ${warnings.length} warning(s).`);
  return report;
}

function installPage(siteUrl) {
  const base = siteUrl.replace(/\/$/, "");
  const manifest = base ? `${base}/manifest.json` : "manifest.json";
  const stremio = base ? manifest.replace(/^https?:\/\//, "stremio://") : "#";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Streaming Originals</title><style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--muted:#666;--accent:#7b5bf2}
@media (prefers-color-scheme:dark){:root{--bg:#111;--fg:#eee;--muted:#999}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
main{max-width:520px}h1{margin:0 0 8px}p{color:var(--muted)}
a.btn{display:inline-block;background:var(--accent);color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;margin-right:8px}
code{word-break:break-all;font-size:14px}</style></head><body><main>
<h1>Streaming Originals</h1>
<p>A Stremio catalog of movies and series that premiered on a streaming service. Find it under Discover → Streaming Originals, then pick a service.</p>
<p><a class="btn" href="${stremio}">Install in Stremio</a><a href="report.json">Build report</a></p>
<p>Or paste this into Stremio's addon search:<br><code>${manifest}</code></p>
</main></body></html>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  build().catch((err) => { console.error(`\nBuild failed: ${err.message}`); process.exit(1); });
}
