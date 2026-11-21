import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import MediaCard from "../components/MediaCard";
import { storage } from "../utils/storage";
import { tmdbFetch, MOVIE_GENRES, TV_GENRES } from "../utils/api";
import { useRatings, getRatingForItem } from "../utils/useRatings";
import { isRestricted } from "../utils/ageRating";
import {
  useStudios,
  normalizeStudio,
  fetchStudioTitleIds,
} from "../utils/studios";

const SORTS = [
  { id: "popularity.desc", label: "Most Popular" },
  { id: "vote_average.desc", label: "Top Rated" },
  { id: "year.desc", label: "Newest" },
  { id: "year.asc", label: "Oldest" },
];

const itemYear = (i) =>
  parseInt((i.release_date || i.first_air_date || "").slice(0, 4)) || 0;

const DECADES = [
  { id: "", label: "Any decade" },
  { id: "2020s", label: "2020s", min: 2020, max: 2029 },
  { id: "2010s", label: "2010s", min: 2010, max: 2019 },
  { id: "2000s", label: "2000s", min: 2000, max: 2009 },
  { id: "1990s", label: "1990s", min: 1990, max: 1999 },
  { id: "old", label: "Pre-1990", min: 0, max: 1989 },
];

export default function BrowsePage({
  apiKey,
  onSelect,
  watched,
  onMarkWatched,
  onMarkUnwatched,
  initial,
}) {
  const [type, _setType] = useState(
    initial?.type === "tv" ? "tv" : storage.get("browseType") || "movie",
  );
  const setType = (v) => {
    storage.set("browseType", v);
    _setType(v);
  };
  const [sort, _setSort] = useState(
    initial?.sort || storage.get("browseSort") || "popularity.desc",
  );
  const setSort = (v) => {
    storage.set("browseSort", v);
    _setSort(v);
  };
  const [genre, setGenre] = useState(initial?.genre || null);
  const [decade, _setDecade] = useState(storage.get("browseDecade") || "");
  const setDecade = (v) => {
    storage.set("browseDecade", v);
    _setDecade(v);
  };
  // Studio/network browse — selection stored as normalized key + display
  // name (variant spellings like "HBO" vs "HBO Entertainment" merge)
  const [studio, _setStudio] = useState(() =>
    normalizeStudio(initial?.studio || storage.get("browseStudio") || ""),
  );
  const [studioName, _setStudioName] = useState(
    initial?.studio || storage.get("browseStudioName") || "",
  );
  const setStudio = (norm, display) => {
    storage.set("browseStudio", norm);
    storage.set("browseStudioName", display || "");
    _setStudio(norm);
    _setStudioName(display || norm);
  };
  // "Hide watched" — persisted so it survives page switches
  const [hideWatched, _setHideWatched] = useState(
    () => storage.get("browseHideWatched") === true,
  );
  const setHideWatched = (v) => {
    storage.set("browseHideWatched", v);
    _setHideWatched(v);
  };
  const [items, setItems] = useState([]);
  // Text search — overrides catalog browsing when non-empty
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(searchText.trim()), 400);
    return () => clearTimeout(t);
  }, [searchText]);
  // Fold committed queries into the shared history (Ctrl+K modal)
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    storage.set(
      "searchHistory",
      [q, ...(storage.get("searchHistory") || []).filter((h) => h !== q)].slice(
        0,
        12,
      ),
    );
  }, [query]);
  const [pageNum, setPageNum] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const genres = type === "movie" ? MOVIE_GENRES : TV_GENRES;

  // Filters changed → back to page 1
  useEffect(() => {
    setItems([]);
    setPageNum(1);
    setHasMore(true);
  }, [type, sort, genre, query]);

  // Page fetch. Cinemeta genre catalogs don't paginate server-side, so a
  // short/empty second page simply ends the list. Text search goes through
  // /search (works keyless via Cinemeta search catalogs) and is single-page.
  // Skipped entirely while a studio catalog is shown.
  useEffect(() => {
    let mounted = true;
    if (studio) {
      setLoading(false);
      return;
    }
    setLoading(true);
    if (query) {
      if (pageNum > 1) {
        setLoading(false);
        return;
      }
      tmdbFetch(
        `/search/${type}?query=${encodeURIComponent(query)}`,
        apiKey,
      )
        .then((d) => {
          if (!mounted) return;
          setItems(
            (d?.results || []).map((i) => ({ ...i, media_type: type })),
          );
          setHasMore(false);
        })
        .catch(() => {
          if (mounted) setItems([]);
        })
        .finally(() => mounted && setLoading(false));
      return;
    }
    const qs = new URLSearchParams({ sort_by: sort, page: String(pageNum) });
    if (genre) qs.set("with_genres", String(genre));
    tmdbFetch(`/discover/${type}?${qs.toString()}`, apiKey)
      .then((d) => {
        if (!mounted) return;
        const res = (d?.results || []).map((i) => ({ ...i, media_type: type }));
        setItems((prev) => {
          const merged = pageNum === 1 ? res : [...prev, ...res];
          // Keep the accumulated list in year order across appended pages
          if (sort === "year.desc" || sort === "year.asc") {
            const dir = sort === "year.desc" ? -1 : 1;
            return [...merged].sort(
              (a, b) => dir * (itemYear(a) - itemYear(b)),
            );
          }
          return merged;
        });
        if (res.length < 10) setHasMore(false);
      })
      .catch(() => {
        if (mounted) setHasMore(false);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [type, sort, genre, query, pageNum, apiKey, studio]);

  const { ratingsMap, ageLimitSetting } = useRatings(items);
  const studioMap = useStudios(items);

  // Companies present across loaded items, grouped by normalized name
  // (merges variants), most common first
  const studioOptions = useMemo(() => {
    const groups = new Map();
    for (const i of items) {
      for (const name of studioMap[i.id] || []) {
        const key = normalizeStudio(name);
        if (!key) continue;
        const g = groups.get(key) || { label: name, count: 0 };
        g.count++;
        if (name.length < g.label.length) g.label = name;
        groups.set(key, g);
      }
    }
    return [...groups.entries()]
      .map(([key, g]) => ({ key, ...g }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 60);
  }, [items, studioMap]);

  // Studio mode: resolve the company on Wikidata → its full title list →
  // detail cards. A real per-studio catalog, not just a loaded-items filter.
  const [studioItems, setStudioItems] = useState(null);
  const [studioLoading, setStudioLoading] = useState(false);
  useEffect(() => {
    if (!studio) {
      setStudioItems(null);
      return;
    }
    let cancelled = false;
    setStudioLoading(true);
    setStudioItems(null);
    (async () => {
      const label = studioName || studio;
      const ids = await fetchStudioTitleIds(label, type).catch(() => []);
      const out = [];
      const slice = ids.slice(0, 60);
      for (let i = 0; i < slice.length; i += 8) {
        if (cancelled) return;
        await Promise.all(
          slice.slice(i, i + 8).map(async (id) => {
            try {
              const d = await tmdbFetch(`/${type}/${id}`, apiKey);
              if (d && (d.id || d.title || d.name))
                out.push({ ...d, media_type: type });
            } catch {}
          }),
        );
      }
      if (!cancelled) {
        setStudioItems(out);
        setStudioLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studio, studioName, type, apiKey]);

  const getRating = useCallback(
    (item) => getRatingForItem(item, ratingsMap),
    [ratingsMap],
  );
  const itemRestricted = useCallback(
    (item) =>
      isRestricted(getRatingForItem(item, ratingsMap).minAge, ageLimitSetting),
    [ratingsMap, ageLimitSetting],
  );

  // Auto-load the next page when the sentinel nears the viewport
  const sentinelRef = useRef(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading)
          setPageNum((n) => n + 1);
      },
      { rootMargin: "600px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading]);

  // Client-side decade filter (no server-side year range in Cinemeta).
  // In studio mode the base list is the studio's catalog and genre/search/
  // sort apply client-side too.
  const decadeRange = DECADES.find((d) => d.id === decade);
  const baseList = studio ? studioItems || [] : items;
  const shown = useMemo(() => {
    let list = baseList.filter((i) => {
      if (
        decadeRange?.min != null &&
        (itemYear(i) < decadeRange.min || itemYear(i) > decadeRange.max)
      )
        return false;
      if (hideWatched && watched?.[`${i.media_type || type}_${i.id}`])
        return false;
      if (studio) {
        if (genre != null && !(i.genre_ids || []).includes(genre))
          return false;
        if (query) {
          const t = (i.title || i.name || "").toLowerCase();
          if (!t.includes(query.toLowerCase())) return false;
        }
      }
      return true;
    });
    if (studio) {
      if (sort === "year.desc" || sort === "year.asc") {
        const dir = sort === "year.desc" ? -1 : 1;
        list = [...list].sort((a, b) => dir * (itemYear(a) - itemYear(b)));
      } else {
        // popularity/top-rated → imdbRating is the closest keyless signal
        list = [...list].sort(
          (a, b) => (b.vote_average || 0) - (a.vote_average || 0),
        );
      }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    baseList,
    decadeRange,
    hideWatched,
    watched,
    type,
    studio,
    genre,
    query,
    sort,
  ]);

  const enrichedRatingsMap = useMemo(() => {
    const out = {};
    for (const [k, v] of Object.entries(ratingsMap)) {
      out[k] = { ...v, restricted: isRestricted(v.minAge, ageLimitSetting) };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratingsMap, ageLimitSetting]);

  return (
    <div className="fade-in" style={{ paddingBottom: 40 }}>
      <div className="section">
        <div className="browse-sticky">
        <div className="browse-head">
          <div className="section-title" style={{ marginBottom: 0 }}>
            Browse
          </div>
          <div className="browse-tabs">
            {[
              { id: "movie", label: "Movies" },
              { id: "tv", label: "Series" },
            ].map((t) => (
              <button
                key={t.id}
                className={
                  "browse-tab" + (type === t.id ? " browse-tab--active" : "")
                }
                onClick={() => setType(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <input
            className="site-filter"
            style={{ width: 150 }}
            placeholder={`Search ${type === "tv" ? "series" : "movies"}…`}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <select
            className="browse-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            disabled={!!query && !studio}
            title={
              query && !studio
                ? "Sorting is disabled while searching"
                : undefined
            }
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            className="browse-sort"
            value={decade}
            onChange={(e) => setDecade(e.target.value)}
          >
            {DECADES.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          {(studioOptions.length > 0 || studio) && (
            <select
              className="browse-sort"
              value={studio}
              onChange={(e) => {
                const key = e.target.value;
                const opt = studioOptions.find((o) => o.key === key);
                setStudio(key, opt ? opt.label : "");
              }}
              title="Browse a studio/network's full catalog (via Wikidata)"
            >
              <option value="">Any studio</option>
              {studio &&
                !studioOptions.some((o) => o.key === studio) &&
                studioName && (
                  <option value={studio}>{studioName}</option>
                )}
              {studioOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          <button
            className="browse-chip"
            title="Open a random title from what's loaded"
            disabled={!shown.length}
            onClick={() =>
              onSelect(shown[Math.floor(Math.random() * shown.length)])
            }
          >
            🎲 Surprise
          </button>
          <button
            className="browse-chip"
            title="A well-rated random pick for tonight (6.5+) — respects your genre/decade filters"
            onClick={async () => {
              for (let tries = 0; tries < 3; tries++) {
                try {
                  const page = 1 + Math.floor(Math.random() * 10);
                  const qs = new URLSearchParams({
                    sort_by: "popularity.desc",
                    page: String(page),
                  });
                  if (genre) qs.set("with_genres", String(genre));
                  const d = await tmdbFetch(
                    `/discover/${type}?${qs.toString()}`,
                    apiKey,
                  );
                  const pool = (d?.results || [])
                    .map((i) => ({ ...i, media_type: type }))
                    .filter(
                      (i) =>
                        (i.vote_average || 0) >= 6.5 &&
                        (decadeRange?.min == null ||
                          (itemYear(i) >= decadeRange.min &&
                            itemYear(i) <= decadeRange.max)),
                    );
                  if (pool.length) {
                    onSelect(
                      pool[Math.floor(Math.random() * pool.length)],
                    );
                    return;
                  }
                } catch {}
              }
            }}
          >
            🌙 Tonight
          </button>
          <button
            className={
              "browse-chip" + (hideWatched ? " browse-chip--active" : "")
            }
            title="Hide titles you've already watched"
            onClick={() => setHideWatched(!hideWatched)}
          >
            Hide watched
          </button>
        </div>

        <div className="browse-genres">
          <button
            className={
              "browse-chip" + (genre === null ? " browse-chip--active" : "")
            }
            onClick={() => setGenre(null)}
          >
            All
          </button>
          {Object.entries(genres).map(([id, name]) => (
            <button
              key={id}
              className={
                "browse-chip" +
                (genre === Number(id) ? " browse-chip--active" : "")
              }
              onClick={() =>
                setGenre(genre === Number(id) ? null : Number(id))
              }
            >
              {name}
            </button>
          ))}
        </div>
        </div>

        {studio && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              margin: "4px 0 12px",
              fontSize: 13,
              color: "var(--text2)",
            }}
          >
            <span>
              Studio:{" "}
              <strong style={{ color: "var(--text1)" }}>
                {studioName || studio}
              </strong>
              {studioItems && (
                <span style={{ color: "var(--text3)" }}>
                  {" "}
                  · {studioItems.length} title
                  {studioItems.length !== 1 ? "s" : ""}
                </span>
              )}
            </span>
            <button
              className="browse-chip"
              onClick={() => setStudio("", "")}
            >
              ✕ Clear
            </button>
          </div>
        )}

        {studio && studioLoading && (
          <div className="cards-grid">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="card-skeleton" />
            ))}
          </div>
        )}

        {studio && !studioLoading && studioItems && studioItems.length === 0 && (
          <div
            style={{ color: "var(--text3)", padding: "40px 0", fontSize: 14 }}
          >
            No titles found for this studio on Wikidata.
          </div>
        )}

        {!studio && items.length === 0 && loading && (
          <div className="cards-grid">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="card-skeleton" />
            ))}
          </div>
        )}
        {!studio && items.length === 0 && !loading && (
          <div
            style={{ color: "var(--text3)", padding: "40px 0", fontSize: 14 }}
          >
            Nothing found for this filter.
          </div>
        )}

        <div className="cards-grid">
          {shown.map((item) => {
            const rk = `${type}_${item.id}`;
            const rd = enrichedRatingsMap[rk] || {};
            const r = getRating(item);
            return (
              <MediaCard
                key={`${type}_${item.id}`}
                item={item}
                onClick={() => onSelect(item)}
                progress={0}
                watched={watched}
                onMarkWatched={onMarkWatched}
                onMarkUnwatched={onMarkUnwatched}
                ageRating={r.cert}
                restricted={rd.restricted}
              />
            );
          })}
        </div>

        {!studio && items.length > 0 && hasMore && (
          <div style={{ textAlign: "center", marginTop: 20 }}>
            <div ref={sentinelRef} />
            <button
              className="btn btn-secondary"
              disabled={loading}
              onClick={() => setPageNum((n) => n + 1)}
            >
              {loading ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
