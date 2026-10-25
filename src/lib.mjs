// Pure helpers: no network access, so they can be unit-tested.

export const CATALOG_ID = "streaming-originals";
export const CATALOG_NAME = "Streaming Originals";
const DAY = 24 * 60 * 60 * 1000;

// TMDB release types
export const RELEASE = { PREMIERE: 1, LIMITED: 2, THEATRICAL: 3, DIGITAL: 4, PHYSICAL: 5, TV: 6 };

/** Flatten TMDB's release_dates.results into [{country, type, date, note}]. */
export function flattenReleases(releaseDates) {
  const out = [];
  for (const c of releaseDates?.results ?? []) {
    for (const r of c.release_dates ?? []) {
      const t = Date.parse(r.release_date);
      if (!Number.isNaN(t)) out.push({ country: c.iso_3166_1, type: r.type, date: t, note: r.note ?? "" });
    }
  }
  return out;
}

/**
 * Decide whether a movie premiered on a streaming service rather than in cinemas.
 *  - It must have a home premiere: digital (4) or TV (6). HBO/Showtime films
 *    premiere as TV releases, streamers usually as digital.
 *  - No theatrical (3) release anywhere more than a day before that premiere.
 *    Limited (2) runs and festival premieres (1) are allowed: streamers often give
 *    awards contenders a short cinema run first.
 *  - Exception for services that release their own films in cinemas first
 *    (Glass Onion, Killers of the Flower Moon): a theatrical-first film still
 *    counts if it reached home release within `theatricalWindowDays` of its
 *    first theatrical date AND a home-release note or production company matches
 *    `theatricalKeywords`. The Dark Knight fails both. Off unless configured.
 *  - The home premiere can't predate the service (`since`), which filters out old
 *    library films whose TMDB entries happen to lack theatrical dates.
 *  - strict: the service must also be named in a home-release note or a
 *    production company.
 */
export function judgeMovie({ releases, companies = [] }, service, strict = false) {
  const home = releases.filter((r) => r.type === RELEASE.DIGITAL || r.type === RELEASE.TV);
  if (!home.length) return { ok: false, reason: "no-home-release" };
  const firstHome = Math.min(...home.map((r) => r.date));
  const text = [...home.map((r) => r.note), ...companies].join(" | ");
  let reason = "home-premiere";

  const theatrical = releases.filter((r) => r.type === RELEASE.THEATRICAL).map((r) => r.date);
  const firstTheatrical = theatrical.length ? Math.min(...theatrical) : Infinity;
  if (firstTheatrical < firstHome - DAY) {
    const windowDays = service.theatricalWindowDays ?? 0;
    const gapDays = (firstHome - firstTheatrical) / DAY;
    const ownFilm = (service.theatricalKeywords ?? []).some((k) => k.test(text));
    if (!(windowDays > 0 && gapDays <= windowDays && ownFilm)) return { ok: false, reason: "theatrical-first" };
    reason = "short-theatrical-window";
  }
  if (service.moviesSince && firstHome < Date.parse(service.moviesSince)) {
    return { ok: false, reason: "predates-service" };
  }
  if (strict && !service.keywords.some((k) => k.test(text))) return { ok: false, reason: "no-keyword" };
  return { ok: true, reason };
}

/**
 * Decide whether a show premiered on one of a service's networks.
 * TMDB lists a show's original network first, so with `firstNetworkOnly` a show
 * that moved to the service later (Lucifer: FOX then Netflix) is excluded.
 */
export function judgeSeries(networkIds, serviceNetworkIds, firstNetworkOnly = true) {
  if (!networkIds?.length) return { ok: false, reason: "no-networks" };
  const set = new Set(serviceNetworkIds);
  if (firstNetworkOnly) return set.has(networkIds[0]) ? { ok: true } : { ok: false, reason: "moved-to-service" };
  return networkIds.some((id) => set.has(id)) ? { ok: true } : { ok: false, reason: "not-on-network" };
}

/** Pick the network from a show's list whose name matches. */
export function pickNetwork(networks, match) {
  return (networks ?? []).find((n) => match.test(n.name ?? ""));
}

/**
 * Provider ids for a service: every provider whose name matches a pattern, plus
 * pinned ids, which are only used if TMDB actually lists them for the region.
 */
export function matchProviders(allProviders, patterns, pinnedIds = []) {
  const ids = new Set();
  for (const p of allProviders) {
    if (patterns.some((re) => re.test(p.provider_name ?? "")) || pinnedIds.includes(p.provider_id)) ids.add(p.provider_id);
  }
  return [...ids];
}

/**
 * Static files can't parse query strings, so each Stremio request path must exist
 * as a file. Clients encode extra values differently ("Apple TV +" may arrive as
 * Apple%20TV%20%2B or Apple+TV+%2B), and hosts may or may not decode the path.
 * Write every spelling so whichever one arrives resolves to a file.
 */
export function valueSpellings(value) {
  const set = new Set([
    value,                                                            // decoded, percent-style
    value.replace(/ /g, "+"),                                         // decoded, form-style
    encodeURIComponent(value),                                        // undecoded, percent-style
    encodeURIComponent(value).replace(/%20/g, "+"),                   // undecoded, form-style
  ]);
  return [...set];
}

/** Every file path for one page of one service's catalog. */
export function catalogPaths(type, serviceName, skip) {
  return valueSpellings(serviceName).flatMap((v) => {
    const base = `catalog/${type}/${CATALOG_ID}/genre=${v}`;
    return skip === 0 ? [`${base}.json`, `${base}&skip=0.json`] : [`${base}&skip=${skip}.json`];
  });
}

/** Split items into pages; always at least one (possibly empty) page. */
export function paginate(items, pageSize) {
  const pages = [];
  for (let i = 0; i < items.length; i += pageSize) pages.push({ skip: i, items: items.slice(i, i + pageSize) });
  return pages.length ? pages : [{ skip: 0, items: [] }];
}

export function buildManifest(serviceNames, version = "1.0.0") {
  const catalog = (type) => ({
    type,
    id: CATALOG_ID,
    name: CATALOG_NAME,
    genres: serviceNames, // older clients read this
    extra: [
      { name: "genre", options: serviceNames, isRequired: true },
      { name: "skip" },
    ],
  });
  return {
    id: "community.streaming-originals",
    version,
    name: CATALOG_NAME,
    description: "Movies and series that premiered on a streaming service. Pick a service from the dropdown in Discover.",
    resources: ["catalog"],
    types: ["movie", "series"],
    catalogs: [catalog("movie"), catalog("series")],
    behaviorHints: { configurable: false, configurationRequired: false },
  };
}

export function toMeta(type, item, imdbId) {
  const date = type === "movie" ? item.release_date : item.first_air_date;
  return {
    id: imdbId,
    type,
    name: type === "movie" ? item.title : item.name,
    poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : undefined,
    posterShape: "poster",
    releaseInfo: date ? date.slice(0, 4) : undefined,
    description: item.overview || undefined,
  };
}
