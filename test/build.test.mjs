// End-to-end build against a fake TMDB. No API key or network needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../scripts/build.mjs";
import { services, config } from "../services.config.mjs";

// Fake network ids and the names TMDB would show for each configured network label.
const NET = {
  "Netflix": [213, "Netflix"], "Prime Video": [1024, "Prime Video"], "Freevee / IMDb TV": [4, "Amazon Freevee"],
  "HBO": [49, "HBO"], "HBO Max / Max": [3186, "Max"], "Cinemax": [359, "Cinemax"], "Disney+": [2739, "Disney+"],
  "Apple TV+": [2552, "Apple TV+"], "Crunchyroll": [1112, "Crunchyroll"], "Shudder": [2246, "Shudder"],
  "Curiosity Stream": [2349, "CuriosityStream"], "Paramount+": [4330, "Paramount+"], "CBS All Access": [1709, "CBS All Access"],
  "Showtime": [67, "Showtime"], "AMC+": [4661, "AMC+"], "AMC": [174, "AMC"],
  // "Sundance Now" deliberately missing: its anchors won't resolve, to test the warning.
};
const FOX = { id: 19, name: "FOX" };
// Fake company ids and TMDB names for each configured company label.
const CO = { "Apple Studios": [194232, "Apple Studios"], "Amazon Studios": [20580, "Amazon Studios"], "Amazon MGM Studios": [210099, "Amazon MGM Studios"] };

function fakeTmdb() {
  const shows = new Map();   // tmdb id -> { name, networks:[{id,name}], imdb, first_air_date }
  const movies = new Map();  // tmdb id -> { title, imdb, releases, companies, providers:[ids] }
  const anchors = new Map(); // "query|year" -> show id
  let nextId = 1;
  const addShow = (s) => { const id = nextId++; shows.set(id, s); return id; };
  const addMovie = (m) => { const id = nextId++; movies.set(id, m); return id; };

  // Anchor shows. The first AMC+ anchor ("Ragdoll") is missing on purpose to test fallback.
  for (const svc of services) for (const net of svc.networks) {
    const n = NET[net.label];
    if (!n) continue;
    net.anchors.forEach(([q, y], i) => {
      if (q === "Ragdoll") return;
      const id = addShow({ name: q, networks: [{ id: 999, name: "BBC One" }, { id: n[0], name: n[1] }], imdb: `ttanchor${nextId}`, first_air_date: `${y}-01-01` });
      anchors.set(`${q}|${y}`, id);
    });
  }
  const anchorIds = new Set(anchors.values());

  // Anchor films, credited to a decoy studio and the service's own.
  const filmAnchors = new Map(); // "query|year" -> movie id
  for (const svc of services) for (const co of svc.companies ?? []) {
    const [id, name] = CO[co.label];
    for (const [q, y] of co.anchors) {
      filmAnchors.set(`${q}|${y}`, addMovie({ title: q, imdb: null, providers: [], releases: [], companies: [{ id: 5, name: "Plan B" }, { id, name }] }));
    }
  }

  // Netflix series: 231 originals, one moved show, one without IMDb id, one duplicate IMDb id.
  for (let i = 0; i < 231; i++) addShow({ name: `Netflix Show ${i}`, networks: [{ id: 213, name: "Netflix" }], imdb: `ttnfs${i}`, first_air_date: "2020-01-01" });
  addShow({ name: "Lucifer", networks: [FOX, { id: 213, name: "Netflix" }], imdb: "ttlucifer", first_air_date: "2016-01-25" });
  addShow({ name: "No IMDb", networks: [{ id: 213, name: "Netflix" }], imdb: null, first_air_date: "2021-01-01" });
  addShow({ name: "Dupe", networks: [{ id: 213, name: "Netflix" }], imdb: "ttnfs0", first_air_date: "2021-01-01" });
  // One original per historical network to check they're included.
  addShow({ name: "Sopranos-like", networks: [{ id: 49, name: "HBO" }], imdb: "tthbo", first_air_date: "1999-01-10" });
  addShow({ name: "Dexter-like", networks: [{ id: 67, name: "Showtime" }], imdb: "ttsho", first_air_date: "2006-10-01" });
  addShow({ name: "Severance-like", networks: [{ id: 2552, name: "Apple TV+" }], imdb: "ttapple", first_air_date: "2022-02-18" });

  const P = { netflix: 8, prime: 9, max: 1899, disney: 337, appleplus: 350, applestore: 2, crunchy: 283, shudder: 99, curio: 190, para: 531, parasho: 1770, amcplus: 526 };
  const providerList = [
    [P.netflix, "Netflix"], [P.prime, "Amazon Prime Video"], [P.max, "Max"], [P.disney, "Disney Plus"],
    [P.appleplus, "Apple TV Plus"], [P.applestore, "Apple TV"], [P.crunchy, "Crunchyroll"], [P.shudder, "Shudder"],
    [P.curio, "Curiosity Stream"], [P.para, "Paramount Plus"], [P.parasho, "Paramount+ with Showtime"], [P.amcplus, "AMC+"],
  ].map(([provider_id, provider_name]) => ({ provider_id, provider_name }));

  const R = (type, date, note = "") => ({ type, release_date: `${date}T00:00:00.000Z`, note });
  addMovie({ title: "Netflix Film", imdb: "ttnfm1", providers: [P.netflix], releases: [R(4, "2021-01-01", "Netflix")] });
  addMovie({ title: "The Dark Knight", imdb: "tt0468569", providers: [P.netflix], releases: [R(3, "2008-07-18"), R(4, "2008-12-09")] });
  addMovie({ title: "The Irishman", imdb: "tt1302006", providers: [P.netflix], releases: [R(2, "2019-11-01"), R(4, "2019-11-27", "Netflix")] });
  addMovie({ title: "Old Library Film", imdb: "ttold", providers: [P.netflix], releases: [R(4, "2005-05-05")] });
  addMovie({ title: "No Dates", imdb: "ttnodates", providers: [P.netflix], releases: [] });
  addMovie({ title: "Glass Onion", imdb: "tt11564570", providers: [P.netflix], releases: [R(3, "2022-11-23"), R(4, "2022-12-23", "Netflix")] });
  addMovie({ title: "Unwanted Original", imdb: "ttunwanted", providers: [P.netflix], releases: [R(4, "2022-01-01", "Netflix")] });
  addMovie({ title: "HBO Film", imdb: "tthbofilm", providers: [P.max], releases: [R(6, "2020-04-25", "HBO")] });
  addMovie({ title: "Apple Film", imdb: "ttapplefilm", providers: [P.appleplus], releases: [R(4, "2021-12-10", "Apple TV+")] });
  addMovie({ title: "Store Rental", imdb: "ttrental", providers: [P.applestore], releases: [R(4, "2021-12-10")] });
  // Apple's own film after a six-month cinema run; another studio's with the same pattern.
  addMovie({ title: "F1", imdb: "ttf1", providers: [P.appleplus], releases: [R(3, "2025-06-27"), R(4, "2025-12-11", "Apple TV")], companies: [{ id: 194232, name: "Apple Studios" }] });
  addMovie({ title: "Licensed Hit", imdb: "ttlicensed", providers: [P.appleplus], releases: [R(3, "2025-06-27"), R(4, "2025-12-11", "Apple TV")], companies: [{ id: 33, name: "Universal Pictures" }] });

  let requests = 0;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const page = (items, n) => ({ page: n, total_pages: Math.max(1, Math.ceil(items.length / 20)), results: items.slice((n - 1) * 20, n * 20) });

  async function fetchImpl(url) {
    requests++;
    const u = new URL(url);
    const q = Object.fromEntries(u.searchParams);
    const p = u.pathname.replace(/^\/3/, "");
    if (p === "/watch/providers/movie") return json({ results: providerList });
    if (p === "/search/movie") {
      const id = filmAnchors.get(`${q.query}|${q.primary_release_year}`);
      return json({ results: id ? [{ id, title: q.query }] : [] });
    }
    if (p === "/search/tv") {
      const id = anchors.get(`${q.query}|${q.first_air_date_year}`);
      return json({ results: id ? [{ id, name: q.query }] : [] });
    }
    let m;
    if ((m = p.match(/^\/tv\/(\d+)$/))) {
      const s = shows.get(Number(m[1]));
      if (!s) return json({}, 404);
      return json({ id: Number(m[1]), name: s.name, networks: s.networks, external_ids: { imdb_id: s.imdb } });
    }
    if ((m = p.match(/^\/movie\/(\d+)$/))) {
      const mv = movies.get(Number(m[1]));
      return json({ id: Number(m[1]), title: mv.title, imdb_id: mv.imdb, production_companies: mv.companies ?? [], release_dates: { results: [{ iso_3166_1: "US", release_dates: mv.releases }] } });
    }
    if ((m = p.match(/^\/find\/(tt\w+)$/))) {
      if (m[1] === "ttforced") return json({ movie_results: [{ id: 777, title: "Forced Film", release_date: "2020-02-02", poster_path: "/f.jpg" }], tv_results: [] });
      return json({ movie_results: [], tv_results: [] });
    }
    if (p === "/discover/tv") {
      const want = new Set(q.with_networks.split("|").map(Number));
      const items = [...shows].filter(([id, s]) => !anchorIds.has(id) && s.networks.some((n) => want.has(n.id)))
        .map(([id, s]) => ({ id, name: s.name, first_air_date: s.first_air_date, poster_path: "/p.jpg", overview: "o" }));
      return json(page(items, Number(q.page)));
    }
    if (p === "/discover/movie") {
      const want = new Set(q.with_watch_providers.split("|").map(Number));
      const items = [...movies].filter(([, mv]) => mv.providers.some((x) => want.has(x)))
        .map(([id, mv]) => ({ id, title: mv.title, release_date: "2021-01-01", poster_path: null }));
      return json(page(items, Number(q.page)));
    }
    return json({ status_message: "not found" }, 404);
  }
  return { fetchImpl, requests: () => requests };
}

const read = async (dir, rel) => JSON.parse(await readFile(join(dir, rel), "utf8"));
const cat = (type, value, skip) => `catalog/${type}/streaming-originals/genre=${value}${skip === undefined ? "" : `&skip=${skip}`}.json`;

// Same services, plus overrides on Netflix to exercise them.
const withOverrides = services.map((s) => s.name !== "Netflix" ? s : {
  ...s, overrides: { movie: { include: ["ttforced", "ttmissing"], exclude: ["ttunwanted"] } },
});

test("full build against fake TMDB", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "so-"));
  const outDir = join(tmp, "dist"), cacheFile = join(tmp, ".cache", "tmdb.json");
  const fake = fakeTmdb();
  const report = await build({ apiKey: "test", fetchImpl: fake.fetchImpl, outDir, cacheFile, siteUrl: "https://me.github.io/so", services: withOverrides, log: () => {} });

  // Manifest
  const manifest = await read(outDir, "manifest.json");
  assert.equal(manifest.catalogs.length, 2);
  assert.deepEqual(manifest.catalogs.map((c) => c.type), ["movie", "series"]);
  assert.deepEqual(manifest.catalogs[0].extra[0].options, services.map((s) => s.name));

  // Network resolution: decoy co-network skipped, AMC+ fell back to its second anchor, Sundance Now warned.
  assert.equal(report.services["Netflix"].networks[0].id, 213);
  const amc = report.services["AMC+"].networks.find((n) => n.label === "AMC+");
  assert.equal(amc.id, 4661);
  assert.match(amc.via, /Firebite/);
  assert.ok(report.warnings.some((w) => /Sundance Now/.test(w)));
  assert.deepEqual(report.services["Paramount+"].networks.map((n) => n.id).sort(), [1709, 4330, 67].sort());

  // Netflix series: 231 originals over 3 pages; Lucifer, no-IMDb and duplicate excluded.
  const p0 = (await read(outDir, cat("series", "Netflix"))).metas;
  const p1 = (await read(outDir, cat("series", "Netflix", 100))).metas;
  const p2 = (await read(outDir, cat("series", "Netflix", 200))).metas;
  assert.deepEqual([p0.length, p1.length, p2.length], [100, 100, 31]);
  const all = [...p0, ...p1, ...p2].map((m) => m.id);
  assert.equal(new Set(all).size, 231);
  assert.ok(!all.includes("ttlucifer"));
  assert.equal(report.services["Netflix"].series.tally["moved-to-service"], 1);
  assert.equal(report.services["Netflix"].series.tally["no-imdb-id"], 1);
  assert.equal(report.services["Netflix"].series.tally["duplicate"], 1);
  assert.deepEqual(await read(outDir, cat("series", "Netflix", 0)), await read(outDir, cat("series", "Netflix")));
  // A request without a service gets the default (Netflix), page by page.
  assert.deepEqual(await read(outDir, "catalog/series/streaming-originals.json"), { metas: p0 });
  assert.deepEqual(await read(outDir, "catalog/series/streaming-originals/skip=100.json"), { metas: p1 });
  assert.ok(existsSync(join(outDir, "catalog/movie/streaming-originals.json")));
  assert.equal(p0[0].type, "series");
  assert.match(p0[0].poster, /^https:\/\/image\.tmdb\.org\/t\/p\/w500\//);

  // Historical networks land in the right service.
  assert.deepEqual((await read(outDir, cat("series", "HBO Max"))).metas.map((m) => m.id), ["tthbo"]);
  assert.deepEqual((await read(outDir, cat("series", "Paramount+"))).metas.map((m) => m.id), ["ttsho"]);

  // Netflix movies: true originals + Glass Onion via the theatrical window,
  // overrides applied (forced film appended last, unwanted one removed).
  const nfmMetas = (await read(outDir, cat("movie", "Netflix"))).metas;
  const nfm = nfmMetas.map((m) => m.id);
  assert.deepEqual([...nfm].sort(), ["tt11564570", "tt1302006", "ttforced", "ttnfm1"]);
  assert.equal(nfm.at(-1), "ttforced");
  assert.equal(nfmMetas.at(-1).name, "Forced Film");
  const t = report.services["Netflix"].movies.tally;
  assert.equal(t["kept-via-theatrical-window"], 1);
  assert.equal(t["excluded-by-override"], 1);
  assert.equal(t["included-by-override"], 1);
  assert.ok(report.warnings.some((w) => /ttmissing/.test(w)));
  assert.equal(t["theatrical-first"], 1);
  assert.equal(t["predates-service"], 1);
  assert.equal(t["no-home-release"], 1);
  assert.deepEqual((await read(outDir, cat("movie", "HBO Max"))).metas.map((m) => m.id), ["tthbofilm"]);

  // Apple: special characters, every spelling present; store rentals excluded.
  for (const v of ["Apple TV +", "Apple+TV++", "Apple%20TV%20%2B", "Apple+TV+%2B"]) {
    assert.ok(existsSync(join(outDir, cat("movie", v))), v);
  }
  assert.deepEqual((await read(outDir, cat("movie", "Apple TV +"))).metas.map((m) => m.id), ["ttapplefilm", "ttf1"]);
  assert.equal(report.services["Apple TV +"].movies.tally["kept-via-company"], 1);
  assert.deepEqual(report.services["Apple TV +"].companies.map((c) => c.id), [194232]);
  assert.match(report.services["Apple TV +"].companies[0].via, /F1 \(2025\)/);
  assert.deepEqual(report.services["Prime Video"].companies.map((c) => c.id), [20580, 210099]);
  assert.deepEqual(report.services["Apple TV +"].providers, ["Apple TV Plus"]);
  assert.ok(existsSync(join(outDir, cat("movie", "Disney%2B"))));

  // Paramount+ picks up the Showtime bundle provider too.
  assert.deepEqual(report.services["Paramount+"].providers.sort(), ["Paramount Plus", "Paramount+ with Showtime"]);

  // Empty services still get a valid empty first page.
  assert.deepEqual(await read(outDir, cat("series", "Shudder")), { metas: [] });

  // Site files
  const html = await readFile(join(outDir, "index.html"), "utf8");
  assert.match(html, /stremio:\/\/me\.github\.io\/so\/manifest\.json/);
  assert.ok(existsSync(join(outDir, ".nojekyll")));

  // Second build reuses the cache.
  const first = fake.requests();
  await build({ apiKey: "test", fetchImpl: fake.fetchImpl, outDir, cacheFile, services: withOverrides, log: () => {} });
  const second = fake.requests() - first;
  assert.ok(second < first / 2, `second build made ${second} requests vs ${first}`);
});

test("refuses to publish an empty build", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "so-"));
  const empty = async () => new Response(JSON.stringify({ results: [], total_pages: 0 }), { status: 200 });
  await assert.rejects(
    build({ apiKey: "test", fetchImpl: empty, outDir: join(tmp, "dist"), cacheFile: join(tmp, "c.json"), log: () => {} }),
    /empty/,
  );
});

test("bad key gives a clear error", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "so-"));
  const denied = async () => new Response("{}", { status: 401 });
  await assert.rejects(
    build({ apiKey: "bad", fetchImpl: denied, outDir: join(tmp, "dist"), cacheFile: join(tmp, "c.json"), log: () => {} }),
    /401/,
  );
});
