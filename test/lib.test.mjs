import { test } from "node:test";
import assert from "node:assert/strict";
import {
  judgeMovie, judgeSeries, flattenReleases, valueSpellings, catalogPaths, defaultCatalogPaths,
  paginate, buildManifest, matchProviders, pickNetwork, RELEASE,
} from "../src/lib.mjs";

const svc = { moviesSince: "2012-01-01", keywords: [/\bnetflix\b/i] };
const rel = (type, date, note = "", country = "US") => ({ country, type, date: Date.parse(date), note });

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
  assert.equal(judgeMovie({ releases, companies: ["Some Studio"] }, svc, { strict: true }).reason, "no-keyword");
  assert.equal(judgeMovie({ releases, companies: ["Netflix Studios"] }, svc, { strict: true }).ok, true);
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

test("default catalog paths have no genre", () => {
  assert.deepEqual(defaultCatalogPaths("movie", 0), ["catalog/movie/streaming-originals.json", "catalog/movie/streaming-originals/skip=0.json"]);
  assert.deepEqual(defaultCatalogPaths("series", 100), ["catalog/series/streaming-originals/skip=100.json"]);
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

test("Killers of the Flower Moon: ~3 month run, rental, then Apple TV+ → counts", () => {
  const releases = [rel(RELEASE.THEATRICAL, "2023-10-18", "", "BE"), rel(RELEASE.THEATRICAL, "2023-10-20"),
    rel(RELEASE.DIGITAL, "2023-12-05"), rel(RELEASE.DIGITAL, "2024-01-11", "Apple TV+")];
  assert.equal(judgeMovie({ releases }, real("Apple TV +"), { region: "US" }).ok, true);
});

test("a production company alone doesn't open the window (rental date isn't the service's)", () => {
  // Project Hail Mary: Amazon MGM in cinemas, rental at 53 days, Prime Video at 107.
  const releases = [rel(RELEASE.THEATRICAL, "2026-03-18", "", "BE"), rel(RELEASE.THEATRICAL, "2026-03-20"),
    rel(RELEASE.DIGITAL, "2026-05-12"), rel(RELEASE.DIGITAL, "2026-07-03", "Prime Video")];
  const r = judgeMovie({ releases, companies: ["Amazon MGM Studios"] }, real("Prime Video"), { region: "US" });
  assert.equal(r.reason, "theatrical-first");
});

test("Interstellar: rental soon after cinemas plus a Prime Video note years later → excluded", () => {
  const releases = [rel(RELEASE.THEATRICAL, "2014-11-05", "", "BE"), rel(RELEASE.DIGITAL, "2014-11-07", "", "AT"),
    rel(RELEASE.THEATRICAL, "2014-11-07"), rel(RELEASE.DIGITAL, "2015-03-31"), rel(RELEASE.DIGITAL, "2026-08-03", "Prime Video")];
  assert.equal(judgeMovie({ releases }, real("Prime Video"), { region: "US" }).reason, "theatrical-first");
});

test("a stray early digital date abroad doesn't make a cinema film an original", () => {
  // Baywatch: one country lists "Digital" a week before cinemas; nothing in the US.
  const releases = [rel(RELEASE.DIGITAL, "2017-05-18", "", "CZ"), rel(RELEASE.THEATRICAL, "2017-05-25", "", "PR"),
    rel(RELEASE.THEATRICAL, "2017-05-26"), rel(RELEASE.DIGITAL, "2017-08-21", "Streaming", "BR"),
    rel(RELEASE.DIGITAL, "2022-02-01", "Prime Video", "FR")];
  assert.equal(judgeMovie({ releases }, real("Prime Video"), { region: "US" }).reason, "theatrical-first");
});

test("a service note abroad inside the window doesn't count when the US one is later", () => {
  // Now You See Me: Now You Don't: Prime Video in Brazil at 50 days, in the US 11 months later.
  const releases = [rel(RELEASE.THEATRICAL, "2025-11-12", "", "BE"), rel(RELEASE.THEATRICAL, "2025-11-14"),
    rel(RELEASE.DIGITAL, "2025-12-16"), rel(RELEASE.DIGITAL, "2026-01-01", "Prime Video", "BR"), rel(RELEASE.DIGITAL, "2026-10-02", "Prime Video")];
  assert.equal(judgeMovie({ releases }, real("Prime Video"), { region: "US" }).reason, "theatrical-first");
});

test("licensed Indian release reaching Netflix ~8 weeks after cinemas → excluded", () => {
  // Jawan, including Turkey's stray "Netflix" digital entry on the cinema date.
  const releases = [rel(RELEASE.THEATRICAL, "2023-09-07"), rel(RELEASE.DIGITAL, "2023-09-07", "Netflix", "TR"),
    rel(RELEASE.DIGITAL, "2023-11-02", "Netflix")];
  assert.equal(judgeMovie({ releases }, real("Netflix"), { region: "US" }).reason, "theatrical-first");
});

test("streamers' own short cinema runs still count", () => {
  const redOne = [rel(RELEASE.THEATRICAL, "2024-11-06", "", "ID"), rel(RELEASE.THEATRICAL, "2024-11-15"),
    rel(RELEASE.DIGITAL, "2024-12-12", "Prime Video"), rel(RELEASE.DIGITAL, "2025-02-11")];
  assert.equal(judgeMovie({ releases: redOne }, real("Prime Video"), { region: "US" }).reason, "short-theatrical-window");
  const irishman = [rel(RELEASE.DIGITAL, "2019-11-01", "", "NL"), rel(RELEASE.THEATRICAL, "2019-11-14", "", "AT"),
    rel(RELEASE.DIGITAL, "2019-11-27", "Netflix")];
  assert.equal(judgeMovie({ releases: irishman }, real("Netflix"), { region: "US" }).ok, true);
  const theIdeaOfYou = [rel(RELEASE.THEATRICAL, "2024-05-02", "", "MX"), rel(RELEASE.DIGITAL, "2024-05-02", "Prime Video")];
  assert.equal(judgeMovie({ releases: theIdeaOfYou }, real("Prime Video"), { region: "US" }).reason, "home-premiere");
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
