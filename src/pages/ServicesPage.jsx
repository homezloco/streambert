import { useState, useEffect, useRef, useCallback } from "react";
import { storage } from "../utils/storage";

// ── Streaming services ──────────────────────────────────────────────────────
// Each service runs in its own persist:svc_<id> partition — cookies/logins
// are isolated per service and never shared with the rest of the app.
//
// `drm` marks services whose playback needs Widevine. Electron doesn't ship
// the CDM, so those let you browse + log in but won't play video until
// Widevine support lands. Free/ad-supported services play today.
const SERVICES = [
  { id: "youtube", name: "YouTube", url: "https://www.youtube.com" },
  { id: "twitch", name: "Twitch", url: "https://www.twitch.tv" },
  { id: "tubi", name: "Tubi", url: "https://tubitv.com" },
  { id: "pluto", name: "Pluto TV", url: "https://pluto.tv" },
  { id: "plex", name: "Plex", url: "https://app.plex.tv" },
  { id: "xumo", name: "Xumo Play", url: "https://play.xumo.com" },
  { id: "crackle", name: "Crackle", url: "https://www.crackle.com" },
  { id: "roku", name: "Roku Channel", url: "https://therokuchannel.roku.com" },
  { id: "slingfree", name: "Sling Freestream", url: "https://watch.sling.com" },
  { id: "dailymotion", name: "Dailymotion", url: "https://www.dailymotion.com" },
  { id: "vimeo", name: "Vimeo", url: "https://vimeo.com" },
  { id: "arte", name: "Arte.tv", url: "https://www.arte.tv" },
  { id: "zdf", name: "ZDFmediathek", url: "https://www.zdf.de" },
  { id: "joyn", name: "Joyn", url: "https://www.joyn.de" },
  { id: "cbc", name: "CBC Gem", url: "https://gem.cbc.ca" },
  { id: "sbs", name: "SBS On Demand", url: "https://www.sbs.com.au/ondemand" },
  { id: "9now", name: "9Now", url: "https://www.9now.com.au" },
  { id: "7plus", name: "7plus", url: "https://7plus.com.au" },
  { id: "10play", name: "10 play", url: "https://10play.com.au" },
  { id: "tvnz", name: "TVNZ+", url: "https://www.tvnz.co.nz" },
  { id: "rte", name: "RTÉ Player", url: "https://www.rte.ie/player" },
  { id: "tf1", name: "TF1+", url: "https://www.tf1.fr" },
  { id: "npo", name: "NPO Start", url: "https://www.npostart.nl" },
  { id: "svt", name: "SVT Play", url: "https://www.svtplay.se" },
  { id: "nrk", name: "NRK TV", url: "https://tv.nrk.no" },
  { id: "yle", name: "Yle Areena", url: "https://areena.yle.fi" },
  // ── Subscription services (Widevine DRM — browse/login works) ──
  { id: "netflix", name: "Netflix", url: "https://www.netflix.com", drm: true },
  { id: "disney", name: "Disney+", url: "https://www.disneyplus.com", drm: true },
  { id: "hulu", name: "Hulu", url: "https://www.hulu.com", drm: true },
  { id: "max", name: "Max", url: "https://www.max.com", drm: true },
  {
    id: "paramount",
    name: "Paramount+",
    url: "https://www.paramountplus.com",
    drm: true,
  },
  { id: "crave", name: "Crave", url: "https://www.crave.ca", drm: true },
  {
    id: "prime",
    name: "Prime Video",
    url: "https://www.primevideo.com",
    drm: true,
  },
  { id: "appletv", name: "Apple TV+", url: "https://tv.apple.com", drm: true },
  { id: "peacock", name: "Peacock", url: "https://www.peacocktv.com", drm: true },
  {
    id: "discovery",
    name: "Discovery+",
    url: "https://www.discoveryplus.com",
    drm: true,
  },
  { id: "ytv", name: "YouTube TV", url: "https://tv.youtube.com", drm: true },
  { id: "philo", name: "Philo", url: "https://www.philo.com", drm: true },
  { id: "shudder", name: "Shudder", url: "https://www.shudder.com", drm: true },
  { id: "amc", name: "AMC+", url: "https://www.amcplus.com", drm: true },
  { id: "britbox", name: "BritBox", url: "https://www.britbox.com", drm: true },
  { id: "mubi", name: "MUBI", url: "https://mubi.com", drm: true },
  {
    id: "crunchyroll",
    name: "Crunchyroll",
    url: "https://www.crunchyroll.com",
    drm: true,
  },
];

export default function ServicesPage() {
  const [svc, _setSvc] = useState(() => storage.get("svcSite") || "youtube");
  const setSvc = (v) => {
    storage.set("svcSite", v);
    _setSvc(v);
  };
  const [favs, setFavs] = useState(() => storage.get("svcFavs") || []);
  const toggleFav = (id) => {
    const next = favs.includes(id)
      ? favs.filter((f) => f !== id)
      : [...favs, id];
    setFavs(next);
    storage.set("svcFavs", next);
  };
  const [filter, setFilter] = useState("");
  const [wvStatus, setWvStatus] = useState(null);
  useEffect(() => {
    window.electron?.getWidevineStatus?.().then(setWvStatus).catch(() => {});
  }, []);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [findResult, setFindResult] = useState(null);
  const webviewRef = useRef(null);
  const findTimer = useRef(null);

  const current = SERVICES.find((s) => s.id === svc) || SERVICES[0];

  // Find-in-page wiring
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const onFound = (e) => {
      const r = e.result || {};
      setFindResult({ n: r.activeMatchOrdinal || 0, m: r.matches || 0 });
    };
    try {
      wv.addEventListener("found-in-page", onFound);
    } catch {}
    return () => {
      try {
        wv.removeEventListener("found-in-page", onFound);
      } catch {}
    };
  }, [svc]);

  const findStep = useCallback(
    (forward) => {
      const wv = webviewRef.current;
      if (!wv || !findText) return;
      try {
        wv.findInPage(findText, {
          forward,
          findNext: true,
          matchCase: false,
        });
      } catch {}
    },
    [findText],
  );

  useEffect(() => {
    clearTimeout(findTimer.current);
    if (!findText) return;
    findTimer.current = setTimeout(() => findStep(true), 300);
    return () => clearTimeout(findTimer.current);
  }, [findText, findStep]);

  const zoom = (d) => {
    const wv = webviewRef.current;
    if (!wv?.setZoomFactor) return;
    try {
      const z = Math.min(2, Math.max(0.4, wv.getZoomFactor() + d));
      wv.setZoomFactor(z);
      storage.set(`svcZoom_${svc}`, z);
    } catch {}
  };

  // Restore per-service zoom
  useEffect(() => {
    const wv = webviewRef.current;
    const z = storage.get(`svcZoom_${svc}`);
    if (wv && z) {
      try {
        wv.addEventListener("dom-ready", () => wv.setZoomFactor(z), {
          once: true,
        });
      } catch {}
    }
  }, [svc]);

  const q = filter.trim().toLowerCase();
  const shown = q
    ? SERVICES.filter((s) => s.name.toLowerCase().includes(q))
    : [...SERVICES].sort(
        (a, b) => (favs.includes(b.id) ? 1 : 0) - (favs.includes(a.id) ? 1 : 0),
      );

  return (
    <div className="adult-page svc-page">
      <div className="adult-head">
        <div className="section-title" style={{ marginBottom: 0 }}>
          <span style={{ color: "var(--red)" }}>Services</span>
        </div>
        <input
          className="adult-search site-filter"
          placeholder="Filter services…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="browse-tabs site-tabs">
          {shown.map((s) => (
            <button
              key={s.id}
              className={`browse-tab site-tab${svc === s.id ? " browse-tab--active" : ""}`}
              title={s.drm ? `${s.name} — needs Widevine (playback may fail)` : s.name}
              onClick={() => setSvc(s.id)}
            >
              {s.drm && (
                <span style={{ opacity: 0.6, fontSize: 10 }}>🔒 </span>
              )}
              {s.name}
              <span
                className={`fav-star${favs.includes(s.id) ? " fav-star--on" : ""}`}
                title={favs.includes(s.id) ? "Unpin" : "Pin to front"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFav(s.id);
                }}
              >
                ★
              </span>
            </button>
          ))}
        </div>
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
            title="Back to service home"
            onClick={() => {
              const wv = webviewRef.current;
              if (wv) wv.src = current.url;
            }}
          >
            ⌂
          </button>
          <button
            className="browse-tab"
            title="Zoom out"
            onClick={() => zoom(-0.15)}
          >
            −
          </button>
          <button className="browse-tab" title="Zoom in" onClick={() => zoom(0.15)}>
            +
          </button>
          <button
            className="browse-tab"
            title="Pop out into a separate window"
            onClick={() => {
              const wv = webviewRef.current;
              if (wv)
                window.electron?.openPipWindow?.(
                  wv.getURL(),
                  wv.getTitle?.() || current.name,
                );
            }}
          >
            ⧉
          </button>
          <button
            className="browse-tab"
            title="Open in external browser (leaves the isolated session)"
            onClick={() => {
              const wv = webviewRef.current;
              if (wv) window.electron?.openExternal?.(wv.getURL());
            }}
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
        {current.drm && wvStatus && !wvStatus.installed && (
          <div className="svc-drm-note">
            🔒 {current.name} uses Widevine DRM — sign-in and browsing work,
            playback needs the CDM. Install it under Settings → Playback →
            Widevine CDM.
          </div>
        )}
        {current.drm && wvStatus?.installed && !wvStatus.loadedAtLaunch && (
          <div className="svc-drm-note">
            🔒 Widevine installed — restart the app once to activate DRM
            playback on {current.name}.
          </div>
        )}
      </div>
      <webview
        ref={webviewRef}
        key={`svc-${current.id}`}
        src={current.url}
        partition={`persist:svc_${current.id}`}
        allowpopups="false"
        sandbox="allow-scripts allow-same-origin allow-forms"
        className="adult-webview"
      />
    </div>
  );
}
