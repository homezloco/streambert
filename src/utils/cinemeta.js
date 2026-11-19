// ── Cinemeta metadata backend (no API key required) ──────────────────────────
// Free, keyless metadata service operated by Stremio. This module translates
// the subset of TMDB REST paths the app consumes into Cinemeta catalog/meta
// calls and normalizes the responses into TMDB-shaped objects, so the UI code
// works unchanged when no TMDB Read Access Token is configured.
//
// ID model: items carry their IMDb id (tt…) as `id` in keyless mode. The
// numeric TMDB id is exposed on detail objects as `moviedb_id` and resolved
// lazily for sources/downloads/subtitles that need it.
//
// Degraded vs. TMDB: no recommendations/similar, no collections, no episode
// groups, no age certifications, cast names without photos, English only.

const CINEMETA_BASE = "https://v3-cinemeta.strem.io";

// TMDB genre name → genre id (ids the app checks: 16 = Animation for anime
// detection; the rest are best-effort for display/filtering).
const GENRE_NAME_TO_ID = {
  Action: 28,
  Adventure: 12,
  Animation: 16,
  Comedy: 35,
  Crime: 80,
  Documentary: 99,
  Drama: 18,
  Family: 10751,
  Fantasy: 14,
  History: 36,
  Horror: 27,
  Music: 10402,
  Mystery: 9648,
  Romance: 10749,
  "Sci-Fi": 878,
  "Science Fiction": 878,
  "TV Movie": 10770,
  Thriller: 53,
  War: 10752,
  Western: 37,
  "Action & Adventure": 10759,
  "Sci-Fi & Fantasy": 10765,
  "War & Politics": 10768,
  Kids: 10762,
  News: 10763,
  Reality: 10764,
  Soap: 10766,
  Talk: 10767,
};

const genreId = (name) =>
  GENRE_NAME_TO_ID[name] ??
  // Synthetic stable-ish id for unknown genre names (negative, never collides
  // with real TMDB ids used in checks).
  -(
    name.split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) % 10000
  );

// Country display name → ISO 3166-1 alpha-2. Only a subset is needed:
// "JP" drives anime detection, the rest feed original_language best-effort.
const COUNTRY_TO_ISO = {
  Japan: "JP",
  "United States": "US",
  "United States of America": "US",
  "United Kingdom": "GB",
  "Great Britain": "GB",
  Korea: "KR",
  "South Korea": "KR",
  China: "CN",
  "Hong Kong": "HK",
  Taiwan: "TW",
  France: "FR",
  Germany: "DE",
  Italy: "IT",
  Spain: "ES",
  Russia: "RU",
  "Russian Federation": "RU",
  Canada: "CA",
  Australia: "AU",
  India: "IN",
  Brazil: "BR",
  Mexico: "MX",
  Netherlands: "NL",
  Sweden: "SE",
  Norway: "NO",
  Denmark: "DK",
  Finland: "FI",
  Poland: "PL",
  Turkey: "TR",
  Thailand: "TH",
};

// ISO country → rough primary ISO 639-1 language (original_language).
const ISO_TO_LANG = {
  JP: "ja",
  KR: "ko",
  CN: "zh",
  TW: "zh",
  HK: "zh",
  FR: "fr",
  DE: "de",
  IT: "it",
  ES: "es",
  RU: "ru",
  IN: "hi",
  BR: "pt",
  MX: "es",
  TR: "tr",
  TH: "th",
  NL: "nl",
  SE: "sv",
  NO: "no",
  DK: "da",
  FI: "fi",
  PL: "pl",
};

function countryCodes(countryStr) {
  if (!countryStr) return [];
  return String(countryStr)
    .split(",")
    .map((c) => COUNTRY_TO_ISO[c.trim()])
    .filter(Boolean);
}

function guessLanguage(isoCountries) {
  const first = isoCountries[0];
  return ISO_TO_LANG[first] || "en";
}

function firstYear(meta) {
  const m = String(meta.releaseInfo || meta.year || "").match(/\d{4}/);
  if (m) return `${m[0]}-01-01`;
  const rel = String(meta.released || "");
  return rel ? rel.slice(0, 10) : "";
}

function parseRuntimeMinutes(runtime) {
  const m = String(runtime || "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function parseRating(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

// ── Normalizers ───────────────────────────────────────────────────────────────

// Catalog/search entry → the shape MediaCard / TrendingCarousel / list rows use.
function metaToItem(meta, type) {
  const isTv = type === "series";
  const date = firstYear(meta);
  const countries = countryCodes(meta.country);
  return {
    id: meta.imdb_id || meta.id,
    media_type: isTv ? "tv" : "movie",
    title: isTv ? undefined : meta.name,
    name: isTv ? meta.name : undefined,
    poster_path: meta.poster || null,
    backdrop_path: meta.background || null,
    release_date: isTv ? undefined : date,
    first_air_date: isTv ? date : undefined,
    vote_average: parseRating(meta.imdbRating),
    overview: meta.description || "",
    genre_ids: (meta.genre || []).map(genreId),
    original_language: guessLanguage(countries),
    origin_country: countries,
  };
}

// Full meta → TMDB /movie/{id} or /tv/{id} detail shape.
function metaToDetails(meta, type) {
  const item = metaToItem(meta, type);
  const isTv = type === "series";
  const countries = countryCodes(meta.country);
  const genres = (meta.genre || []).map((name) => ({
    id: genreId(name),
    name,
  }));
  const runtime = parseRuntimeMinutes(meta.runtime);

  const details = {
    ...item,
    id: meta.imdb_id || meta.id,
    moviedb_id: meta.moviedb_id ?? null,
    imdb_id: meta.imdb_id || meta.id,
    genres,
    runtime,
    episode_run_time: runtime ? [runtime] : [],
    status: meta.status === "Ongoing" ? "Returning Series" : meta.status || "",
    tagline: "",
    credits: undefined,
    external_ids: { imdb_id: meta.imdb_id || meta.id },
  };

  if (!isTv) return details;

  // ── Series: synthesize seasons + last/next episode from videos ──────────
  const videos = Array.isArray(meta.videos) ? meta.videos : [];
  const now = Date.now();
  const parseAired = (v) => {
    const t = Date.parse(v.firstAired || v.released || "");
    return Number.isFinite(t) ? t : null;
  };

  const bySeason = new Map();
  for (const v of videos) {
    const s = v.season ?? 1;
    if (!bySeason.has(s)) bySeason.set(s, []);
    bySeason.get(s).push(v);
  }

  const seasons = [...bySeason.entries()]
    .sort(([a], [b]) => a - b)
    .map(([num, eps]) => {
      const firstAired = eps
        .map(parseAired)
        .filter((t) => t !== null)
        .sort((a, b) => a - b)[0];
      return {
        season_number: num,
        episode_count: eps.length,
        name: num === 0 ? "Specials" : `Season ${num}`,
        air_date:
          firstAired != null
            ? new Date(firstAired).toISOString().slice(0, 10)
            : null,
        poster_path: null,
        overview: "",
      };
    });

  const sortedEps = videos
    .map((v) => ({ v, t: parseAired(v) }))
    .filter((e) => e.t !== null)
    .sort((a, b) => a.t - b.t);
  const last = [...sortedEps].reverse().find((e) => e.t <= now) || null;
  const next = sortedEps.find((e) => e.t > now) || null;

  const toAir = (e) =>
    e
      ? {
          air_date: new Date(e.t).toISOString().slice(0, 10),
          season_number: e.v.season ?? 1,
          episode_number: e.v.number ?? 0,
          name: e.v.name || "",
        }
      : null;

  return {
    ...details,
    seasons,
    number_of_seasons: seasons.filter((s) => s.season_number > 0).length,
    last_episode_to_air: toAir(last),
    next_episode_to_air: toAir(next),
    last_air_date: toAir(last)?.air_date || null,
    created_by: (meta.director || []).map((name) => ({ name })),
    networks: [],
  };
}

// Series meta → TMDB /tv/{id}/season/{n} shape.
function metaToSeason(meta, seasonNumber) {
  const episodes = (meta.videos || [])
    .filter((v) => (v.season ?? 1) === seasonNumber)
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
    .map((v) => ({
      episode_number: v.number ?? 0,
      season_number: v.season ?? 1,
      name: v.name || `Episode ${v.number ?? ""}`,
      overview: v.overview || "",
      still_path: v.thumbnail || null,
      air_date: (v.firstAired || v.released || "").slice(0, 10) || null,
      vote_average: parseRating(v.rating),
      runtime: parseRuntimeMinutes(v.runtime),
      id: v.tvdb_id || v.id || null,
    }));
  return {
    episodes,
    season_number: seasonNumber,
    name: seasonNumber === 0 ? "Specials" : `Season ${seasonNumber}`,
    air_date: episodes[0]?.air_date || null,
    poster_path: null,
    overview: "",
  };
}

// Meta → TMDB credits shape (names only — Cinemeta has no cast photos).
function metaToCredits(meta) {
  const cast = (meta.cast || []).map((name, i) => ({
    id: i,
    name,
    character: "",
    profile_path: null,
    order: i,
    known_for_department: "Acting",
  }));
  const crew = (meta.director || []).map((name, i) => ({
    id: i,
    name,
    job: "Director",
    department: "Directing",
    profile_path: null,
  }));
  return { cast, crew };
}

// Meta → TMDB /videos shape (YouTube trailer keys).
function metaToVideos(meta) {
  const results = (meta.trailers || [])
    .filter((t) => t && t.source)
    .map((t) => ({
      key: t.source,
      site: "YouTube",
      type: t.type === "Trailer" ? "Trailer" : t.type || "Trailer",
      official: true,
      name: t.type || "Trailer",
    }));
  return { results };
}

// ── Fetching ──────────────────────────────────────────────────────────────────

async function cmGet(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Cinemeta ${res.status}`);
  return res.json();
}

// Meta lookups are the ID bridge (imdb → moviedb_id) and the source for
// details/seasons/credits/videos — cache the promise to dedupe in-flight calls.
const _metaPending = new Map(); // "movie:tt123" -> Promise<meta>

export function fetchCinemetaMeta(type, id) {
  const kind = type === "movie" ? "movie" : "series";
  const key = `${kind}:${id}`;
  if (_metaPending.has(key)) return _metaPending.get(key);
  const p = cmGet(`${CINEMETA_BASE}/meta/${kind}/${encodeURIComponent(id)}.json`)
    .then((data) => {
      if (!data?.meta) throw new Error(`Cinemeta: no meta for ${id}`);
      return data.meta;
    })
    .finally(() => _metaPending.delete(key));
  _metaPending.set(key, p);
  return p;
}

/** Resolve the numeric TMDB id for any id the app may hold (imdb or tmdb). */
export async function resolveTmdbId(type, anyId) {
  const s = String(anyId);
  if (/^\d+$/.test(s)) return Number(s);
  const meta = await fetchCinemetaMeta(type === "movie" ? "movie" : "series", s);
  if (!meta?.moviedb_id) throw new Error(`No TMDB id for ${anyId}`);
  return meta.moviedb_id;
}

// TMDB genre id → display name, used to translate /discover?with_genres into
// Cinemeta's genre= catalogs (which happen to share TMDB's genre names).
export const MOVIE_GENRES = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy",
  36: "History", 27: "Horror", 10402: "Music", 9648: "Mystery",
  10749: "Romance", 878: "Science Fiction", 10770: "TV Movie", 53: "Thriller",
  10752: "War", 37: "Western",
};
export const TV_GENRES = {
  10759: "Action & Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 10762: "Kids",
  9648: "Mystery", 10763: "News", 10764: "Reality", 10765: "Sci-Fi & Fantasy",
  10766: "Soap", 10767: "Talk", 10768: "War & Politics", 37: "Western",
};

async function catalog(type, catalogId, { skip = 0, genre = null } = {}) {
  // Cinemeta catalog extra params are path segments before .json.
  // genre= and skip= may not be combined (server rejects it) — genre wins.
  const parts = [catalogId];
  if (genre) parts.push(`genre=${encodeURIComponent(genre)}`);
  else if (skip > 0) parts.push(`skip=${skip}`);
  const data = await cmGet(
    `${CINEMETA_BASE}/catalog/${type}/${parts.join("/")}.json`,
  );
  return { results: (data.metas || []).map((m) => metaToItem(m, type)) };
}

async function catalogSearch(query) {
  const q = encodeURIComponent(query);
  const [movies, series] = await Promise.all([
    cmGet(`${CINEMETA_BASE}/catalog/movie/top/search=${q}.json`).catch(() => ({
      metas: [],
    })),
    cmGet(`${CINEMETA_BASE}/catalog/series/top/search=${q}.json`).catch(() => ({
      metas: [],
    })),
  ]);
  const mItems = (movies.metas || []).map((m) => metaToItem(m, "movie"));
  const sItems = (series.metas || []).map((m) => metaToItem(m, "series"));
  // Interleave movies and series like TMDB /search/multi popularity mix
  const merged = [];
  const max = Math.max(mItems.length, sItems.length);
  for (let i = 0; i < max; i++) {
    if (mItems[i]) merged.push(mItems[i]);
    if (sItems[i]) merged.push(sItems[i]);
  }
  return { results: merged };
}

function unsupported(path) {
  const err = new Error(`Cinemeta: unsupported TMDB path ${path}`);
  err.cinemetaUnsupported = true;
  return err;
}

/**
 * Drop-in replacement for tmdbFetch in keyless mode. Accepts the TMDB-style
 * request path (query string included) and returns TMDB-shaped data built
 * from Cinemeta. Throws for endpoints with no Cinemeta equivalent
 * (err.cinemetaUnsupported = true) so callers degrade gracefully.
 */
export async function cinemetaFetch(path) {
  const [pathname, queryStr] = String(path).split("?");
  const params = new URLSearchParams(queryStr || "");

  // /trending/{movie|tv}/{week|day}
  let m = pathname.match(/^\/trending\/(movie|tv)\/(week|day)$/);
  if (m) return catalog(m[1] === "movie" ? "movie" : "series", "top");

  // /{movie|tv}/top_rated
  m = pathname.match(/^\/(movie|tv)\/top_rated$/);
  if (m)
    return catalog(m[1] === "movie" ? "movie" : "series", "imdbRating");

  // /{movie|tv}/popular?page=N → top catalog with skip pagination
  m = pathname.match(/^\/(movie|tv)\/popular$/);
  if (m) {
    const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
    return catalog(m[1] === "movie" ? "movie" : "series", "top", {
      skip: (page - 1) * 100,
    });
  }

  // /discover/{movie|tv}?sort_by=&with_genres=&page=N
  m = pathname.match(/^\/discover\/(movie|tv)$/);
  if (m) {
    const type = m[1] === "movie" ? "movie" : "series";
    const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
    const sort = params.get("sort_by") || "popularity.desc";
    const genreId = params.get("with_genres");
    const genreMap = m[1] === "movie" ? MOVIE_GENRES : TV_GENRES;
    const genre = genreId ? genreMap[genreId] || null : null;
    // year= catalog exists but has no genre support — with a genre selected,
    // fall back to the top catalog and let the client-side year sort order it
    const catalogId =
      sort === "vote_average.desc"
        ? "imdbRating"
        : sort === "year.desc" && !genre
          ? "year"
          : "top";
    const out = await catalog(type, catalogId, {
      skip: (page - 1) * 100,
      genre,
    });
    // Cinemeta's year catalog is only loosely ordered — enforce a strict
    // year sort on each fetched page (also covers top+genre fallbacks)
    if (sort === "year.desc" || sort === "year.asc") {
      const dir = sort === "year.desc" ? -1 : 1;
      const yr = (i) =>
        parseInt((i.release_date || i.first_air_date || "").slice(0, 4)) || 0;
      out.results.sort((a, b) => dir * (yr(a) - yr(b)));
    }
    return out;
  }

  // /search/multi
  m = pathname.match(/^\/search\/(multi|movie|tv)$/);
  if (m) {
    const query = params.get("query") || "";
    if (!query) return { results: [] };
    if (m[1] === "multi") return catalogSearch(query);
    const type = m[1] === "movie" ? "movie" : "series";
    const data = await cmGet(
      `${CINEMETA_BASE}/catalog/${type}/top/search=${encodeURIComponent(query)}.json`,
    );
    return { results: (data.metas || []).map((x) => metaToItem(x, type)) };
  }

  // /{movie|tv}/{id}/season/{n}
  m = pathname.match(/^\/tv\/([^/]+)\/season\/(\d+)$/);
  if (m) {
    const meta = await fetchCinemetaMeta("series", m[1]);
    return metaToSeason(meta, parseInt(m[2], 10));
  }

  // /{movie|tv}/{id}/{subresource}
  m = pathname.match(/^\/(movie|tv)\/([^/]+)\/([a-z_]+)$/);
  if (m) {
    const [, typeSeg, id, sub] = m;
    const kind = typeSeg === "movie" ? "movie" : "series";
    if (sub === "videos") {
      const meta = await fetchCinemetaMeta(kind, id);
      return metaToVideos(meta);
    }
    if (sub === "credits" || sub === "aggregate_credits") {
      const meta = await fetchCinemetaMeta(kind, id);
      return metaToCredits(meta);
    }
    if (sub === "external_ids") {
      const meta = await fetchCinemetaMeta(kind, id);
      return { imdb_id: meta.imdb_id || meta.id };
    }
    if (sub === "release_dates" || sub === "content_ratings") {
      return { results: [] }; // no certifications in Cinemeta
    }
    if (sub === "recommendations" || sub === "similar") {
      // No recs endpoint in Cinemeta — synthesize from the title's top genre
      // so "More like this" / For-You rows still populate keyless.
      try {
        const meta = await fetchCinemetaMeta(kind, id);
        const g = (meta.genre || [])[0];
        if (!g) return { results: [] };
        const out = await catalog(kind, "top", { genre: g });
        out.results = out.results.filter(
          (i) =>
            String(i.id) !== String(id) &&
            String(i.id) !== String(meta.imdb_id || ""),
        );
        return out;
      } catch {
        return { results: [] };
      }
    }
    throw unsupported(pathname);
  }

  // /collection/{id} — no equivalent
  m = pathname.match(/^\/collection\/[^/]+$/);
  if (m) return null;

  // /tv/episode_group/{id} — no equivalent
  m = pathname.match(/^\/tv\/episode_group\/[^/]+$/);
  if (m) throw unsupported(pathname);

  // /{movie|tv}/{id}
  m = pathname.match(/^\/(movie|tv)\/([^/?]+)$/);
  if (m) {
    const kind = m[1] === "movie" ? "movie" : "series";
    const meta = await fetchCinemetaMeta(kind, m[2]);
    return metaToDetails(meta, kind);
  }

  // /configuration — used only for token validation
  if (pathname === "/configuration") return {};

  throw unsupported(pathname);
}
