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
        { id: v.id, title: v.title, embed: v.embed, url: v.url },
        ...recents.filter((r) => r.id !== v.id),
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
  const [gay, _setGay] = useState(() => storage.get("adultGay") === true);
  const setGay = (v) => {
    storage.set("adultGay", v);
    _setGay(v);
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
  }, [cat, order, query, gay, dur, minRate]);

  useEffect(() => {
    if (mode !== "browse") return;
    const req = ++reqRef.current;
    setLoading(true);
    const q = query || cat || "all";
    const u =
      `${API}?query=${encodeURIComponent(q)}&per_page=40&page=${page}` +
      `&thumbsize=big&order=${order}${gay ? "&gay=1" : ""}`;
    const durTest = DURS.find((d) => d.id === dur)?.test;
    const rateMin = RATINGS.find((r) => r.id === minRate)?.min;
    fetch(u)
      .then((r) => r.json())
      .then((data) => {
        if (reqRef.current !== req) return;
        let vids = Array.isArray(data?.videos) ? data.videos : [];
        if (durTest) vids = vids.filter((v) => durTest(v.length_sec || 0));
        if (rateMin)
          vids = vids.filter((v) => parseFloat(v.rate || "0") >= rateMin);
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
    const res = await window.electron?.nativePlay?.({
      url,
      subtitle: subs[0]?.url || null,
      subtitles: subs,
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
                  title={r.title}
                  onClick={() => setPlaying(r)}
                >
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
              <AdultCard
                key={v.id}
                v={v}
                seen={recents.some((r) => r.id === v.id)}
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
