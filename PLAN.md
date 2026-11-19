# Streambert — Improvement Roadmap

Working plan for the next rounds of development. Ordered by value-per-effort within each area; items marked **[big]** are multi-session features, everything else is a single loop.

---

## 1. Playback depth

### 1.1 Play on TV (LAN share) — top pick
Bind the local player server (`src/ipc/hianime.js`) to `0.0.0.0` in addition to `127.0.0.1`, and add a "Play on TV" button that shows a QR/link (`http://<lan-ip>:<port>/player?t=<token>`). Any TV with a browser (Fire Stick Silk, Android TV, LG/Samsung built-in) can then play the exact same token-gated player — quality, subtitles, resume, A-B repeat all work.

- Server already token-gates every route; binding LAN is safe as long as the token stays unguessable (it is — random per session).
- Scope: `getPlayerServer` listen call, a small modal in the player header showing URL + QR (generate QR client-side, e.g. `qrcode` npm lib or a tiny hand-rolled encoder).
- Follow-up: DLNA/UPnP advertisement so TVs' built-in media browsers can discover it.

### 1.2 Chromecast sender **[big]**
Proper Google Cast support. Electron lacks `chrome.cast`; needs a custom Cast-protocol implementation or a companion web app hosted on the LAN server (which 1.1 effectively is). Only worth doing after 1.1 proves the TV-browser path isn't enough.

### 1.3 Skip intro / silence detection
AniSkip already covers anime. For general content: analyze audio for silence/theme-song regions client-side, or crowd-sourced markers where available. Hard to get right; low priority.

### 1.4 Watch-party / LAN playhead sync
Share position + play/pause between two Streambert instances (or one instance + TV browser from 1.1) over LAN. Broadcast position via WebSocket on the player server.

### 1.5 Subtitle sync offset
± slider in the gear menu for mistimed tracks. Implementation: the `/sub` proxy route could parse the .vtt and shift cue timestamps by `?offset=`, or the player page re-times cues via `track.mode` + cue listeners. Medium complexity.

### 1.6 Custom speed presets
User-configurable speed list (e.g. 0.5/1/1.75/3) stored in settings; the gear menu currently hardcodes [0.75, 1, 1.25, 1.5, 2].

---

## 2. Discovery & sources

### 2.1 Cross-site adult search
Browse tab currently queries only Eporner. Add a "search everywhere" mode that fires the same query at multiple site APIs (Pornhub/xHamster/SpankBang have unofficial JSON endpoints; others need HTML scraping inside the hardened session) and merges results into one grid. Biggest content-coverage win on the adult side.

- Needs a small per-site adapter (`{search(q,page) => items}`) like PLAYER_SOURCES but for search.
- Result cards deep-link to the site page — reuse the existing webview + stream capture.

### 2.2 More embed sources (ongoing)
Continue probing: vidora, vidplus, vidzee, autoembed mirrors all failed last round — retry periodically, they're flaky. Keep the rule: only add sources verified live.

### 2.3 "Tonight" mode
One-click pick constrained by filters: runtime < 2h, matching decade/rating prefs, high vote average. Builds on Surprise + decade filter.

### 2.4 Watchlist improvements
- Sort saved items (date added / release / rating).
- "Unreleased → released" notifications for saved upcoming titles.

### 2.5 Genre blending
Multi-select genre chips (fetch each genre catalog, intersect by id client-side). Cinemeta genre catalogs don't paginate combined, so cap at 2 genres.

---

## 3. Reliability intelligence

### 3.1 Per-title source memory
Record which source succeeded for a given title (`srcByTitle_<id>` → sourceId, capped LRU). On revisit, preselect it. Cheap, zero UI — pure storage + picker default.

### 3.2 Failover visibility
When auto-failover fires, show a transient toast: "VidSrc didn't respond — switched to VidLink". Currently silent; users should know the system worked.

### 3.3 Source health dashboard
Extend the Settings reliability grid: last success timestamp, average time-to-first-stream (record play-start latency per source).

---

## 4. Downloads & library

### 4.1 Download queue **[medium]**
Multiple concurrent downloads with pause/cancel and a queue view on DownloadsPage. The current downloader is single-shot per title.

### 4.2 Auto-prefetch next episode
After starting episode N, quietly resolve episode N+1's embed and let the stream interceptor cache the manifest (small memory cost, near-instant next-episode). Must respect "don't disturb playback" — prefetch only network, no DOM swaps.

### 4.3 Progress rings on posters
Small arc overlay on Library cards showing watched % (progress data already exists per id).

### 4.4 Export/backup watch data
JSON export of history + progress + saved list (backup module exists — check if it already covers these keys; if so this is just a UI button).

---

## 5. Privacy hardening

### 5.1 Per-site session isolation **[medium]**
Adult sites currently share `persist:player`. Per-site partitions (`persist:adult-<siteId>`) stop cross-site cookie correlation. Trade-off: per-site storage growth; needs the capture/intercept listeners applied to each partition.

### 5.2 Tor/proxy per-section routing
Route adult-section traffic through a different proxy than regular. Electron `session.setProxy` is per-session, so this composes with 5.1.

### 5.3 Panic button
Global hotkey (e.g. Ctrl+Shift+X) → instantly hide window + mute. Electron `globalShortcut`.

### 5.4 App-wide PIN
Extend the adult-section PIN gate (hashPin already in storage.js) to a launch gate covering the whole UI. Settings toggle + same lock-screen component.

---

## 6. UX polish

### 6.1 Themes
Dark-only today? Add a light theme and/or additional accent hues (accent is already a CSS var `--red`).

### 6.2 Density switch
`compact-mode` CSS class already exists — surface it in Settings → Interface.

### 6.3 Global shortcuts sheet
The `?` overlay exists in the player; add an app-level one (navigation keys, find, surprise).

### 6.4 Drag-and-drop playback
Drop a local video file anywhere in the window → open it in the native player via `setPlayerFile` (path from the drop event; validate extension + readability).

### 6.5 Adult grid density toggle
Small/standard/large thumbnail sizes for adult Browse (grid min-width var).

---

## Done recently (reference)

- Keyless metadata stack: Cinemeta catalogs + Wikidata MPAA certs + genre-synthesized recommendations. No TMDB key needed anywhere.
- 19 embed sources + HiAnime, with failover, per-source reliability learning, and a stats grid in Settings.
- Native player: multi-track subs, quality/speed/volume/mute persistence, PiP, sleep timer, A-B repeat, fit toggle, snapshot, keyboard+frame-step controls, timeline thumbnails, resume + progress reporting.
- Adult section: PIN gate, recents with keywords, "Recommended for you" row, seen badges, hide-seen, Surprise, downloads, native-swap, find-in-page, nav controls, per-site zoom.
- UX: ScrollRow arrows, back-to-top FAB, skeleton loaders, sticky browse filters, read-more overviews, focus rings.
