# Streaming Originals

A Stremio catalog addon listing movies and series that **premiered on a streaming service**, with the service as a dropdown filter in Discover (like Genre or Language). It's hosted as static files on GitHub Pages and rebuilt daily from TMDB by GitHub Actions, so there's no server to run.

Services: Netflix, Prime Video, HBO Max, Disney+, Apple TV +, Crunchyroll, Shudder, Curiosity Stream, Paramount+, AMC+.

## Setup (about 10 minutes)

1. **Get a TMDB key.** Create a free account at themoviedb.org, then go to Settings → API and request a developer key. Copy either the *API Key* or the *API Read Access Token*; both work.
2. **Create a GitHub repo** (public is simplest, since Pages on private repos needs a paid plan) and push this folder to its `main` branch.
3. **Add the key as a secret:** repo → Settings → Secrets and variables → Actions → New repository secret. Name it `TMDB_API_KEY`.
4. **Turn on Pages:** repo → Settings → Pages → Source: **GitHub Actions**.
5. **Run the first build:** repo → Actions → "Build and deploy catalogs" → Run workflow. The first run takes several minutes because nothing is cached yet; later runs are much faster.
6. **Install:** open `https://<your-username>.github.io/<repo-name>/` and click *Install in Stremio*, or paste `https://<your-username>.github.io/<repo-name>/manifest.json` into Stremio's addon search.

In Stremio, open **Discover**, pick Movies or Series, choose **Streaming Originals** as the catalog, then pick a service from the dropdown. It opens on Netflix (`defaultService` in `services.config.mjs`). Because the filter is required, it only appears in Discover, not as a home-screen row.

After each build, `report.json` on the site shows which networks and providers were resolved, how many titles each service kept, and why the rest were dropped.

## How "originals" is decided

**Series** use the TMDB *network*: the channel or service a show was made for. *Breaking Bad* is an AMC show even though Netflix streams it, so it never appears under Netflix. By default a show only counts if the service's network is listed first on TMDB, which excludes shows that moved to a service partway through (*Lucifer* started on FOX). Set `seriesFirstNetworkOnly: false` to include those.

**Movies** have no network on TMDB, so they take two steps:
1. Fetch everything the service streams in the US (TMDB watch providers).
2. Keep only films whose first home release (digital, or TV for HBO/Showtime films) came before any theatrical release, and not before the service started making films (`moviesSince`). Short limited cinema runs and festival screenings are allowed, since streamers use those for awards eligibility. Home release dates come from the US entries when TMDB has any, because one-off entries elsewhere are often wrong (a cinema date typed in as "Digital").

**Streamer films that opened in cinemas first** (*Glass Onion*, *Killers of the Flower Moon*) look like studio films on TMDB, so they get an exception: the film still counts if TMDB has a home release noted with the service's name ("Netflix") within a short window of its first cinema date. The name and the date have to be on the same release. *Interstellar* has a rental release months after cinemas and a "Prime Video" release in 2026, so it stays out: that's licensing. This is set per service in `services.config.mjs`:

| Service | Window | Note must say |
|---|---|---|
| Netflix | 45 days | "Netflix" |
| Prime Video | 60 days | "Prime Video" |
| Apple TV + | 120 days | "Apple TV+" |

It's deliberately off for the others: on Disney+ or Paramount+ it would pull in every Pixar, Marvel or Paramount cinema release, since those studios' films go to the service a few months later. Films let in this way are counted as `kept-via-theatrical-window` in `report.json`, so you can see how many there are.

**Overrides** handle anything the rules still get wrong. Add IMDb ids per service and type:

```js
overrides: { movie: { include: ["tt..."], exclude: ["tt..."] }, series: { include: [], exclude: [] } },
```

Included titles are appended after the automatic list. An id TMDB can't find shows up as a warning in the report.

Known edge cases:
- The theatrical exception depends on TMDB noting the service on the release. If it doesn't, or the film stayed in cinemas longer than the window (*F1* reached Apple TV after six months), it's excluded; use an override.
- Licensed direct-to-digital films can slip into the movie lists, most often on Prime Video. Set `strictMovies: true` on a service (or globally) to also require the service's name in a release note or production company. It's stricter but can drop genuine originals with incomplete TMDB data.
- Crunchyroll: most simulcast anime is credited on TMDB to its Japanese broadcaster, so the Crunchyroll series list is mainly Crunchyroll Originals and shows TMDB editors tagged with it.

## Extra and historical networks included

| Service | Networks |
|---|---|
| Prime Video | Prime Video, Freevee / IMDb TV (merged into Prime Video in 2025) |
| HBO Max | HBO, HBO Max / Max, Cinemax (its originals now stream on HBO Max) |
| Paramount+ | Paramount+, CBS All Access (its former name), Showtime (merged into Paramount+ with Showtime) |
| AMC+ | AMC+, AMC (its cable originals are the core of AMC+), Sundance Now (bundled into AMC+) |

Remove any of these in `services.config.mjs` if you want a narrower definition. AMC is the most debatable: it puts *Breaking Bad* and *The Walking Dead* under AMC+.

Networks aren't identified by hard-coded IDs. Each has one or more "anchor" shows (e.g. Shudder → *Creepshow*), and the build looks the anchor up on TMDB to find the network ID. If you add a network by `id` instead, its TMDB name is checked against `match` and a mismatch fails the build, so a typo can't silently pull in the wrong channel.

## Customising

Everything lives in `services.config.mjs`: list sizes, minimum TMDB votes, region, strictness, and the services themselves. The `name` of a service is exactly what shows in the dropdown. Push a change and the workflow rebuilds automatically.

## Local testing

```
TMDB_API_KEY=... npm run build   # writes ./dist
npm run serve                    # then install http://127.0.0.1:7000/manifest.json in Stremio on this PC
npm test                         # unit tests + a mocked end-to-end build, no key needed
```

## Notes

- Items use IMDb IDs, so your metadata addon (AIOMetadata/Cinemeta) supplies details and your stream addons (AIOStreams) find streams as usual. TMDB titles without an IMDb ID are skipped.
- Catalogs are static, so lists are up to a day old.
- If a build comes back completely empty (TMDB outage, bad key), it fails instead of publishing, and the previous deployment stays live.
- Static files can't read query strings, so each page of each service is written under every URL spelling a client might use (`Apple%20TV%20%2B`, `Apple+TV+%2B` and so on). That's why there are more files than catalogs.

This product uses the TMDB API but is not endorsed or certified by TMDB.
