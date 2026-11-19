import { useCallback, useMemo, useState, useEffect } from "react";
import MediaCard from "../components/MediaCard";
import { imgUrl } from "../utils/api";
import { EyeIcon, WatchedIcon } from "../components/Icons";
import { useRatings, getRatingForItem } from "../utils/useRatings";
import { isRestricted } from "../utils/ageRating";
import { storage, STORAGE_KEYS } from "../utils/storage";

export default function LibraryPage({
  history,
  inProgress,
  saved,
  progress,
  onSelect,
  watched,
  onMarkWatched,
  onMarkUnwatched,
  onRemoveHistory,
}) {
  const allItems = useMemo(
    () => [...inProgress, ...saved],
    [inProgress, saved],
  );
  const { ratingsMap, ageLimitSetting } = useRatings(allItems);

  const [sort, setSort] = useState(
    () => storage.get(STORAGE_KEYS.LIBRARY_SORT) || "manual",
  );
  useEffect(() => {
    const handler = (e) => setSort(e.detail);
    window.addEventListener("streambert:library-sort-changed", handler);
    return () =>
      window.removeEventListener("streambert:library-sort-changed", handler);
  }, []);

  // Per-section view sorts (persisted locally)
  const [savedSort, setSavedSort] = useState(
    () => storage.get("libSavedSort") || "added",
  );
  const [historySort, setHistorySort] = useState(
    () => storage.get("libHistorySort") || "recent",
  );

  const changeSavedSort = (e) => {
    setSavedSort(e.target.value);
    storage.set("libSavedSort", e.target.value);
  };
  const changeHistorySort = (e) => {
    setHistorySort(e.target.value);
    storage.set("libHistorySort", e.target.value);
  };

  const sortLabels = {
    manual: "Custom order",
    title: "A-Z",
    rating: "Top rated",
    year: "Newest first",
  };

  const getRating = useCallback(
    (item) => getRatingForItem(item, ratingsMap),
    [ratingsMap],
  );
  const itemRestricted = useCallback(
    (item) => isRestricted(getRating(item).minAge, ageLimitSetting),
    [getRating, ageLimitSetting],
  );

  const itemYear = (item) =>
    String(item.release_date || item.first_air_date || item.year || "").slice(
      0,
      4,
    );
  const itemTitle = (item) => item.title || item.name || "";

  const sortedSaved = useMemo(() => {
    if (savedSort === "title")
      return [...saved].sort((a, b) => itemTitle(a).localeCompare(itemTitle(b)));
    if (savedSort === "newest")
      return [...saved].sort((a, b) => itemYear(b).localeCompare(itemYear(a)));
    if (savedSort === "oldest")
      return [...saved].sort((a, b) => itemYear(a).localeCompare(itemYear(b)));
    return saved;
  }, [saved, savedSort]);

  const sortedHistory = useMemo(() => {
    if (historySort === "title")
      return [...history].sort((a, b) =>
        itemTitle(a).localeCompare(itemTitle(b)),
      );
    return history; // "recent" — already newest-first
  }, [history, historySort]);

  return (
    <div className="fade-in">
      <div className="library-header">
        <div className="library-title">My Library</div>
        <div className="library-sub">
          Watch history, progress, and saved titles
        </div>
      </div>

      {inProgress.length > 0 && (
        <div className="library-section">
          <div className="library-section-title">Continue Watching</div>
          <div className="cards-grid">
            {inProgress.map((item, i) => {
              const pk =
                item.media_type === "movie"
                  ? `movie_${item.id}`
                  : `tv_${item.id}_s${item.season}e${item.episode}`;
              const r = getRating(item);
              const restr = itemRestricted(item);
              return (
                <MediaCard
                  key={pk}
                  item={item}
                  onClick={() => onSelect(item)}
                  progress={progress[pk] || 0}
                  watched={watched}
                  onMarkWatched={onMarkWatched}
                  onMarkUnwatched={onMarkUnwatched}
                  ageRating={r.cert}
                  restricted={restr}
                />
              );
            })}
          </div>
        </div>
      )}

      {saved.length > 0 && (
        <div className="library-section">
          <div className="library-section-title">
            Watchlist ({saved.length})
            {sort !== "manual" && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 400,
                  color: "var(--text3)",
                  marginLeft: 10,
                }}
              >
                {sortLabels[sort]}
              </span>
            )}
            <select
              className="browse-sort library-sort"
              value={savedSort}
              onChange={changeSavedSort}
            >
              <option value="added">Added</option>
              <option value="title">Title A–Z</option>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
            </select>
          </div>
          <div className="cards-grid">
            {sortedSaved.map((item) => {
              const r = getRating(item);
              const restr = itemRestricted(item);
              return (
                <MediaCard
                  key={`${item.media_type}_${item.id}`}
                  item={item}
                  onClick={() => onSelect(item)}
                  watched={watched}
                  onMarkWatched={onMarkWatched}
                  onMarkUnwatched={onMarkUnwatched}
                  ageRating={r.cert}
                  restricted={restr}
                />
              );
            })}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="library-section">
          <div className="library-section-title">
            Watch History
            <select
              className="browse-sort library-sort"
              value={historySort}
              onChange={changeHistorySort}
            >
              <option value="recent">Recent</option>
              <option value="title">Title A–Z</option>
            </select>
          </div>
          <div className="history-rows">
            {sortedHistory.map((item, i) => {
              const pk =
                item.media_type === "movie"
                  ? `movie_${item.id}`
                  : `tv_${item.id}_s${item.season}e${item.episode}`;
              const isWatched = !!watched?.[pk];
              return (
                <div
                  key={`${pk}_${item.watchedAt}`}
                  className="history-row"
                  onClick={() => onSelect(item)}
                >
                  <div className="history-thumb">
                    {item.poster_path && (
                      <img src={imgUrl(item.poster_path, "w92")} alt="" />
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      {item.title}
                      {isWatched && <WatchedIcon size={16} />}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text3)" }}>
                      {item.media_type === "tv" &&
                        item.season != null &&
                        item.episode != null && (
                          <>
                            {`S${item.season}E${item.episode}`}
                            {item.episodeName ? ` · ${item.episodeName}` : ""}
                            {" · "}
                          </>
                        )}
                      {new Date(item.watchedAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </div>
                  </div>
                  <span
                    className={`search-result-type ${item.media_type === "tv" ? "type-tv" : "type-movie"}`}
                  >
                    {item.media_type === "tv" ? "Series" : "Movie"}
                  </span>
                  {onRemoveHistory && (
                    <button
                      className="history-remove-btn"
                      title="Remove from history"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveHistory(item);
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {history.length === 0 && saved.length === 0 && (
        <div className="empty-state">
          <EyeIcon />
          <h3>Nothing here yet</h3>
          <p>
            Start watching a movie or series and your history will appear here.
          </p>
        </div>
      )}
    </div>
  );
}
