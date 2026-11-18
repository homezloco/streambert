import { useState, useEffect, useMemo, useCallback } from "react";
import MediaCard from "../components/MediaCard";
import { tmdbFetch, MOVIE_GENRES, TV_GENRES } from "../utils/api";
import { useRatings, getRatingForItem } from "../utils/useRatings";
import { isRestricted } from "../utils/ageRating";

const SORTS = [
  { id: "popularity.desc", label: "Most Popular" },
  { id: "vote_average.desc", label: "Top Rated" },
  { id: "year.desc", label: "Newest" },
  { id: "year.asc", label: "Oldest" },
];

const itemYear = (i) =>
  parseInt((i.release_date || i.first_air_date || "").slice(0, 4)) || 0;

export default function BrowsePage({
  apiKey,
  onSelect,
  watched,
  onMarkWatched,
  onMarkUnwatched,
  initial,
}) {
  const [type, setType] = useState(initial?.type === "tv" ? "tv" : "movie");
  const [sort, setSort] = useState(initial?.sort || "popularity.desc");
  const [genre, setGenre] = useState(initial?.genre || null);
  const [items, setItems] = useState([]);
  const [pageNum, setPageNum] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const genres = type === "movie" ? MOVIE_GENRES : TV_GENRES;

  // Filters changed → back to page 1
  useEffect(() => {
    setItems([]);
    setPageNum(1);
    setHasMore(true);
  }, [type, sort, genre]);

  // Page fetch. Cinemeta genre catalogs don't paginate server-side, so a
  // short/empty second page simply ends the list.
  useEffect(() => {
    let mounted = true;
    setLoading(true);
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
  }, [type, sort, genre, pageNum, apiKey]);

  const { ratingsMap, ageLimitSetting } = useRatings(items);

  const getRating = useCallback(
    (item) => getRatingForItem(item, ratingsMap),
    [ratingsMap],
  );
  const itemRestricted = useCallback(
    (item) =>
      isRestricted(getRatingForItem(item, ratingsMap).minAge, ageLimitSetting),
    [ratingsMap, ageLimitSetting],
  );

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
          <select
            className="browse-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
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

        {items.length === 0 && loading && (
          <div className="loader">
            <div className="spinner" />
          </div>
        )}
        {items.length === 0 && !loading && (
          <div
            style={{ color: "var(--text3)", padding: "40px 0", fontSize: 14 }}
          >
            Nothing found for this filter.
          </div>
        )}

        <div className="cards-grid">
          {items.map((item) => {
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

        {items.length > 0 && hasMore && (
          <div style={{ textAlign: "center", marginTop: 20 }}>
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
