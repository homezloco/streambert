# Legit Fork Plan — Codename "Multiplex"

Plan for a clean-room-ish fork of Streambert that keeps only legal
functionality and can be monetized without copyright exposure. The fork
**must remain GPL-3.0** — this document assumes monetization via convenience
and services, never via exclusivity or content access.

---

## 1. Product positioning

**"One app for all your streaming services — and everything you own."**

- Every streaming service (Netflix, Prime, Tubi, YouTube, public broadcasters)
  as isolated, logged-in webview tabs — already built in `ServicesPage.jsx`.
- Discovery UI (TMDB/Cinemeta metadata — metadata itself is legal) where
  **Play becomes "Watch on \<service\>"** and deep-links into that service's
  tab instead of a pirate embed.
- Your own media: drag-and-drop local playback, downloads folder, subtitle
  management.
- Sellable differentiators: LAN Play-on-TV, watch-party, Chromecast,
  cross-device sync, Jellyfin/Plex client.

Not this: anything that plays, captures, or downloads content the user
doesn't have rights to. That line is what makes the fork monetizable.

---

## 2. Name candidates

Top pick:

- **Multiplex** — triple meaning: (1) broadcast term for combining many
  channels onto one carrier, (2) a multiplex cinema = one building, many
  screens, (3) literally what the app does. Tagline: *"Every screen. One
  building."* Likely taken as a bare domain; `multiplex.app`,
  `themultiplex.app`, `getmultiplex` variants likely available.

Alternates:

- **Ghostlight** — the lamp left burning on a dark stage; "the theater never
  goes dark". Beautiful, but evokes one theater, not a hub.
- **Marquee** — the glowing sign listing every show. Strong visual branding.
- **Bijou** — vintage word for an elegant little cinema. Charming, less "hub".
- **Platter** — double pun: film projection platter + "served on a platter".
- **Concourse** — where paths converge; a grand hall. Less cinematic.
- **Boxset** — "all your services in one box". Cute, weaker metaphor.
- **Projectionist** — "your personal projectionist". Evocative but long.

Before committing: check GitHub/codeberg/npm/app-store collisions and run a
basic trademark search (USPTO/EUIPO) on the winner. Avoid anything
`-flix`-suffixed (Netflix is litigious) and anything popcorn-adjacent.

---

## 3. Cut — piracy-coupled code

| Code | Reason |
|---|---|
| `PLAYER_SOURCES`, `NEEDS_INTERCEPT`, `getSourceUrl`, `fetchImdbId`/`fetchTmdbNumericId` source plumbing in `src/utils/api.js` | 19 pirate embed providers |
| Stream-capture machinery in `index.js` (m3u8/mp4 interception, `getStreamMeta`, download blocking bypass) | Exists to rip streams |
| `src/ipc/allmanga.js`, `src/ipc/hianime.js`, `src/components/HiAnimeLoader.jsx`, `src/utils/episodeMappings.js` | Pirate anime scraping |
| `src/pages/AdultPage.jsx`, `src/ipc/adultChannels.js`, `src/utils/adultSearch.js`, `persist:adult_*` partitions, adult proxy settings, adult site click-killers | Tube-site scraping + adult compliance burden |
| Stream-download pipeline in `src/ipc/downloads.js`, vid-dl integration | Downloading captured streams |
| Panic button, `useAutoplay`, `useSourceId`, source reliability/`titleSources` LRU, source health grid in Settings | Only serve pirated playback |
| Adult/studio-catalog Browse features feeding those pages | Front-end to the same sources |
| "Tonight" mode's play flow | Same |

Also purge: `wyzie` mentions stay (subtitles are fine), but any README
screenshots/text showing pirate playback; `BLOCKED_HOSTS` adult-network lists
can shrink to generic tracker blocking for service webviews.

## 4. Keep — already legit

- Shell: window management, titlebar, themes/accent editor, sidebar,
  keyboard/gamepad nav, app-wide PIN, backup/export, Discord RPC.
- `ServicesPage.jsx` + `persist:svc_*` partitions — the centerpiece.
- `src/ipc/widevine.js` — keep the **runtime CDM download** model (§7).
- Guest hardening in `index.js`: popup killer, nav lock, header stripping —
  all still valuable for service webviews.
- Local playback: drag-and-drop → mpv/VLC/built-in player; player window
  (subs, speed presets, PiP, sleep timer, A-B repeat, frame-step).
- `src/ipc/subtitles.js` + wyzie — subtitle search/download is legal.
- `LibraryPage` — watch history/progress/watchlist is metadata, fine.
- `DownloadsPage` — repurposed as a *local files* manager.
- Home/Browse/Movie/TV pages as pure discovery UI.
- `studios.js`, `ageRating.js` (Wikidata), `aniSkip.js`, `cinemeta.js` —
  all metadata services, legal.
- LAN `/tv` share server + QR (`CastModal`, `qrcode`) — sells itself.

## 5. Transform

- **"Play" → "Where to watch"**: TMDB's `/{movie|tv}/{id}/watch/providers`
  endpoint returns JustWatch-powered, country-aware availability — free with
  a TMDB key. Cinemeta has no equivalent, so keyless mode is dropped and a
  TMDB key becomes required in the fork. Clicking a provider opens that
  service's webview tab, ideally landing on its search/title page via
  per-service URL patterns (`netflix.com/search?q=…`) since title IDs aren't
  portable across services.
- **Player webview flow** stays only for Services/local content; delete
  source-failover, reliability scoring, and per-title source memory.
- **Download** → restricted to user-owned local files and subtitles.
  HLS capture goes away entirely.
- **Settings** → drop adult/proxy-per-section, add service-tab management
  (reorder, hide, per-service zoom — mostly exists already).

## 6. GPL-3.0 compliance checklist

- Keep `LICENSE` verbatim; keep all existing copyright notices; add yours.
- `package.json`: keep `"license": "GPL-3.0"`, update `author`, `appId`
  (`com.<you>.<name>`), `productName`, and icon.
- Add a "Forked from truelockmc/streambert" credit in README — required in
  spirit and by notice-preservation.
- Any distributed build must ship or offer corresponding source. GitHub
  repo link in-app satisfies the offer requirement.
- **You cannot relicense, go closed-source, or add restrictions** — price
  convenience and services, never the code.

## 7. Widevine licensing

- Runtime CDM download (current design) needs **no agreement** — it fetches
  Google's signed component the same way Chromium's updater does. Ship this
  for v1.
- Bundling `WidevineCdm/` inside installers (`extraFiles` in package.json)
  requires a free Widevine agreement from widevine.com — apply only if
  runtime install proves unreliable. For a paid product, prefer staying on
  runtime download to keep redistribution clean.
- Never touch DRM itself — no CDM patching, no widevine-l3 tools. Widevine
  *playing* licensed content is legal; *circumventing* it is not.

## 8. Monetization plan

| Channel | Model | Notes |
|---|---|---|
| Paid binaries | ~$5–10 on Windows Store / Steam / Gumroad / itch | "Convenience build" model — Krita on Steam is the canonical example. Source stays free; users pay for one-click install + auto-update. **Avoid the Mac App Store** — Apple's ToS historically conflict with GPL (VLC 2011). Direct .dmg sale is fine. |
| **Sync subscription** | ~$2–3/mo hosted service | The recurring-revenue play. GPL does not extend over the network — the sync backend can stay closed-source. Syncs library, watch progress, settings, per-service layouts across devices. |
| Watch-party relay | Bundled into subscription | Extends the planned LAN playhead sync (PLAN 1.4) WAN-wide via a hosted relay. |
| Donations | GitHub Sponsors / OpenCollective | Becomes viable only *after* the clean split — processors won't touch the current app. |
| Jellyfin/Plex client | Free feature driving sales | A polished native client for self-hosted servers is the strongest *legit* differentiator — this audience demonstrably pays (Infuse). |

Avoid: in-app ads, feature-gating the free build (anyone can un-gate GPL
code — sell convenience/services instead), and any paid "access" tier.

## 9. Legal risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Residual piracy code shipped by mistake | High | Strip pass is gated on a full audit: `grep` for every removed module's symbols, plus runtime test that no embed domains are reachable. |
| Services block embedded webviews / UA issues | Medium (product, not legal) | Isolated partitions + clean UA already implemented; keep a browser-fallback per service. |
| TMDB commercial-use terms | Low–medium | TMDB API requires attribution and has commercial terms — review ToS before charging; Cinemeta/Wikidata remain fallbacks for most metadata (providers data still needs TMDB). |
| Service ToS on account isolation | Low | App acts as a browser; no credential handling beyond what a browser does. Don't scrape service catalogs — link to them. |
| "Multiplex" or chosen name conflicts | Low | Trademark search before branding (§2). |
| Upstream merges reintroducing piracy code | Medium | Fork diverges deliberately; merge upstream selectively into whitelisted modules (player, services, widevine, shell) — never merge api.js/player flows. |

## 10. Execution phases

1. **Fork skeleton** — new repo, new name/appId/icon, LICENSE + attribution
   preserved, `origin` kept as upstream remote for selective merges.
2. **Strip pass** (§3) — delete piracy modules, gut `index.js` interception
   and stream capture, remove adult partitions. Mostly deletions. Audit with
   grep over all removed symbols; smoke-test that only service domains load.
3. **Rewire playback** (§5) — TMDB providers → service deep-links; player
   page simplified to Services + local only.
4. **v1.0 polish** — README rewrite, fresh screenshots, services UX,
   Widevine status flow, local-files manager. This is the sellable baseline.
5. **Monetization infra** — store listings, donation links, auto-updater
   channel for paid builds (paid binaries can include auto-update; free
   builds check but don't auto-install — standard OSS convenience split).
6. **Recurring revenue** — sync service backend + account system; watch-party
   relay on top of it.
7. **Growth** — Jellyfin/Plex native client, Chromecast sender (PLAN 1.2),
   mobile companion.

Each phase is independently shippable. Phase 4 is the "can charge for
binaries" line; phase 6 is the "can pay rent" line.
