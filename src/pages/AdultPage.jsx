import { useState, useEffect, useRef, useCallback } from "react";
import { storage } from "../utils/storage";
import { WarningIcon } from "../components/Icons";

const SITES = [
  { id: "eporner", name: "Eporner", url: "https://www.eporner.com" },
  { id: "xvideos", name: "XVideos", url: "https://www.xvideos.com" },
  { id: "xnxx", name: "XNXX", url: "https://www.xnxx.com" },
  { id: "pornhub", name: "Pornhub", url: "https://www.pornhub.com" },
  { id: "redtube", name: "RedTube", url: "https://www.redtube.com" },
  { id: "hqporner", name: "HQPorner", url: "https://hqporner.com" },
  { id: "hanime", name: "Hanime", url: "https://hanime.tv" },
  { id: "rule34video", name: "Rule34", url: "https://rule34video.com" },
  { id: "chaturbate", name: "Chaturbate", url: "https://chaturbate.com" },
];

// Eporner's free JSON catalog — no key. Drives the categorized browser;
// playback uses the per-video embed URL inside the hardened webview.
const API = "https://www.eporner.com/api/v2/video/search/";

const ORDERS = [
  { id: "top-weekly", label: "Top weekly" },
  { id: "top-monthly", label: "Top monthly" },
  { id: "top-rated", label: "Top rated" },
  { id: "popular", label: "Most viewed" },
  { id: "latest", label: "Newest" },
  { id: "longest", label: "Longest" },
];

const CATS = [
  "Amateur",
  "Anal",
  "Asian",
  "Big Tits",
  "Blowjob",
  "Creampie",
  "Cumshot",
  "Ebony",
  "Hardcore",
  "Hentai",
  "Interracial",
  "Latina",
  "Lesbian",
  "Massage",
  "MILF",
  "POV",
  "Teen",
  "Threesome",
];

const fmtViews = (n) =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(1)}M`
    : n >= 1e3
      ? `${Math.round(n / 1e3)}K`
      : String(n ?? 0);

function AdultCard({ v, onPlay }) {
  const thumbs =
    v.thumbs?.length > 0
      ? v.thumbs.map((t) => t.src)
      : [v.default_thumb?.src].filter(Boolean);
  const [idx, setIdx] = useState(0);
  const timer = useRef(null);

  const startCycle = () => {
    if (thumbs.length < 2) return;
    timer.current = setInterval(
      () => setIdx((i) => (i + 1) % thumbs.length),
      700,
    );
  };
  const stopCycle = () => {
    clearInterval(timer.current);
    setIdx(0);
  };
  useEffect(() => () => clearInterval(timer.current), []);

  return (
    <div
      className="adult-card"
      onClick={onPlay}
      onMouseEnter={startCycle}
      onMouseLeave={stopCycle}
    >
      <div className="adult-card__thumb">
        {thumbs[0] && <img src={thumbs[idx]} alt="" loading="lazy" />}
        {v.length_min && <span className="adult-card__dur">{v.length_min}</span>}
      </div>
      <div className="adult-card__title" title={v.title}>
        {v.title}
      </div>
      <div className="adult-card__meta">
        {v.rate ? `${Math.round(parseFloat(v.rate) * 20)}%` : ""}
        {v.views ? ` · ${fmtViews(v.views)}` : ""}
      </div>
    </div>
  );
}

export default function AdultPage() {
  const [confirmed, setConfirmed] = useState(
    () => storage.get("adultConfirmed") === true,
  );
  const [mode, setMode] = useState("browse"); // browse | sites
  const [site, setSite] = useState(SITES[0].id);
  const [playing, setPlaying] = useState(null);

  // browse state
  const [cat, setCat] = useState(null);
  const [order, setOrder] = useState("top-weekly");
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  const [gay, setGay] = useState(false);
  const [videos, setVideos] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  // debounce the search box → query
  useEffect(() => {
    const t = setTimeout(() => setQuery(searchText.trim()), 400);
    return () => clearTimeout(t);
  }, [searchText]);

  // filter change → reset list
  useEffect(() => {
    setVideos([]);
    setPage(1);
    setHasMore(true);
  }, [cat, order, query, gay]);

  useEffect(() => {
    if (mode !== "browse") return;
    const req = ++reqRef.current;
    setLoading(true);
    const q = query || cat || "all";
    const u =
      `${API}?query=${encodeURIComponent(q)}&per_page=24&page=${page}` +
      `&thumbsize=big&order=${order}${gay ? "&gay=1" : ""}`;
    fetch(u)
      .then((r) => r.json())
      .then((data) => {
        if (reqRef.current !== req) return;
        const vids = Array.isArray(data?.videos) ? data.videos : [];
        setVideos((prev) => (page === 1 ? vids : [...prev, ...vids]));
        setHasMore(
          data?.total_pages ? page < data.total_pages : vids.length > 0,
        );
      })
      .catch(() => {})
      .finally(() => {
        if (reqRef.current === req) setLoading(false);
      });
  }, [mode, cat, order, query, gay, page]);

  // Same cleanup as the player pages: release tracked player webContents.
  useEffect(() => {
    return () => {
      window.electron?.playerStopped?.();
    };
  }, []);

  const stopPlaying = useCallback(() => {
    setPlaying(null);
    window.electron?.playerStopped?.();
  }, []);

  if (!confirmed) {
    return (
      <div className="adult-gate fade-in">
        <WarningIcon size={48} />
        <h2>Adult content</h2>
        <p>
          This section embeds third-party adult websites. You must be 18 or
          older (or the age of majority in your jurisdiction) to continue.
        </p>
        <button
          className="btn btn-primary"
          onClick={() => {
            storage.set("adultConfirmed", true);
            setConfirmed(true);
          }}
        >
          I am 18 or older — continue
        </button>
      </div>
    );
  }

  // ── Playing a video: its embed URL in the hardened player webview ──
  if (playing) {
    return (
      <div className="adult-page">
        <div className="adult-head">
          <button className="btn btn-ghost dl-btn--sm" onClick={stopPlaying}>
            ← Back
          </button>
          <span className="adult-playing-title">{playing.title}</span>
        </div>
        <webview
          key={playing.id}
          src={playing.embed || playing.url}
          partition="persist:player"
          allowpopups="false"
          sandbox="allow-scripts allow-same-origin allow-forms"
          className="adult-webview"
        />
      </div>
    );
  }

  const current = SITES.find((s) => s.id === site) || SITES[0];

  return (
    <div className="adult-page">
      <div className="adult-head">
        <div className="section-title" style={{ marginBottom: 0 }}>
          <span style={{ color: "var(--red)" }}>18+</span>
        </div>
        <div className="browse-tabs">
          <button
            className={`browse-tab${mode === "browse" ? " browse-tab--active" : ""}`}
            onClick={() => setMode("browse")}
          >
            Browse
          </button>
          <button
            className={`browse-tab${mode === "sites" ? " browse-tab--active" : ""}`}
            onClick={() => setMode("sites")}
          >
            Sites
          </button>
        </div>
        {mode === "browse" && (
          <>
            <select
              className="browse-sort"
              value={order}
              onChange={(e) => setOrder(e.target.value)}
            >
              {ORDERS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              className="adult-search"
              placeholder="Search…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </>
        )}
        {mode === "sites" && (
          <div className="browse-tabs">
            {SITES.map((s) => (
              <button
                key={s.id}
                className={`browse-tab${site === s.id ? " browse-tab--active" : ""}`}
                onClick={() => setSite(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {mode === "sites" ? (
        <webview
          key={site}
          src={current.url}
          partition="persist:player"
          allowpopups="false"
          sandbox="allow-scripts allow-same-origin allow-forms"
          className="adult-webview"
        />
      ) : (
        <div className="adult-browse">
          <div className="browse-genres">
            <button
              className={`browse-chip${cat === null ? " browse-chip--active" : ""}`}
              onClick={() => setCat(null)}
            >
              All
            </button>
            {CATS.map((c) => (
              <button
                key={c}
                className={`browse-chip${cat === c ? " browse-chip--active" : ""}`}
                onClick={() => setCat(cat === c ? null : c)}
              >
                {c}
              </button>
            ))}
            <button
              className={`browse-chip${gay ? " browse-chip--active" : ""}`}
              onClick={() => setGay(!gay)}
            >
              Gay
            </button>
          </div>

          <div className="adult-grid">
            {videos.map((v) => (
              <AdultCard key={v.id} v={v} onPlay={() => setPlaying(v)} />
            ))}
          </div>

          {loading && (
            <div className="loader">
              <div className="spinner" />
            </div>
          )}
          {!loading && videos.length === 0 && (
            <div className="adult-empty">No videos found.</div>
          )}
          {hasMore && !loading && videos.length > 0 && (
            <button
              className="btn btn-secondary adult-more"
              onClick={() => setPage((p) => p + 1)}
            >
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
