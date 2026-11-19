# Streambert — Improvement Roadmap

Working plan for the next rounds of development. Ordered by value-per-effort within each area; items marked **[big]** are multi-session features, everything else is a single loop.

---

## 1. Playback depth

### 1.1 ~~Play on TV (LAN share)~~ — DONE
Shipped: server binds 0.0.0.0, LAN-aware Host check (private ranges + hostname + *.local only), `/tv` route renders QR + URL page, 📺 button in the player opens an in-page QR overlay. `qrcode` npm package installed (graceful text fallback if absent).
- Remaining follow-up: DLNA/UPnP advertisement so TVs' built-in media browsers can discover it.

### 1.2 Chromecast sender **[big]**
Proper Google Cast support. Electron lacks `chrome.cast`; needs a custom Cast-protocol implementation or a companion web app hosted on the LAN server (which 1.1 effectively is). Only worth doing after 1.1 proves the TV-browser path isn't enough.

### 1.3 Skip intro / silence detection
AniSkip already covers anime. For general content: analyze audio for silence/theme-song regions client-side, or crowd-sourced markers where available. Hard to get right; low priority.

### 1.4 Watch-party / LAN playhead sync
Share position + play/pause between two Streambert instances (or one instance + TV browser from 1.1) over LAN. Broadcast position via WebSocket on the player server.

### ~~1.5 Subtitle sync offset~~ — DONE
± slider in the gear menu for mistimed tracks. Implementation: the `/sub` proxy route could parse the .vtt and shift cue timestamps by `?offset=`, or the player page re-times cues via `track.mode` + cue listeners. Medium complexity.

### 1.6 Custom speed presets
User-configurable speed list (e.g. 0.5/1/1.75/3) stored in settings; the gear menu currently hardcodes [0.75, 1, 1.25, 1.5, 2].

---

## 2. Discovery & sources

### ~~2.1 Cross-site adult search~~ — DONE
Browse tab currently queries only Eporner. Add a "search everywhere" mode that fires the same query at multiple site APIs (Pornhub/xHamster/SpankBang have unofficial JSON endpoints; others need HTML scraping inside the hardened session) and merges results into one grid. Biggest content-coverage win on the adult side.

- Needs a small per-site adapter (`{search(q,page) => items}`) like PLAYER_SOURCES but for search.
- Result cards deep-link to the site page — reuse the existing webview + stream capture.

### 2.2 More embed sources (ongoing)
Continue probing: vidora, vidplus, vidzee, autoembed mirrors all failed last round — retry periodically, they're flaky. Keep the rule: only add sources verified live.

### 2.3 ~~"Tonight" mode~~ — DONE
🌙 Tonight button on Browse: random popular-catalog page, filters to 6.5+ vote average, picks one. Follow-up idea: runtime cap (<2h) needs per-item detail fetches — could batch-check if worth it.

### ~~2.4 Watchlist improvements~~ — DONE
- Sort saved items (date added / release / rating).
- "Unreleased → released" notifications for saved upcoming titles.

### 2.5 Genre blending
Multi-select genre chips (fetch each genre catalog, intersect by id client-side). Cinemeta genre catalogs don't paginate combined, so cap at 2 genres.

---

## 3. Reliability intelligence

### 3.1 ~~Per-title source memory~~ — DONE
`titleSources` LRU map (200 entries) in storage.js; recorded on both success signals (m3u8 captured + video playing); picker defaults to the remembered source unless its reliability score dropped < 0.35.

### 3.2 ~~Failover visibility~~ — DONE
New `Toast` component + `useToast` hook (`.app-toast`, 3s auto-dismiss); silent source switches in handlePlay/playEpisode now show "X was unreliable — switched to Y".

### 3.3 Source health dashboard
Extend the Settings reliability grid: last success timestamp, average time-to-first-stream (record play-start latency per source).

---

## 4. Downloads & library

### 4.1 Download queue **[medium]**
Multiple concurrent downloads with pause/cancel and a queue view on DownloadsPage. The current downloader is single-shot per title.

### 4.2 Auto-prefetch next episode
After starting episode N, quietly resolve episode N+1's embed and let the stream interceptor cache the manifest (small memory cost, near-instant next-episode). Must respect "don't disturb playback" — prefetch only network, no DOM swaps.

### ~~4.3 Progress rings on posters~~ — DONE
Small arc overlay on Library cards showing watched % (progress data already exists per id).

### ~~4.4 Export/backup watch data~~ — DONE
JSON export of history + progress + saved list (backup module exists — check if it already covers these keys; if so this is just a UI button).

---

## 5. Privacy hardening

### 5.1 Per-site session isolation **[medium]**
Adult sites currently share `persist:player`. Per-site partitions (`persist:adult-<siteId>`) stop cross-site cookie correlation. Trade-off: per-site storage growth; needs the capture/intercept listeners applied to each partition.

### 5.2 Tor/proxy per-section routing
Route adult-section traffic through a different proxy than regular. Electron `session.setProxy` is per-session, so this composes with 5.1.

### ~~5.3 Panic button~~ — DONE
Global hotkey (e.g. Ctrl+Shift+X) → instantly hide window + mute. Electron `globalShortcut`.

### ~~5.4 App-wide PIN~~ — DONE
Extend the adult-section PIN gate (hashPin already in storage.js) to a launch gate covering the whole UI. Settings toggle + same lock-screen component.

---

## 6. UX polish

### 6.1 Themes
Dark-only today? Add a light theme and/or additional accent hues (accent is already a CSS var `--red`).

### 6.2 ~~Density switch~~ — DONE (already existed)
Verified: "Compact card grid" toggle in Settings → Interface, persisted, applied on start.

### 6.3 Global shortcuts sheet
The `?` overlay exists in the player; add an app-level one (navigation keys, find, surprise).

### 6.4 ~~Drag-and-drop playback~~ — DONE
Drop a video file anywhere → `openPathAtTime` pipeline (mpv → VLC → built-in player window). Uses `webUtils.getPathForFile` (new preload expose) with drop overlay hint.

### 6.5 ~~Adult grid density toggle~~ — DONE
S/M/L chips in the adult filter row, persisted as `adultGridSize` (200/280/360px min).

---

## Done recently (reference)

- Keyless metadata stack: Cinemeta catalogs + Wikidata MPAA certs + genre-synthesized recommendations. No TMDB key needed anywhere.
- 19 embed sources + HiAnime, with failover, per-source reliability learning, and a stats grid in Settings.
- Native player: multi-track subs, quality/speed/volume/mute persistence, PiP, sleep timer, A-B repeat, fit toggle, snapshot, keyboard+frame-step controls, timeline thumbnails, resume + progress reporting.
- Adult section: PIN gate, recents with keywords, "Recommended for you" row, seen badges, hide-seen, Surprise, downloads, native-swap, find-in-page, nav controls, per-site zoom.
- UX: ScrollRow arrows, back-to-top FAB, skeleton loaders, sticky browse filters, read-more overviews, focus rings.
- Plan batch 1: Play-on-TV LAN share (📺 button → QR page), per-title source memory, failover toast, drag-and-drop file playback, adult grid density, Tonight mode.
- Plan batch 2: cross-site adult search (Eporner+Pornhub+RedTube merged), poster progress rings, watchlist/history sorting, panic button (Ctrl+Shift+X), app-wide PIN, subtitle sync offset, backup coverage for new keys.
