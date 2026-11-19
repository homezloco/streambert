import { useState, useEffect, useRef, useCallback } from "react";
import { storage, hashPin } from "../utils/storage";
import { sortSubsByPref } from "../utils/subtitles";
import { searchAllSites } from "../utils/adultSearch";
import { WarningIcon } from "../components/Icons";
import ScrollRow from "../components/ScrollRow";

const SITES = [
  { id: "eporner", name: "Eporner", url: "https://www.eporner.com" },
  { id: "xvideos", name: "XVideos", url: "https://www.xvideos.com" },
  { id: "xnxx", name: "XNXX", url: "https://www.xnxx.com" },
  { id: "pornhub", name: "Pornhub", url: "https://www.pornhub.com" },
  { id: "redtube", name: "RedTube", url: "https://www.redtube.com" },
  { id: "hqporner", name: "HQPorner", url: "https://hqporner.com" },
  { id: "hanime", name: "Hanime", url: "https://hanime.tv" },
  { id: "rule34video", name: "Rule34", url: "https://rule34video.com" },
  { id: "javmost", name: "JavMost", url: "https://javmost.cx" },
  { id: "javtiful", name: "Javtiful", url: "https://javtiful.com" },
  { id: "javhdsub", name: "JavHD-Sub", url: "https://javhd.today/jav-sub/" },
  { id: "vjav", name: "VJAV", url: "https://vjav.com" },
  { id: "youav", name: "YouAV", url: "https://www.youav.com" },
  { id: "javguru", name: "JavGuru", url: "https://jav.guru" },
  { id: "netflav", name: "NetFlav", url: "https://netflav.com" },
  { id: "sextop1", name: "SexTop1", url: "https://sextop1.net" },
  { id: "upornia", name: "Upornia", url: "https://upornia.com" },
  { id: "madou", name: "Madou", url: "https://madou.club" },
  { id: "porn91", name: "91Porn", url: "https://91porny.com" },
  { id: "bdsmstreak", name: "BDSMStreak", url: "https://bdsmstreak.com" },
  { id: "hogtv", name: "HogTV", url: "https://hog.tv" },
  { id: "punishbang", name: "PunishBang", url: "https://punishbang.com" },
  {
    id: "spankingtube",
    name: "SpankTube",
    url: "https://www.spankingtube.com",
  },
  { id: "bdsmone", name: "BDSM.one", url: "https://bdsm.one" },
  {
    id: "noodlemagazine",
    name: "Noodle",
    url: "https://noodlemagazine.com",
  },
  { id: "chaturbate", name: "Chaturbate", url: "https://chaturbate.com" },
];

const IMAGE_SITES = [
  { id: "imagefap", name: "ImageFap", url: "https://www.imagefap.com" },
  { id: "pornpics", name: "PornPics", url: "https://www.pornpics.com" },
  { id: "erome", name: "Erome", url: "https://erome.com" },
  { id: "sexcom", name: "Sex.com", url: "https://www.sex.com" },
  { id: "babesource", name: "BabeSrc", url: "https://babesource.com" },
  { id: "elitebabes", name: "EliteBabes", url: "https://www.elitebabes.com" },
  { id: "imagepost", name: "ImgPost", url: "https://imagepost.com" },
  {
    id: "eroticbeauties",
    name: "EroticBeaut",
    url: "https://eroticbeauties.net",
  },
  { id: "kindgirls", name: "KindGirls", url: "https://www.kindgirls.com" },
];

// Creator-content sites: legit platforms (Fansly, XXXFollow) plus
// OF/Patreon leak aggregators (Coomer, Kemono, …) — same legal grey as
// the movie sources. Leak domains rotate; dead tabs get swapped out.
const CREATOR_SITES = [
  { id: "fansly", name: "Fansly", url: "https://fansly.com" },
  { id: "xxxfollow", name: "XXXFollow", url: "https://xxxfollow.com" },
  { id: "coomer", name: "Coomer", url: "https://coomer.st" },
  { id: "kemono", name: "Kemono", url: "https://kemono.cr" },
  { id: "fapopedia", name: "Fapopedia", url: "https://fapopedia.net" },
  {
    id: "influencersgonewild",
    name: "InfluGW",
    url: "https://influencersgonewild.com",
  },
  { id: "gotanynudes", name: "GotNudes", url: "https://gotanynudes.com" },
  { id: "erothots", name: "EroThots", url: "https://erothots.co" },
  { id: "prothots", name: "ProThots", url: "https://prothots.com" },
  {
    id: "camwhores",
    name: "CamWhores",
    url: "https://www.camwhores.tv",
  },
];

// Eporner's free JSON catalog — no key. Drives the categorized browser;
// playback uses the per-video embed URL inside the hardened webview.
const API = "https://www.eporner.com/api/v2/video/search/";

const ORDERS = [
  { id: "top-weekly", label: "Top weekly" },
  { id: "top-monthly", label: "Top monthly" },
  { id: "top-rated", label: "Top rated" },
  { id: "most-voted", label: "Most voted" },
  { id: "popular", label: "Most viewed" },
  { id: "latest", label: "Newest" },
  { id: "longest", label: "Longest" },
];

// Client-side filters — the API only supports query/order, but every item
// carries length_sec and rate, so these are applied to each fetched page.
const DURS = [
  { id: "", label: "Any length" },
  { id: "short", label: "< 5 min", test: (s) => s < 300 },
  { id: "mid", label: "5–15 min", test: (s) => s >= 300 && s < 900 },
  { id: "long", label: "15–30 min", test: (s) => s >= 900 && s < 1800 },
  { id: "xlong", label: "30+ min", test: (s) => s >= 1800 },
];

// rate is a 0–5 score (the card badge shows it as rate×20 %)
const RATINGS = [
  { id: "", label: "Any rating" },
  { id: "3.5", label: "70%+ rated", min: 3.5 },
  { id: "4", label: "80%+ rated", min: 4 },
  { id: "4.25", label: "85%+ rated", min: 4.25 },
  { id: "4.5", label: "90%+ rated", min: 4.5 },
  { id: "4.75", label: "95%+ rated", min: 4.75 },
];

const CATS = [
  "Amateur",
  "Anal",
  "Asian",
  "Big Ass",
  "Big Tits",
  "Blonde",
  "Blowjob",
  "Brunette",
  "Compilation",
  "Creampie",
  "Cumshot",
  "Ebony",
  "Fetish",
  "Gangbang",
  "Group",
  "Hardcore",
  "Hentai",
  "Interracial",
  "Latina",
  "Lesbian",
  "Massage",
  "Masturbation",
  "Mature",
  "MILF",
  "Orgy",
  "Parody",
  "POV",
  "Public",
  "Redhead",
  "Small Tits",
  "Solo",
  "Squirt",
  "Teen",
  "Threesome",
  "Toys",
  "Webcam",
];

const fmtViews = (n) =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(1)}M`
    : n >= 1e3
      ? `${Math.round(n / 1e3)}K`
      : String(n ?? 0);

// Seconds → "m:ss" / "h:mm:ss" for the card duration badge, when the source
// API didn't already provide a label.
const fmtDur = (s) => {
  const sec = Math.round(s || 0);
  if (!sec) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

// Normalized cross-site result (see utils/adultSearch.js) → the
// Eporner-flavored shape AdultCard and the player path already expect.
const toCardV = (v) => ({
  id: v.id,
  title: v.title,
  url: v.url,
  embed: v.embed,
  default_thumb: v.thumb ? { src: v.thumb } : null,
  thumbs: (v.thumbs?.length ? v.thumbs : [v.thumb])
    .filter(Boolean)
    .map((src) => ({ src })),
  length_sec: v.duration || 0,
  length_min: v.durationMin || fmtDur(v.duration),
  rate: v.rating || 0,
  views: v.views || 0,
  keywords: v.keywords || "",
  site: v.site,
});

// Site tab row shared by Sites/Images/Creators modes: star a site to pin
// it to the front; the filter box narrows the row by name.
function SiteTabs({ list, selected, onSelect, favs, onToggleFav, filter, onFilter }) {
  const q = filter.trim().toLowerCase();
  const shown = q
    ? list.filter((s) => s.name.toLowerCase().includes(q))
    : [...list].sort(
        (a, b) => (favs.includes(b.id) ? 1 : 0) - (favs.includes(a.id) ? 1 : 0),
      );
  return (
    <>
      <input
        className="adult-search site-filter"
        placeholder="Filter sites…"
        value={filter}
        onChange={(e) => onFilter(e.target.value)}
      />
      <div className="browse-tabs site-tabs">
        {shown.map((s) => (
          <button
            key={s.id}
            className={`browse-tab site-tab${selected === s.id ? " browse-tab--active" : ""}`}
            onClick={() => onSelect(s.id)}
          >
            {s.name}
            <span
              className={`fav-star${favs.includes(s.id) ? " fav-star--on" : ""}`}
              title={favs.includes(s.id) ? "Unpin" : "Pin to front"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFav(s.id);
              }}
            >
              ★
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

function AdultCard({ v, onPlay, seen }) {
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
        {seen && <span className="adult-card__seen">✓</span>}
      </div>
      <div className="adult-card__title" title={v.title}>
        {v.title}
      </div>
      <div className="adult-card__meta">
        {v.site && (
          <span
            style={{
              color: "var(--red)",
              background: "var(--red-dim)",
              borderRadius: 4,
              padding: "0 5px",
              marginRight: 5,
              fontWeight: 700,
              fontSize: 9,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              verticalAlign: 1,
            }}
          >
            {v.site}
          </span>
        )}
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
  // Optional PIN lock (set in Settings > Privacy & Network). The unlock is
  // per-window-session only — relaunching the app re-locks the section.
  const [pinHash] = useState(() => storage.get("adultPinHash") || null);
  const [unlocked, setUnlocked] = useState(
    () => sessionStorage.getItem("adultUnlocked") === "1",
  );
  const [pinVal, setPinVal] = useState("");
  const [pinErr, setPinErr] = useState(false);
  // mode/site selections persist across visits
  const [mode, _setMode] = useState(
    () => storage.get("adultMode") || "browse",
  ); // browse | sites | images | creators
  const [site, _setSite] = useState(
    () => storage.get("adultSite") || SITES[0].id,
  );
  const [imgSite, _setImgSite] = useState(
    () => storage.get("adultImgSite") || IMAGE_SITES[0].id,
  );
  const [creatorSite, _setCreatorSite] = useState(
    () => storage.get("adultCreatorSite") || CREATOR_SITES[0].id,
  );
  const setMode = (v) => {
    storage.set("adultMode", v);
    _setMode(v);
  };
  const setSite = (v) => {
    storage.set("adultSite", v);
    _setSite(v);
  };
  const setImgSite = (v) => {
    storage.set("adultImgSite", v);
    _setImgSite(v);
  };
  const setCreatorSite = (v) => {
    storage.set("adultCreatorSite", v);
    _setCreatorSite(v);
  };
  const [favs, setFavs] = useState(() => storage.get("adultSiteFavs") || []);
  const toggleFav = (id) => {
    const next = favs.includes(id)
      ? favs.filter((f) => f !== id)
      : [...favs, id];
    setFavs(next);
    storage.set("adultSiteFavs", next);
  };
  const [tabFilter, setTabFilter] = useState("");
  const webviewRef = useRef(null);
  const [playing, _setPlaying] = useState(null);
  const [recents, setRecents] = useState(
    () => storage.get("adultRecents") || [],
  );
  const setPlaying = (v) => {
    if (v) {
      const next = [
        {
          id: v.id,
          title: v.title,
          embed: v.embed,
          url: v.url,
          kw: v.keywords || "",
          site: v.site || "",
        },
        ...recents.filter(
          (r) => r.id !== v.id && (!v.url || r.url !== v.url),
        ),
      ].slice(0, 12);
      setRecents(next);
      storage.set("adultRecents", next);
    }
    _setPlaying(v);
  };

  // browse state
  const [cat, _setCat] = useState(() => storage.get("adultCat") || null);
  const setCat = (v) => {
    storage.set("adultCat", v);
    _setCat(v);
  };
  // Persisted browse filters — coming back keeps your sort/length/rating
  const [order, _setOrder] = useState(
    () => storage.get("adultOrder") || "top-weekly",
  );
  const setOrder = (v) => {
    storage.set("adultOrder", v);
    _setOrder(v);
  };
  const [dur, _setDur] = useState(() => storage.get("adultDur") || "");
  const setDur = (v) => {
    storage.set("adultDur", v);
    _setDur(v);
  };
  const [minRate, _setMinRate] = useState(() => storage.get("adultRate") || "");
  const setMinRate = (v) => {
    storage.set("adultRate", v);
    _setMinRate(v);
  };
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  // "🌐 All" tab — merged multi-site search; still browse mode under the hood
  const [searchAll, _setSearchAll] = useState(
    () => storage.get("adultSearchAll") === true,
  );
  const setSearchAll = (v) => {
    storage.set("adultSearchAll", v);
    _setSearchAll(v);
  };
  const [gay, _setGay] = useState(() => storage.get("adultGay") === true);
  const setGay = (v) => {
    storage.set("adultGay", v);
    _setGay(v);
  };
  const [hideSeen, setHideSeen] = useState(
    () => storage.get("adultHideSeen") === true,
  );
  // Grid density for the Browse view — "s" | "m" | "l", persisted
  const [gridSize, _setGridSize] = useState(
    () => storage.get("adultGridSize") || "m",
  );
  const setGridSize = (v) => {
    storage.set("adultGridSize", v);
    _setGridSize(v);
  };
  // Random pick — prefers unwatched, and never re-picks the current video
  const pickSurprise = () => {
    if (!videos.length) return;
    const seenIds = new Set(recents.map((r) => r.id));
    // merged "All" results carry site-prefixed ids — match on url too
    const seenUrls = new Set(recents.map((r) => r.url).filter(Boolean));
    if (playing) seenIds.add(playing.id);
    const isSeen = (v) =>
      seenIds.has(v.id) || (v.url && seenUrls.has(v.url));
    const fresh = videos.filter((v) => !isSeen(v));
    const pool = fresh.length
      ? fresh
      : videos.filter((v) => v.id !== playing?.id);
    const list = pool.length ? pool : videos;
    setPlaying(list[Math.floor(Math.random() * list.length)]);
  };

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
  }, [searchAll, cat, order, query, gay, dur, minRate]);

  useEffect(() => {
    if (mode !== "browse") return;
    const req = ++reqRef.current;
    setLoading(true);
    const durTest = DURS.find((d) => d.id === dur)?.test;
    const rateMin = RATINGS.find((r) => r.id === minRate)?.min;
    // length/rating filters run client-side so they work on merged results too
    const applyFilters = (vids) => {
      if (durTest) vids = vids.filter((v) => durTest(v.length_sec || 0));
      if (rateMin)
        vids = vids.filter((v) => parseFloat(v.rate || "0") >= rateMin);
      return vids;
    };
    const append = (vids) =>
      setVideos((prev) => {
        if (page === 1) return vids;
        // later pages can resurface earlier hits — dedupe on url/id
        const keys = new Set(prev.map((p) => p.url || p.id));
        return [...prev, ...vids.filter((v) => !keys.has(v.url || v.id))];
      });
    if (searchAll) {
      // Multi-site search. The other APIs don't share Eporner's gay flag, so
      // the chip just folds into the query text instead.
      const base = query || cat || "all";
      const q = gay ? (base === "all" ? "gay" : `gay ${base}`) : base;
      searchAllSites(q, page)
        .then((items) => {
          if (reqRef.current !== req) return;
          const vids = applyFilters(items.map(toCardV));
          append(vids);
          setHasMore(items.length > 0);
        })
        .catch(() => {})
        .finally(() => {
          if (reqRef.current === req) setLoading(false);
        });
      return;
    }
    const q = query || cat || "all";
    const u =
      `${API}?query=${encodeURIComponent(q)}&per_page=40&page=${page}` +
      `&thumbsize=big&order=${order}${gay ? "&gay=1" : ""}`;
    fetch(u)
      .then((r) => r.json())
      .then((data) => {
        if (reqRef.current !== req) return;
        let vids = Array.isArray(data?.videos) ? data.videos : [];
        vids = applyFilters(vids);
        append(vids);
        setHasMore(
          data?.total_pages ? page < data.total_pages : vids.length > 0,
        );
      })
      .catch(() => {})
      .finally(() => {
        if (reqRef.current === req) setLoading(false);
      });
  }, [mode, searchAll, cat, order, query, gay, dur, minRate, page]);

  // ── Recommended: derive the top keyword terms from watched items and pull
  // the best-rated matches. Recents saved before keywords were recorded fall
  // back to significant words from their titles.
  const [reco, setReco] = useState([]);
  useEffect(() => {
    if (mode !== "browse" || recents.length === 0) {
      setReco([]);
      return;
    }
    const STOP = new Set(
      "the,and,with,for,from,that,this,hot,new,video,full,sex,xxx,very,gets,get,her,his,she,you,all,out,one,two,big,hard,after,before,when,what,who,how,are,was,but,not,had,has".split(
        ",",
      ),
    );
    const tally = {};
    for (const r of recents.slice(0, 8)) {
      const text = (r.kw || r.title || "").toLowerCase();
      for (const w of text.split(/[,\s]+/)) {
        const word = w.replace(/[^a-z0-9'-]/g, "");
        if (word.length < 3 || STOP.has(word)) continue;
        tally[word] = (tally[word] || 0) + 1;
      }
    }
    const top = Object.entries(tally)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([w]) => w);
    if (!top.length) return;
    const seen = new Set(recents.map((r) => String(r.id)));
    const u =
      `${API}?query=${encodeURIComponent(top.join(" "))}` +
      `&per_page=24&page=1&thumbsize=big&order=top-monthly${gay ? "&gay=1" : ""}`;
    let dead = false;
    fetch(u)
      .then((r) => r.json())
      .then((data) => {
        if (dead) return;
        const vids = (data?.videos || []).filter(
          (v) => !seen.has(String(v.id)),
        );
        setReco(vids.slice(0, 14));
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
    // Only when the watched set actually changes, not on filter tweaks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, recents]);

  // ── Downloading: reuse the movie downloader once a stream URL is captured ──
  const [streamUrl, setStreamUrl] = useState(null); // captured .m3u8
  const [mp4Url, setMp4Url] = useState(null); // captured direct .mp4
  const [downloader, setDownloader] = useState(null);
  const [dlState, setDlState] = useState(null); // null | "starting" | "started" | "error"
  const dlUrl = streamUrl || mp4Url;

  // Downloader availability is mode-independent — check once
  useEffect(() => {
    const folder = storage.get("downloaderFolder");
    if (folder && window.electron?.checkDownloader) {
      window.electron
        .checkDownloader(folder)
        .then((r) => setDownloader(r))
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!playing) return;
    setStreamUrl(null);
    setMp4Url(null);
    setDlState(null);
    if (!window.electron) return;
    const handler = window.electron.onM3u8Found?.((url) => {
      if (!url.startsWith("http://127.0.0.1")) setStreamUrl(url);
    });
    const mp4Handler = window.electron.onMp4Found?.((url) => {
      if (!url.startsWith("http://127.0.0.1")) setMp4Url(url);
    });
    const subHandler = window.electron.onSubtitleFound?.(({ url, lang }) =>
      setSubs((prev) =>
        prev.some((s) => s.url === url)
          ? prev
          : [...prev, { url, lang: lang || "und" }],
      ),
    );
    setSubs([]);
    return () => {
      if (handler) window.electron.offM3u8Found?.(handler);
      if (mp4Handler) window.electron.offMp4Found?.(mp4Handler);
      if (subHandler) window.electron.offSubtitleFound?.(subHandler);
    };
  }, [playing]);

  // ── Site-mode capture: same stream capture, armed for the nav ⬇ button ──
  const [siteStream, setSiteStream] = useState(null);
  const [siteDl, setSiteDl] = useState(null);
  const [subs, setSubs] = useState([]); // every captured .vtt [{url, lang}]
  useEffect(() => {
    if (mode === "browse" || playing || !window.electron) return;
    setSiteStream(null);
    setSiteDl(null);
    setSubs([]);
    const h1 = window.electron.onM3u8Found?.(
      (u) => !u.startsWith("http://127.0.0.1") && setSiteStream(u),
    );
    const h2 = window.electron.onMp4Found?.(
      (u) => !u.startsWith("http://127.0.0.1") && setSiteStream(u),
    );
    const h3 = window.electron.onSubtitleFound?.(({ url, lang }) =>
      setSubs((prev) =>
        prev.some((s) => s.url === url)
          ? prev
          : [...prev, { url, lang: lang || "und" }],
      ),
    );
    return () => {
      if (h1) window.electron.offM3u8Found?.(h1);
      if (h2) window.electron.offMp4Found?.(h2);
      if (h3) window.electron.offSubtitleFound?.(h3);
    };
  }, [mode, playing]);

  // Swap a captured stream into the app's own hls.js player — no site ads,
  // native speed/quality controls, subtitle track if one was captured.
  // Native-swap playback is tracked so a revisit resumes where you left off:
  // key is the video's browse id or the site page URL that spawned the swap
  const nativeCtxRef = useRef(null); // {key} for the active native playback
  const playNative = async (url) => {
    if (!url) return;
    let key = null;
    try {
      key = playing
        ? `v_${playing.id}`
        : `p_${webviewRef.current.getURL()}`;
    } catch {}
    nativeCtxRef.current = key ? { key } : null;
    const startTime = key ? storage.get("adultResume_" + key) || 0 : 0;
    const subsSorted = sortSubsByPref(
      subs,
      storage.get("subtitleLang") || "en",
    );
    const res = await window.electron?.nativePlay?.({
      url,
      subtitle: subsSorted[0]?.url || null,
      subtitles: subsSorted,
      startTime,
    });
    if (res?.ok && res.playerUrl) {
      try {
        webviewRef.current.src = res.playerUrl;
      } catch {}
    }
  };

  // While the webview hosts the local player, poll its <video> every 5s and
  // persist the position (progress events return null while paused — saves
  // only happen during active playback; finishing resets to 0)
  useEffect(() => {
    const t = setInterval(async () => {
      const ctx = nativeCtxRef.current;
      const wv = webviewRef.current;
      if (!ctx?.key || !wv) return;
      try {
        if (!wv.getURL().startsWith("http://127.0.0.1")) return;
        const r = await window.electron?.queryVideoProgress?.(
          wv.getWebContentsId(),
        );
        if (!r) return;
        if (r.currentTime > 15 && r.duration - r.currentTime > 20) {
          storage.set("adultResume_" + ctx.key, Math.floor(r.currentTime));
        } else if (r.duration - r.currentTime <= 20) {
          storage.set("adultResume_" + ctx.key, 0);
        }
      } catch {}
    }, 5000);
    return () => clearInterval(t);
  }, []);

  // ── Find-in-page: search text inside the embedded site ──
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [findResult, setFindResult] = useState(null); // {n, m}
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const onFound = (e) => {
      if (e.result?.finalUpdate)
        setFindResult({
          n: e.result.activeMatchOrdinal,
          m: e.result.matches,
        });
    };
    wv.addEventListener("found-in-page", onFound);
    return () => wv.removeEventListener("found-in-page", onFound);
  });
  useEffect(() => {
    if (!findText) setFindResult(null);
  }, [findText]);
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv?.findInPage) return;
    const t = setTimeout(() => {
      try {
        if (findOpen && findText) wv.findInPage(findText);
        else wv.stopFindInPage("clearSelection");
      } catch {}
    }, 250);
    return () => clearTimeout(t);
  }, [findText, findOpen]);
  const findStep = (forward) => {
    const wv = webviewRef.current;
    if (!wv?.findInPage || !findText) return;
    try {
      wv.findInPage(findText, { findNext: true, forward });
    } catch {}
  };

  // Copy the captured stream URL (for pasting into an external player)
  const copyStream = async () => {
    if (!siteStream) return;
    try {
      await navigator.clipboard.writeText(siteStream);
    } catch {
      window.electron?.copyText?.(siteStream);
    }
  };

  const startDownload = async () => {
    const downloadPath = storage.get("downloadPath");
    if (!downloader?.token || !downloadPath || !dlUrl) return;
    setDlState("starting");
    const name = (playing?.title || "video")
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    // run-download feeds the URL to the downloader binary, which handles
    // both HLS playlists and direct mp4 files
    const result = await window.electron.runDownload({
      token: downloader.token,
      m3u8Url: dlUrl,
      name,
      downloadPath,
    });
    setDlState(result?.ok ? "started" : "error");
  };

  const zoomWebview = (d) => {
    const wv = webviewRef.current;
    if (!wv?.setZoomFactor) return;
    try {
      const z = Math.min(2, Math.max(0.4, wv.getZoomFactor() + d));
      wv.setZoomFactor(z);
      storage.set("adultZoom_" + `${mode}-${zoomSiteId}`, z);
    } catch {}
  };
  const popOut = () => {
    const wv = webviewRef.current;
    if (!wv) return;
    try {
      window.electron?.openPipWindow?.(
        wv.getURL(),
        wv.getTitle?.() || current.name,
      );
    } catch {}
  };
  const openExt = () => {
    const wv = webviewRef.current;
    if (wv) {
      try {
        window.electron?.openExternal?.(wv.getURL());
      } catch {}
    }
  };

  const startSiteDownload = async () => {
    const downloadPath = storage.get("downloadPath");
    if (!downloader?.token || !downloadPath || !siteStream) return;
    setSiteDl("starting");
    let title = "";
    try {
      title = webviewRef.current?.getTitle?.() || "";
    } catch {}
    const name = (title || "video")
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    const result = await window.electron.runDownload({
      token: downloader.token,
      m3u8Url: siteStream,
      name,
      downloadPath,
    });
    setSiteDl(result?.ok ? "started" : "error");
  };

  // ── Infinite scroll: auto-load the next page near the bottom ──
  const browseRef = useRef(null);
  const sentinelRef = useRef(null);
  const savedScroll = useRef(0);
  // Restore scroll position when returning from the playing view
  useEffect(() => {
    if (!playing && browseRef.current && savedScroll.current > 0)
      browseRef.current.scrollTop = savedScroll.current;
  }, [playing]);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading)
          setPage((p) => p + 1);
      },
      { root: browseRef.current, rootMargin: "600px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading, mode]);

  // ── Per-site zoom memory: restore the saved factor once the page is up ──
  const zoomSiteId =
    mode === "images" ? imgSite : mode === "creators" ? creatorSite : site;
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || mode === "browse" || playing) return;
    const apply = () => {
      const z = storage.get("adultZoom_" + `${mode}-${zoomSiteId}`);
      if (z && wv.setZoomFactor) {
        try {
          wv.setZoomFactor(z);
        } catch {}
      }
    };
    wv.addEventListener("dom-ready", apply);
    return () => wv.removeEventListener("dom-ready", apply);
  }, [mode, playing, zoomSiteId]);

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

  if (pinHash && !unlocked) {
    return (
      <div className="adult-gate fade-in">
        <WarningIcon size={48} />
        <h2>PIN required</h2>
        <p>This section is locked. Enter your PIN to continue.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if ((await hashPin(pinVal)) === pinHash) {
              sessionStorage.setItem("adultUnlocked", "1");
              setUnlocked(true);
            } else {
              setPinErr(true);
              setPinVal("");
            }
          }}
          style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}
        >
          <input
            className="adult-search site-filter"
            style={{ maxWidth: 180, textAlign: "center" }}
            type="password"
            inputMode="numeric"
            autoFocus
            placeholder="PIN"
            value={pinVal}
            onChange={(e) => setPinVal(e.target.value)}
          />
          {pinErr && (
            <span style={{ color: "var(--red)", fontSize: 13 }}>
              Wrong PIN
            </span>
          )}
          <button className="btn btn-primary" type="submit">
            Unlock
          </button>
        </form>
      </div>
    );
  }

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
          <button
            className="btn btn-ghost dl-btn--sm"
            disabled={!videos.length}
            title="Roll another random video"
            onClick={pickSurprise}
          >
            🎲 Again
          </button>
          <button
            className="btn btn-ghost dl-btn--sm"
            disabled={!dlUrl}
            title={
              dlUrl
                ? "Play the captured stream in the built-in player (ad-free)"
                : "Waiting for the stream to load…"
            }
            onClick={() => playNative(dlUrl)}
          >
            ▶ Native
          </button>
          {downloader?.token && (
            <button
              className="btn btn-secondary dl-btn--sm"
              disabled={!dlUrl || dlState === "starting"}
              onClick={startDownload}
              title={
                dlUrl
                  ? "Download the captured stream"
                  : "Waiting for the stream to load…"
              }
            >
              {dlState === "started"
                ? "✓ Downloading"
                : dlState === "error"
                  ? "Download failed"
                  : "⬇ Download"}
            </button>
          )}
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

  const current =
    mode === "images"
      ? IMAGE_SITES.find((s) => s.id === imgSite) || IMAGE_SITES[0]
      : mode === "creators"
        ? CREATOR_SITES.find((s) => s.id === creatorSite) || CREATOR_SITES[0]
        : SITES.find((s) => s.id === site) || SITES[0];

  return (
    <div className="adult-page">
      <div className="adult-head">
        <div className="section-title" style={{ marginBottom: 0 }}>
          <span style={{ color: "var(--red)" }}>18+</span>
        </div>
        <div className="browse-tabs">
          <button
            className={`browse-tab${mode === "browse" && !searchAll ? " browse-tab--active" : ""}`}
            onClick={() => {
              setMode("browse");
              setSearchAll(false);
            }}
          >
            Browse
          </button>
          <button
            className={`browse-tab${mode === "browse" && searchAll ? " browse-tab--active" : ""}`}
            title="Search every site with a JSON API at once"
            onClick={() => {
              setMode("browse");
              setSearchAll(true);
            }}
          >
            🌐 All
          </button>
          <button
            className={`browse-tab${mode === "sites" ? " browse-tab--active" : ""}`}
            onClick={() => setMode("sites")}
          >
            Sites
          </button>
          <button
            className={`browse-tab${mode === "images" ? " browse-tab--active" : ""}`}
            onClick={() => setMode("images")}
          >
            Images
          </button>
          <button
            className={`browse-tab${mode === "creators" ? " browse-tab--active" : ""}`}
            onClick={() => setMode("creators")}
          >
            Creators
          </button>
        </div>
        {mode !== "browse" && (
          <div className="webview-nav">
            <button
              className="browse-tab"
              title="Back"
              onClick={() => webviewRef.current?.goBack()}
            >
              ←
            </button>
            <button
              className="browse-tab"
              title="Forward"
              onClick={() => webviewRef.current?.goForward()}
            >
              →
            </button>
            <button
              className="browse-tab"
              title="Reload"
              onClick={() => webviewRef.current?.reload()}
            >
              ⟳
            </button>
            <button
              className="browse-tab"
              title="Back to site home"
              onClick={() => {
                const wv = webviewRef.current;
                if (wv) wv.src = current.url;
              }}
            >
              ⌂
            </button>
            <button
              className="browse-tab"
              disabled={!siteStream}
              title={
                siteStream
                  ? "Play the captured stream in the built-in player (ad-free)"
                  : "Play a video to capture its stream"
              }
              onClick={() => playNative(siteStream)}
            >
              ▶
            </button>
            {downloader?.token && (
              <button
                className="browse-tab"
                disabled={!siteStream || siteDl === "starting"}
                title={
                  siteStream
                    ? "Download the captured stream"
                    : "Play a video to capture its stream"
                }
                onClick={startSiteDownload}
              >
                {siteDl === "started" ? "✓" : siteDl === "error" ? "!" : "⬇"}
              </button>
            )}
            <button
              className="browse-tab"
              disabled={!siteStream}
              title={
                siteStream
                  ? "Copy the captured stream URL (for an external player)"
                  : "Play a video to capture its stream"
              }
              onClick={copyStream}
            >
              ⎘
            </button>
            <button
              className="browse-tab"
              title="Zoom out"
              onClick={() => zoomWebview(-0.15)}
            >
              −
            </button>
            <button
              className="browse-tab"
              title="Zoom in"
              onClick={() => zoomWebview(0.15)}
            >
              +
            </button>
            <button
              className="browse-tab"
              title="Pop out into a separate window"
              onClick={popOut}
            >
              ⧉
            </button>
            <button
              className="browse-tab"
              title="Open in external browser (leaves the hardened session)"
              onClick={openExt}
            >
              ↗
            </button>
            <button
              className={`browse-tab${findOpen ? " browse-tab--active" : ""}`}
              title="Find in page"
              onClick={() => {
                setFindOpen((o) => !o);
                if (findOpen) setFindText("");
              }}
            >
              ⌕
            </button>
            {findOpen && (
              <span className="find-bar">
                <input
                  className="find-input"
                  placeholder="Find…"
                  autoFocus
                  value={findText}
                  onChange={(e) => setFindText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") findStep(!e.shiftKey);
                    if (e.key === "Escape") {
                      setFindText("");
                      setFindOpen(false);
                    }
                  }}
                />
                {findResult && (
                  <span className="find-count">
                    {findResult.m ? `${findResult.n}/${findResult.m}` : "0/0"}
                  </span>
                )}
                <button
                  className="browse-tab"
                  title="Previous match"
                  onClick={() => findStep(false)}
                >
                  ↑
                </button>
                <button
                  className="browse-tab"
                  title="Next match"
                  onClick={() => findStep(true)}
                >
                  ↓
                </button>
              </span>
            )}
          </div>
        )}
        {mode === "browse" && (
          <>
            {!searchAll && (
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
            )}
            <select
              className="browse-sort"
              value={dur}
              onChange={(e) => setDur(e.target.value)}
            >
              {DURS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
            <select
              className="browse-sort"
              value={minRate}
              onChange={(e) => setMinRate(e.target.value)}
            >
              {RATINGS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
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
          <SiteTabs
            list={SITES}
            selected={site}
            onSelect={setSite}
            favs={favs}
            onToggleFav={toggleFav}
            filter={tabFilter}
            onFilter={setTabFilter}
          />
        )}
        {mode === "images" && (
          <SiteTabs
            list={IMAGE_SITES}
            selected={imgSite}
            onSelect={setImgSite}
            favs={favs}
            onToggleFav={toggleFav}
            filter={tabFilter}
            onFilter={setTabFilter}
          />
        )}
        {mode === "creators" && (
          <SiteTabs
            list={CREATOR_SITES}
            selected={creatorSite}
            onSelect={setCreatorSite}
            favs={favs}
            onToggleFav={toggleFav}
            filter={tabFilter}
            onFilter={setTabFilter}
          />
        )}
      </div>

      {mode !== "browse" ? (
        <webview
          ref={webviewRef}
          key={`${mode}-${current.id}`}
          src={current.url}
          partition="persist:player"
          allowpopups="false"
          sandbox="allow-scripts allow-same-origin allow-forms"
          className="adult-webview"
        />
      ) : (
        <div
          className="adult-browse"
          ref={browseRef}
          onScroll={(e) => {
            savedScroll.current = e.currentTarget.scrollTop;
          }}
        >
          {recents.length > 0 && (
            <div className="browse-genres adult-recents">
              <span className="adult-recents-label">Recent:</span>
              {recents.map((r) => (
                <button
                  key={r.id}
                  className="browse-chip recent-chip"
                  title={r.site ? `${r.site} — ${r.title}` : r.title}
                  onClick={() => setPlaying(r)}
                >
                  {r.site && (
                    <span style={{ color: "var(--red)", fontSize: 10 }}>
                      {r.site}
                    </span>
                  )}
                  {r.title.length > 36 ? r.title.slice(0, 36) + "…" : r.title}
                  <span
                    className="recent-x"
                    title="Remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = recents.filter((x) => x.id !== r.id);
                      setRecents(next);
                      storage.set("adultRecents", next);
                    }}
                  >
                    ✕
                  </span>
                </button>
              ))}
              <button
                className="browse-chip"
                title="Clear recently watched"
                onClick={() => {
                  storage.set("adultRecents", []);
                  setRecents([]);
                }}
              >
                Clear
              </button>
            </div>
          )}
          {reco.length > 0 && (
            <div className="adult-reco">
              <div className="section-title" style={{ fontSize: 14 }}>
                Recommended for you
              </div>
              <ScrollRow>
                {reco.map((v) => (
                  <AdultCard
                    key={v.id}
                    v={v}
                    seen={recents.some((r) => r.id === v.id)}
                    onPlay={() => setPlaying(v)}
                  />
                ))}
              </ScrollRow>
            </div>
          )}
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
            <button
              className={`browse-chip${hideSeen ? " browse-chip--active" : ""}`}
              title="Hide videos you've already watched"
              onClick={() =>
                setHideSeen((v) => {
                  storage.set("adultHideSeen", !v);
                  return !v;
                })
              }
            >
              Hide seen
            </button>
            <button
              className="browse-chip"
              title="Play a random video (prefers unwatched)"
              disabled={!videos.length}
              onClick={pickSurprise}
            >
              🎲 Surprise
            </button>
            <span className="adult-grid-size" title="Grid density">
              {[
                { id: "s", label: "S", desc: "Small cards" },
                { id: "m", label: "M", desc: "Medium cards" },
                { id: "l", label: "L", desc: "Large cards" },
              ].map((o) => (
                <button
                  key={o.id}
                  className={`browse-chip${gridSize === o.id ? " browse-chip--active" : ""}`}
                  title={o.desc}
                  onClick={() => setGridSize(o.id)}
                >
                  {o.label}
                </button>
              ))}
            </span>
          </div>

          <div className={`adult-grid adult-grid--${gridSize}`}>
            {videos
              .filter(
                (v) =>
                  !hideSeen ||
                  !recents.some(
                    (r) => r.id === v.id || (v.url && r.url === v.url),
                  ),
              )
              .map((v) => (
              <AdultCard
                key={v.id}
                v={v}
                seen={recents.some(
                  (r) => r.id === v.id || (v.url && r.url === v.url),
                )}
                onPlay={() => setPlaying(v)}
              />
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
            <>
              <div ref={sentinelRef} />
              <button
                className="btn btn-secondary adult-more"
                onClick={() => setPage((p) => p + 1)}
              >
                Load more
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
