import { test } from "node:test";
import assert from "node:assert/strict";
import {
  judgeMovie, judgeSeries, flattenReleases, valueSpellings, catalogPaths,
  paginate, buildManifest, matchProviders, pickNetwork, RELEASE,
} from "../src/lib.mjs";

const svc = { moviesSince: "2012-01-01", keywords: [/\bnetflix\b/i] };
const rel = (type, date, note = "") => ({ country: "US", type, date: Date.parse(date), note });

test("movie: digital premiere is an original", () => {
  assert.equal(judgeMovie({ releases: [rel(RELEASE.DIGITAL, "2021-03-01", "Netflix")] }, svc).ok, true);
});

test("movie: theatrical first is excluded (The Dark Knight case)", () => {
  const r = judgeMovie({ releases: [rel(RELEASE.THEATRICAL, "2008-07-18"), rel(RELEASE.DIGITAL, "2008-12-09")] }, svc);
  assert.deepEqual(r, { ok: false, reason: "theatrical-first" });
});

test("movie: limited awards run before streaming is allowed", () => {
  const r = judgeMovie({ releases: [rel(RELEASE.LIMITED, "2019-11-01"), rel(RELEASE.DIGITAL, "2019-11-27")] }, svc);
  assert.equal(r.ok, true);
});

test("movie: same-day theatrical elsewhere doesn't disqualify", () => {
  const r = judgeMovie({ releases: [rel(RELEASE.THEATRICAL, "2022-05-01"), rel(RELEASE.DIGITAL, "2022-05-01")] }, svc);
  assert.equal(r.ok, true);
});

test("movie: TV premiere counts as a home premiere (HBO films)", () => {
  assert.equal(judgeMovie({ releases: [rel(RELEASE.TV, "2020-04-25")] }, { moviesSince: "1983-01-01", keywords: [] }).ok, true);
});

test("movie: premiere before the service existed is excluded", () => {
  assert.equal(judgeMovie({ releases: [rel(RELEASE.DIGITAL, "2005-01-01")] }, svc).reason, "predates-service");
});

test("movie: no release data is excluded", () => {
  assert.equal(judgeMovie({ releases: [] }, svc).reason, "no-home-release");
});

test("movie: strict mode needs the service named somewhere", () => {
  const releases = [rel(RELEASE.DIGITAL, "2021-03-01")];
  assert.equal(judgeMovie({ releases, companies: ["Some Studio"] }, svc, true).reason, "no-keyword");
  assert.equal(judgeMovie({ releases, companies: ["Netflix Studios"] }, svc, true).ok, true);
});

test("series: first network decides by default", () => {
  assert.equal(judgeSeries([213], [213]).ok, true);
  assert.equal(judgeSeries([19, 213], [213]).reason, "moved-to-service");
  assert.equal(judgeSeries([19, 213], [213], false).ok, true);
  assert.equal(judgeSeries([], [213]).reason, "no-networks");
});

test("flattenReleases ignores bad dates", () => {
  const out = flattenReleases({ results: [{ iso_3166_1: "US", release_dates: [{ type: 4, release_date: "2021-01-01T00:00:00.000Z", note: "Netflix" }, { type: 3, release_date: "" }] }] });
  assert.equal(out.length, 1);
  assert.equal(out[0].note, "Netflix");
});

test("value spellings cover percent and form encoding", () => {
  assert.deepEqual(valueSpellings("Netflix"), ["Netflix"]);
  assert.deepEqual(new Set(valueSpellings("Apple TV +")), new Set(["Apple TV +", "Apple+TV++", "Apple%20TV%20%2B", "Apple+TV+%2B"]));
  // Every way a client could send it resolves to one of the files, decoded or not.
  for (const sent of [encodeURIComponent("Apple TV +"), "Apple+TV+%2B"]) {
    const spellings = valueSpellings("Apple TV +");
    assert.ok(spellings.includes(sent), `raw ${sent}`);
    assert.ok(spellings.includes(decodeURIComponent(sent)), `decoded ${sent}`);
  }
});

test("catalog paths for first and later pages", () => {
  assert.deepEqual(catalogPaths("movie", "Netflix", 0), [
    "catalog/movie/streaming-originals/genre=Netflix.json",
    "catalog/movie/streaming-originals/genre=Netflix&skip=0.json",
  ]);
  assert.deepEqual(catalogPaths("series", "Netflix", 100), ["catalog/series/streaming-originals/genre=Netflix&skip=100.json"]);
});

test("paginate", () => {
  assert.deepEqual(paginate([], 100), [{ skip: 0, items: [] }]);
  assert.deepEqual(paginate([1, 2, 3], 2).map((p) => p.skip), [0, 2]);
});

test("manifest shape", () => {
  const m = buildManifest(["Netflix", "Disney+"]);
  assert.deepEqual(m.types, ["movie", "series"]);
  assert.deepEqual(m.resources, ["catalog"]);
  for (const c of m.catalogs) {
    assert.equal(c.name, "Streaming Originals");
    assert.deepEqual(c.extra[0], { name: "genre", options: ["Netflix", "Disney+"], isRequired: true });
    assert.deepEqual(c.extra[1], { name: "skip" });
  }
});

test("providers: pinned id only if listed, store excluded", () => {
  const list = [{ provider_id: 2, provider_name: "Apple TV" }, { provider_id: 350, provider_name: "Apple TV" }];
  assert.deepEqual(matchProviders(list, [/^apple tv ?(\+|plus)/i], [350]), [350]);
  assert.deepEqual(matchProviders(list, [/^apple tv ?(\+|plus)/i], [999]), []);
});

test("pickNetwork skips co-networks", () => {
  assert.equal(pickNetwork([{ id: 4, name: "BBC One" }, { id: 213, name: "Netflix" }], /^netflix$/i).id, 213);
});

// ---- Theatrical-window exception, using the real service settings ----------
import { services } from "../services.config.mjs";
const real = (name) => services.find((s) => s.name === name);

test("Glass Onion: one-month cinema run, then Netflix → counts", () => {
  const r = judgeMovie({ releases: [rel(RELEASE.THEATRICAL, "2022-11-23"), rel(RELEASE.DIGITAL, "2022-12-23", "Netflix")] }, real("Netflix"));
  assert.deepEqual(r, { ok: true, reason: "short-theatrical-window" });
});

test("The Dark Knight still excluded: long gap, not tied to Netflix", () => {
  const releases = [rel(RELEASE.THEATRICAL, "2008-07-18"), rel(RELEASE.DIGITAL, "2008-12-09", "iTunes")];
  assert.equal(judgeMovie({ releases }, real("Netflix")).reason, "theatrical-first");
});

test("licensed film labelled Netflix but arriving long after cinemas → excluded", () => {
  const releases = [rel(RELEASE.THEATRICAL, "2023-01-01"), rel(RELEASE.DIGITAL, "2023-11-01", "Netflix")];
  assert.equal(judgeMovie({ releases }, real("Netflix")).reason, "theatrical-first");
});

test("short gap but no link to the service → excluded", () => {
  const releases = [rel(RELEASE.THEATRICAL, "2023-01-01"), rel(RELEASE.DIGITAL, "2023-01-20", "VOD")];
  assert.equal(judgeMovie({ releases }, real("Netflix")).reason, "theatrical-first");
});

test("Killers of the Flower Moon: ~3 month run, Apple Studios → counts for Apple TV +", () => {
  const releases = [rel(RELEASE.THEATRICAL, "2023-10-20"), rel(RELEASE.DIGITAL, "2024-01-12")];
  assert.equal(judgeMovie({ releases, companies: ["Apple Studios", "Imperative Entertainment"] }, real("Apple TV +")).ok, true);
});

test("Apple TV rental-store note doesn't count as Apple TV+", () => {
  const releases = [rel(RELEASE.THEATRICAL, "2023-10-20"), rel(RELEASE.DIGITAL, "2023-11-20", "Apple TV")];
  assert.equal(judgeMovie({ releases, companies: ["Paramount Pictures"] }, real("Apple TV +")).reason, "theatrical-first");
  const plus = [rel(RELEASE.THEATRICAL, "2023-10-20"), rel(RELEASE.DIGITAL, "2023-11-20", "Apple TV+")];
  assert.equal(judgeMovie({ releases: plus }, real("Apple TV +")).ok, true);
});

test("services without the exception still exclude theatrical-first (Disney+/Pixar)", () => {
  const releases = [rel(RELEASE.THEATRICAL, "2023-06-16"), rel(RELEASE.DIGITAL, "2023-09-13", "Disney+")];
  assert.equal(judgeMovie({ releases, companies: ["Pixar"] }, real("Disney+")).reason, "theatrical-first");
});
