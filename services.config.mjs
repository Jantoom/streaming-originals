// Streaming Originals — service definitions.
//
// The `name` of each service is exactly what appears in Stremio's Discover dropdown.
//
// SERIES use TMDB *networks*: the network a show originally premiered on. This is
// what makes the list originals-only (Breaking Bad is AMC, not Netflix).
//   Each network is identified by a known show that premiered on it ("anchors").
//   At build time the script looks the anchor up on TMDB and takes the network
//   whose name matches `match`. That way no network ID is hard-coded or guessed.
//   If you already know an ID, add `id` and it is used after its name is checked
//   against `match`; a mismatch fails the build rather than silently pulling in
//   the wrong network.
//
// MOVIES use TMDB *watch providers* (US region) to get candidates, then keep only
// titles whose first release was digital/TV rather than theatrical, and not before
// `moviesSince` (roughly when the service started making films). See README.
//   `providers` are regexes matched against TMDB's US provider names.
//   `keywords` are only used when strictMovies is true: the movie must then also
//   name the service in a digital release note or a production company.
//   `theatricalWindowDays` + `theatricalKeywords` let a service's own films that
//   opened in cinemas first still count (Glass Onion: cinemas, then Netflix 30
//   days later). The film must reach home release within the window AND match a
//   keyword in a home-release note or production company. Only set this for
//   services that release their own films theatrically: on Disney+ or Paramount+
//   it would pull in every Pixar or Paramount cinema release.
//
// OVERRIDES fix anything the rules get wrong, by IMDb id:
//   overrides: { movie: { include: ["tt..."], exclude: ["tt..."] }, series: { ... } }

export const config = {
  region: "US",                // watch-provider region for movies
  language: "en-US",
  pageSize: 100,               // items per catalog page (Stremio pages in 100s)
  maxSeriesPerService: 1000,
  maxMovieCandidatesPerService: 2000, // pool checked before the originals filter
  maxMoviesPerService: 1000,
  minVotes: 3,                 // drop near-empty TMDB entries
  includeUnaired: false,       // series that haven't premiered yet
  strictMovies: false,         // global default; can be overridden per service
  // Only count a show if the service's network is listed FIRST on TMDB (its
  // original network). Excludes shows that moved later, e.g. Lucifer (FOX, then
  // Netflix). Set false to include any show the network ever carried.
  seriesFirstNetworkOnly: true,
};

export const services = [
  {
    name: "Netflix",
    moviesSince: "2012-01-01",
    networks: [
      { label: "Netflix", match: /^netflix$/i, anchors: [["Stranger Things", 2016], ["Squid Game", 2021]] },
    ],
    providers: [/^netflix/i],
    keywords: [/\bnetflix\b/i],
    theatricalWindowDays: 60,               // Glass Onion: 30 days
    theatricalKeywords: [/\bnetflix\b/i],
    // overrides: { movie: { include: [], exclude: [] }, series: { include: [], exclude: [] } },
  },
  {
    name: "Prime Video",
    moviesSince: "2014-01-01",
    networks: [
      { label: "Prime Video", match: /^(amazon )?prime video$|^amazon$/i, anchors: [["The Boys", 2019], ["The Marvelous Mrs. Maisel", 2017]] },
      // Freevee (formerly IMDb TV) was folded into Prime Video in 2025.
      { label: "Freevee / IMDb TV", match: /freevee|imdb ?tv/i, anchors: [["Jury Duty", 2023], ["Bosch: Legacy", 2022]] },
    ],
    providers: [/^amazon prime video/i, /freevee/i],
    keywords: [/\bamazon\b/i, /\bprime video\b/i, /\bfreevee\b/i],
    // Amazon MGM films sometimes play in cinemas for a few weeks first (Red One).
    theatricalWindowDays: 60,
    theatricalKeywords: [/\bprime video\b/i, /\bamazon (mgm )?studios\b/i],
  },
  {
    name: "HBO Max",
    // HBO Films have premiered on HBO since 1983
    moviesSince: "1983-01-01",
    networks: [
      { label: "HBO", match: /^hbo$/i, anchors: [["The Sopranos", 1999], ["Game of Thrones", 2011]] },
      { label: "HBO Max / Max", match: /^(hbo )?max$/i, anchors: [["Peacemaker", 2022], ["The Pitt", 2025], ["Hacks", 2021]] },
      // Cinemax originals (Banshee, The Knick, Strike Back) now live on HBO Max.
      { label: "Cinemax", match: /^cinemax$/i, anchors: [["Banshee", 2013], ["The Knick", 2014]] },
    ],
    providers: [/^(hbo )?max\b/i, /^hbo max/i],
    keywords: [/\bhbo\b/i, /\bmax\b/i, /\bcinemax\b/i],
  },
  {
    name: "Disney+",
    moviesSince: "2019-11-12",
    networks: [
      { label: "Disney+", match: /^disney\+$|^disney plus$/i, anchors: [["The Mandalorian", 2019], ["Andor", 2022]] },
    ],
    providers: [/^disney (\+|plus)/i],
    keywords: [/\bdisney\b/i, /\bpixar\b/i, /\blucasfilm\b/i, /\bmarvel\b/i],
  },
  {
    name: "Apple TV +",
    moviesSince: "2019-11-01",
    networks: [
      { label: "Apple TV+", match: /^apple tv(\+| plus)?$/i, anchors: [["Severance", 2022], ["Ted Lasso", 2020]] },
    ],
    // Apple renamed Apple TV+ to "Apple TV" in 2025, which collides with the
    // Apple TV rental store. Only match the subscription service's names.
    providers: [/^apple tv ?(\+|plus)/i],
    pinnedProviderIds: [350], // Apple TV+'s TMDB id, used only if TMDB lists it
    keywords: [/\bapple\b/i],
    // Apple Original Films often get a full cinema run of about 3 months first
    // (Killers of the Flower Moon, Napoleon, F1).
    theatricalWindowDays: 120,
    // Not plain "Apple TV": that's also the rental store's name in release notes.
    theatricalKeywords: [/\bapple (original films|studios)\b/i, /\bapple tv ?(\+|plus)/i],
  },
  {
    name: "Crunchyroll",
    moviesSince: "2006-01-01",
    networks: [
      // Note: most simulcast anime is credited to its Japanese broadcaster on TMDB,
      // so this mainly covers Crunchyroll Originals plus shows editors tagged with it.
      { label: "Crunchyroll", match: /^crunchyroll$/i, anchors: [["High Guardian Spice", 2021], ["Onyx Equinox", 2020], ["Tower of God", 2020]] },
    ],
    providers: [/^crunchyroll/i],
    keywords: [/\bcrunchyroll\b/i, /\bfunimation\b/i],
  },
  {
    name: "Shudder",
    moviesSince: "2015-06-01",
    networks: [
      { label: "Shudder", match: /^shudder$/i, anchors: [["Creepshow", 2019], ["The Last Drive-in with Joe Bob Briggs", 2019]] },
    ],
    providers: [/^shudder/i],
    keywords: [/\bshudder\b/i],
  },
  {
    name: "Curiosity Stream",
    moviesSince: "2015-03-01",
    networks: [
      { label: "Curiosity Stream", match: /^curiosity ?stream$/i, anchors: [["Connections with James Burke", 2023], ["Tom Scott Presents: Money", 2021], ["Secrets of the Universe", 2022]] },
    ],
    providers: [/^curiosity ?stream/i],
    keywords: [/\bcuriosity ?stream\b/i, /\bcuriosity studios\b/i],
  },
  {
    name: "Paramount+",
    // includes Showtime films
    moviesSince: "1983-01-01",
    networks: [
      { label: "Paramount+", match: /^paramount(\+| plus)$/i, anchors: [["Tulsa King", 2022], ["1923", 2022]] },
      // Paramount+ was CBS All Access until 2021.
      { label: "CBS All Access", match: /^cbs all access$/i, anchors: [["Star Trek: Discovery", 2017], ["The Good Fight", 2017]] },
      // Showtime merged into "Paramount+ with Showtime"; its originals stream there.
      { label: "Showtime", match: /^showtime$/i, anchors: [["Dexter", 2006], ["Yellowjackets", 2021]] },
    ],
    providers: [/^paramount ?(\+|plus)/i, /^showtime/i],
    keywords: [/\bparamount\b/i, /\bshowtime\b/i, /\bcbs\b/i],
  },
  {
    name: "AMC+",
    moviesSince: "2020-06-01",
    networks: [
      { label: "AMC+", match: /^amc ?(\+|plus)$/i, anchors: [["Ragdoll", 2021], ["Firebite", 2021], ["Kin", 2021]] },
      // AMC's cable originals (Breaking Bad, Mad Men, The Walking Dead) are the core
      // of AMC+, in the same way HBO's are for HBO Max. Remove this if you only want
      // AMC+-exclusive premieres.
      { label: "AMC", match: /^amc$/i, anchors: [["Breaking Bad", 2008], ["Mad Men", 2007]] },
      // Sundance Now is bundled into AMC+.
      { label: "Sundance Now", match: /^sundance ?now$/i, anchors: [["A Discovery of Witches", 2018], ["Liar", 2017]] },
    ],
    providers: [/^amc ?(\+|plus)/i],
    keywords: [/\bamc\b/i, /\bsundance\b/i, /\bifc\b/i],
  },
];
