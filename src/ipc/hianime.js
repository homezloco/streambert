// ── IPC: HiAnime (hianime.at) episode resolver + local player server ──────────
// Re-implementation of the scraping method used by ani-cli (v5.1.6):
//   1. GET  /search?keyword=…                       → HTML, parse <h3 class="film-name">
//   2. GET  /api/theme/episode/list/{numericId}      → episode list (data-id / data-number)
//   3. GET  /api/theme/episode/servers?episodeId=…   → server list, pick "ZokoAnime"
//   4. data-hash is base64(embed url); the embed page ships `window.__P="<blob>"`
//   5. blob = base64(json XOR "otaku-embed-v1") → { src: "<master.m3u8>", subtitles: [...] }
//   6. master playlist is fetched with the embed origin as Referer
//
// Requests go through Electron's `net.fetch` (Chromium network stack, so the TLS
// fingerprint looks like a real browser, the equivalent of ani-cli's
// curl-impersonate). If it is unavailable we fall back to Node's https module.

const { app, ipcMain, net } = require("electron");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const netMod = require("net");
const crypto = require("crypto");
const os = require("os");

const BASE_URL = "https://hianime.at";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const OBFUSCATION_KEY = Buffer.from("otaku-embed-v1", "utf8");
const SERVER_NAME = "ZokoAnime";
const MAX_TEXT_BYTES = 5 * 1024 * 1024; // scraped pages / playlists are never larger

// Keep-alive pools: HLS playback issues hundreds of small requests to one host.
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 16 });

// ── SSRF guard ────────────────────────────────────────────────────────────────
// URLs come from a third-party site (embed url, stream url, subtitles) and are
// requested from the main process / the local proxy, so they must never point
// at loopback or private networks.

function isPrivateIp(ip) {
  if (netMod.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (netMod.isIPv6(ip)) {
    const l = ip.toLowerCase();
    const mapped = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return (
      l === "::" ||
      l === "::1" ||
      l.startsWith("fc") ||
      l.startsWith("fd") ||
      /^fe[89ab]/.test(l)
    );
  }
  return true;
}

async function assertPublicUrl(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error("Invalid url");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("Blocked protocol");
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (netMod.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("Blocked address");
    return u;
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("Blocked address");
  }
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error("Blocked address");
  }
  return u;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function nodeGet(urlStr, headers, timeoutMs, hops = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch {
      return reject(new Error("invalid url: " + urlStr));
    }
    const lib = u.protocol === "http:" ? http : https;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || undefined,
        path: u.pathname + u.search,
        method: "GET",
        headers: { "Accept-Encoding": "identity", ...headers },
        agent: lib === https ? httpsAgent : httpAgent,
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          hops < 8
        ) {
          res.resume();
          const loc = new URL(res.headers.location, urlStr).href;
          return assertPublicUrl(loc)
            .then(() => resolve(nodeGet(loc, headers, timeoutMs, hops + 1)))
            .catch(reject);
        }
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > MAX_TEXT_BYTES) {
            req.destroy(new Error("response too large"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.end();
  });
}

// Fetches a URL as text. `referer` is optional. Returns { status, body }.
async function hianimeGet(urlStr, { referer, accept } = {}) {
  await assertPublicUrl(urlStr);
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: accept || "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (referer) headers["Referer"] = referer;

  if (net && typeof net.fetch === "function") {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const init = { headers, redirect: "follow", signal: ctrl.signal };
      if (referer) {
        init.referrer = referer;
        init.referrerPolicy = "unsafe-url";
      }
      const res = await net.fetch(urlStr, init);
      // the redirect target is only known afterwards → reject private hosts
      if (res.url && res.url !== urlStr) await assertPublicUrl(res.url);
      const len = parseInt(res.headers.get("content-length") || "0", 10);
      if (len > MAX_TEXT_BYTES) throw new Error("response too large");
      const body = await res.text();
      if (body.length > MAX_TEXT_BYTES) throw new Error("response too large");
      return { status: res.status, body };
    } catch (e) {
      if (e?.name === "AbortError") throw new Error("timeout");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  return nodeGet(urlStr, headers, 12000);
}

// Same as hianimeGet, but throws on anything that is not 2xx and detects the
// Cloudflare challenge page.
async function hianimeCurl(urlStr, opts) {
  const res = await hianimeGet(urlStr, opts);
  if (/<title>\s*Just a moment/i.test(res.body)) {
    throw new Error("Blocked by Cloudflare (HiAnime)");
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Request failed: HTTP ${res.status} from ${urlStr}`);
  }
  return res.body;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// The theme API wraps its HTML in JSON (escaped quotes/slashes). Return plain
// HTML text no matter whether the payload is JSON or raw HTML.
function unwrapApiHtml(body) {
  let text = body;
  try {
    const json = JSON.parse(body);
    const parts = [];
    const walk = (v) => {
      if (typeof v === "string") parts.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(json);
    if (parts.length) text = parts.join("\n");
  } catch {
    // not JSON → use the raw text
  }
  return text.replace(/\\"/g, '"').replace(/\\\//g, "/").replace(/\\/g, "");
}

function getAttr(tagText, name) {
  const m = tagText.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

// ── Embed config de-obfuscation ───────────────────────────────────────────────
// base64(json XOR "otaku-embed-v1"), key repeated cyclically.

function deobfuscateBlob(blob) {
  const buf = Buffer.from(blob, "base64");
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] ^ OBFUSCATION_KEY[i % OBFUSCATION_KEY.length];
  }
  return out.toString("utf8");
}

// ── Scraping ──────────────────────────────────────────────────────────────────

// Returns [{ id, title, jname }]
async function hianimeSearch(query) {
  const q = encodeURIComponent(query).replace(/%20/g, "+");
  const html = await hianimeCurl(`${BASE_URL}/search?keyword=${q}`, {
    accept: "text/html",
  });
  // the top-10 sidebar repeats the result markup → cut it off
  const main = html.split('id="main-sidebar"')[0];
  const results = [];
  const re = /<h3 class="film-name">([\s\S]*?)<\/h3>/g;
  let m;
  while ((m = re.exec(main))) {
    const anchor = m[1].match(/<a\s+([^>]*)>/);
    if (!anchor) continue;
    const href = getAttr(anchor[1], "href");
    const title = getAttr(anchor[1], "title");
    if (!href || !title) continue;
    const id = href.split("?")[0].replace(/\/+$/, "").split("/").pop();
    if (!id) continue;
    const jname = getAttr(anchor[1], "data-jname");
    results.push({
      id,
      title: decodeEntities(title),
      jname: jname ? decodeEntities(jname) : null,
    });
  }
  return results;
}

// Returns [{ epId, number }] for a show slug such as "one-piece-100"
async function hianimeEpisodes(showId) {
  const numericId = showId.slice(showId.lastIndexOf("-") + 1);
  if (!/^\d+$/.test(numericId)) throw new Error("Invalid show id");
  const body = await hianimeCurl(
    `${BASE_URL}/api/theme/episode/list/${numericId}`,
    { referer: BASE_URL + "/" },
  );
  const html = unwrapApiHtml(body);
  const episodes = [];
  for (const chunk of html.split("ep-item").slice(1)) {
    const number = getAttr(chunk, "data-number");
    const epId = getAttr(chunk, "data-id");
    // ids from other providers have the same shape → check the slug in the link
    if (!number || !epId || !/^\d+$/.test(epId)) continue;
    if (!chunk.includes(`/watch/${showId}?ep=`)) continue;
    episodes.push({ epId, number });
  }
  return episodes;
}

// Resolves a stream for one episode. Returns
// { masterUrl, referer, malId, subtitle, resolution } or throws.
async function hianimeStream(epId, mode) {
  const body = await hianimeCurl(
    `${BASE_URL}/api/theme/episode/servers?episodeId=${epId}`,
    { referer: BASE_URL + "/" },
  );
  const html = unwrapApiHtml(body);

  // only the ZokoAnime embed is understood by deobfuscateBlob
  let hash = null;
  for (const chunk of html.split("server-item").slice(1)) {
    if (
      getAttr(chunk, "data-type") === mode &&
      getAttr(chunk, "data-server-name") === SERVER_NAME
    ) {
      hash = getAttr(chunk, "data-hash");
      if (hash) break;
    }
  }
  if (!hash) throw new Error(`No ${SERVER_NAME} server for ${mode}`);

  const embedUrl = Buffer.from(hash, "base64").toString("utf8").trim();
  if (!/^https?:\/\//i.test(embedUrl)) throw new Error("Invalid embed url");

  // the stream host wants the embed site as referer; the embed url carries the MAL id
  const referer = embedUrl.replace(/^(https?:\/\/[^/]*).*$/, "$1/");
  const malMatch = embedUrl.match(/\/mal\/(\d+)\//);
  const malId = malMatch ? parseInt(malMatch[1], 10) : null;

  const embedHtml = await hianimeCurl(embedUrl);
  const blobMatch = embedHtml.match(/window\.__P="([^"]*)"/);
  if (!blobMatch) throw new Error("Embed config not found");

  const jsonText = deobfuscateBlob(blobMatch[1]);
  let masterUrl = null;
  let subtitle = null;
  try {
    const cfg = JSON.parse(jsonText);
    const findM3u8 = (v) => {
      if (typeof v === "string") return /\.m3u8/i.test(v) ? v : null;
      if (Array.isArray(v)) {
        for (const x of v) {
          const r = findM3u8(x);
          if (r) return r;
        }
      } else if (v && typeof v === "object") {
        if (typeof v.src === "string" && /\.m3u8/i.test(v.src)) return v.src;
        for (const x of Object.values(v)) {
          const r = findM3u8(x);
          if (r) return r;
        }
      }
      return null;
    };
    masterUrl = findM3u8(cfg);
    const subs = Array.isArray(cfg.subtitles) ? cfg.subtitles : [];
    const def = subs.find((s) => s && s.default) || null;
    subtitle = def?.src || null;
  } catch {
    // JSON.parse failed → same regexes as ani-cli
    const m = jsonText.match(/"src":"([^"]*\.m3u8[^"]*)"/);
    masterUrl = m ? m[1] : null;
    const sub = jsonText
      .split(/\},\s*\{/)
      .find((c) => /"default":true/.test(c) && /"src":"/.test(c));
    subtitle = sub ? (sub.match(/"src":"([^"]*)"/) || [])[1] || null : null;
  }
  if (!masterUrl) throw new Error("No m3u8 source in embed config");
  masterUrl = masterUrl.replace(/\\\//g, "/");
  if (subtitle) subtitle = subtitle.replace(/\\\//g, "/");

  // hls.js reads the master playlist itself and picks the levels
  const resolution = "auto";

  return { masterUrl, referer, malId, subtitle, resolution };
}

// ── AniList: resolve correct season title for S2+ ────────────────────────────

function sanitizeTitle(t) {
  return t
    .replace(/[''`´]/g, "")
    .replace(/[:!.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(t) {
  return String(t || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function anilistSeasonTitle(baseTitle, seasonNumber) {
  return new Promise((resolve) => {
    const resolveS1 = seasonNumber <= 1;
    const query = `query($search:String){Media(search:$search,type:ANIME,sort:SEARCH_MATCH){title{english romaji}episodes relations{edges{relationType node{type format title{english romaji}episodes startDate{year}seasonYear}}}}}`;
    const body = JSON.stringify({ query, variables: { search: baseTitle } });
    const opts = {
      hostname: "graphql.anilist.co",
      path: "/",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const fallback = {
      title: baseTitle,
      romaji: null,
      episodes: null,
      nextTitle: null,
      nextRomaji: null,
    };

    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const media = json?.data?.Media;
          if (!media) return resolve(fallback);

          const s1Romaji = media?.title?.romaji || null;
          const s1Episodes = media?.episodes || null;
          const sequels = (media.relations?.edges || [])
            .filter(
              (e) =>
                e.relationType === "SEQUEL" &&
                e.node.type === "ANIME" &&
                (e.node.format === "TV" || e.node.format === "TV_SHORT"),
            )
            .sort((a, b) => {
              const ya = a.node.startDate?.year || a.node.seasonYear || 9999;
              const yb = b.node.startDate?.year || b.node.seasonYear || 9999;
              return ya - yb;
            });

          const getTitle = (node) =>
            node.title?.english || node.title?.romaji || null;
          const getRomaji = (node) => node.title?.romaji || null;

          if (resolveS1) {
            const next = sequels[0]?.node ?? null;
            return resolve({
              title: media.title?.english || baseTitle,
              romaji: s1Romaji,
              episodes: s1Episodes,
              nextTitle: next ? getTitle(next) : null,
              nextRomaji: next ? getRomaji(next) : null,
            });
          }

          const target = sequels[seasonNumber - 2];
          if (!target) return resolve({ ...fallback, romaji: s1Romaji });

          const nextNode = sequels[seasonNumber - 1]?.node ?? null;
          resolve({
            title: getTitle(target.node) || baseTitle,
            romaji: getRomaji(target.node) || s1Romaji,
            episodes: target.node.episodes || null,
            nextTitle: nextNode ? getTitle(nextNode) : null,
            nextRomaji: nextNode ? getRomaji(nextNode) : null,
          });
        } catch {
          resolve(fallback);
        }
      });
    });
    req.on("error", () => resolve(fallback));
    req.setTimeout(8000, () => {
      req.destroy();
      resolve(fallback);
    });
    req.write(body);
    req.end();
  });
}

// ── Show cache (episode lists rarely change within a session) ────────────────

const SHOW_CACHE_TTL = 10 * 60 * 1000;
const _episodeCache = new Map(); // showId -> { ts, episodes }

async function cachedEpisodes(showId) {
  const hit = _episodeCache.get(showId);
  if (hit && Date.now() - hit.ts < SHOW_CACHE_TTL) return hit.episodes;
  const episodes = await hianimeEpisodes(showId);
  if (episodes.length) _episodeCache.set(showId, { ts: Date.now(), episodes });
  return episodes;
}

// ── Local player server ───────────────────────────────────────────────────────
// All media requests go through /proxy so the stream host always sees the right
// Referer. HLS playlists are rewritten so every sub-playlist, segment, key and
// audio rendition is proxied too.
//
// Hardening: the server listens on all interfaces so LAN browsers can play
// ("/tv" route), every route needs a random per-session token (so other local
// processes / web pages cannot use it as an open proxy), the Host header must
// be a loopback/LAN name on our port (DNS-rebinding), proxied targets must be
// public http(s) hosts, and the player page runs under a strict CSP.

let _playerServer = null;
let _serverToken = crypto.randomBytes(24).toString("hex");
let _currentVideoUrl = null;
let _currentVideoReferer = BASE_URL + "/";
let _currentVideoOrigin = null;
let _currentVideoUA = null;
let _currentVideoSubtitle = null;
let _currentVideoSubtitles = []; // [{url, lang}] — every captured track
let _progressListener = null; // ({file, streamUrl, t, d}) — set by index.js
function setProgressListener(fn) {
  _progressListener = typeof fn === "function" ? fn : null;
}
let _currentVideoStartTime = 0;
// Configured player defaults for the next play (Settings → renderer → IPC).
// Anything absent falls back to the player page's cookie-remembered values.
let _currentVideoPrefs = {};
// Registered local file + subtitle file for the /file and /sub routes.
// The server only ever serves what was registered via setPlayerFile —
// no arbitrary path param, so it can't become a file-read primitive.
let _currentVideoFile = null;
let _currentSubtitleFile = null;
// Optional per-URL header lookup (captured from the embed's own requests).
// Lets multi-CDN streams replay the right Referer/Origin per playlist host —
// the embed fetched every playlist itself, so its headers are on record.
let _streamMetaLookup = null;
function setStreamMetaLookup(fn) {
  _streamMetaLookup = typeof fn === "function" ? fn : null;
}

function proxied(u) {
  return `/proxy?t=${_serverToken}&url=${encodeURIComponent(u)}`;
}

function escapeHtmlAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// JSON that is safe inside an inline <script>
function jsonForScript(v) {
  return JSON.stringify(v)
    .replace(/</g, "\\u003c")
    .replace(new RegExp("[\\u2028\\u2029]", "g"), "");
}

function rewritePlaylist(text, playlistUrl) {
  const abs = (u) => new URL(u, playlistUrl).href;
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith("#")) {
        return line.replace(
          /URI="([^"]+)"/g,
          (_, u) => `URI="${proxied(abs(u))}"`,
        );
      }
      return proxied(abs(t));
    })
    .join("\n");
}

function buildPlayerHtml(videoUrl, startTime, subtitleUrl, nonce, opts = {}) {
  const isFile = !!opts.isFile;
  // Track list: local file → the registered /sub route; remote → every
  // captured .vtt (fallback: the single subtitleUrl for old callers).
  const trackList = isFile
    ? subtitleUrl
      ? [{ src: `/sub?t=${_serverToken}`, label: "Subtitles", lang: "en" }]
      : []
    : Array.isArray(opts.subtitles) && opts.subtitles.length
      ? opts.subtitles.map((s) => ({
          src: proxied(s.url),
          label: s.label || s.lang || "Subtitles",
          lang: s.lang || "und",
        }))
      : subtitleUrl
        ? [{ src: proxied(subtitleUrl), label: "Subtitles", lang: "en" }]
        : [];
  const track = trackList
    .map(
      (t, i) =>
        `<track kind="subtitles" src="${escapeHtmlAttr(t.src)}" srclang="${escapeHtmlAttr(t.lang)}" label="${escapeHtmlAttr(t.label)}"${i === 0 ? " default" : ""}>`,
    )
    .join("");
  const start = Number.isFinite(Number(startTime)) ? Number(startTime) : 0;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;background:#000;overflow:hidden}video{width:100%;height:100%;object-fit:contain;display:block}
video::cue{font-size:var(--cuesz,1.15em)}
#gear{position:absolute;right:16px;bottom:64px;z-index:10;background:rgba(20,20,20,.75);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:6px;padding:6px 10px;font-size:15px;cursor:pointer;opacity:.85}
#pip{position:absolute;right:16px;bottom:106px;z-index:10;background:rgba(20,20,20,.75);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:6px;padding:6px 10px;font-size:13px;cursor:pointer;opacity:.85}
#tv{position:absolute;right:16px;bottom:148px;z-index:10;background:rgba(20,20,20,.75);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:6px;padding:6px 10px;font-size:13px;cursor:pointer;opacity:.85}
#gear:hover,#pip:hover,#tv:hover{opacity:1}
#skip{position:absolute;left:16px;bottom:64px;z-index:10;background:rgba(20,20,20,.75);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;opacity:.85;display:none}
#skip:hover{opacity:1}
#tvpanel{position:absolute;inset:0;z-index:35;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center}
#tvpanel[hidden]{display:none}
#tvpanel iframe{width:380px;height:500px;max-width:92vw;max-height:88vh;border:0;border-radius:10px;background:#fff}
#menu{position:absolute;right:16px;bottom:108px;z-index:10;background:rgba(15,15,15,.92);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:8px;min-width:150px;font:13px/1.6 system-ui,sans-serif;color:#eee;max-height:60vh;overflow:auto}
#menu .sec{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#999;margin:6px 4px 2px}
#menu .sec:first-child{margin-top:0}
#menu button{display:block;width:100%;text-align:left;background:none;border:none;color:#eee;padding:5px 8px;border-radius:4px;cursor:pointer;font:inherit}
#menu button:hover{background:rgba(255,255,255,.1)}
#menu button.on{color:#ff4d4d;font-weight:600}
/* timeline strip with hover preview — native controls can't be extended,
   so this sits just above the built-in control bar */
#seekbar{position:absolute;left:0;right:0;bottom:46px;height:16px;z-index:15;cursor:pointer}
#seekbar .rail{position:absolute;top:6px;left:0;right:0;height:4px;background:rgba(255,255,255,.22);transition:height .1s,top .1s}
#seekbar:hover .rail{top:4px;height:8px}
#seekbuf{position:absolute;left:0;top:0;bottom:0;width:0;background:rgba(255,255,255,.35)}
#seekfill{position:absolute;left:0;top:0;bottom:0;width:0;background:#ff4d4d}
#thumb{position:absolute;bottom:20px;transform:translateX(-50%);background:#000;border:1px solid rgba(255,255,255,.35);border-radius:6px;padding:4px;display:none;pointer-events:none;z-index:25}
#thumb canvas{display:block;width:160px;height:90px;background:#111}
#ttime{text-align:center;font:12px system-ui,sans-serif;color:#fff;padding-top:3px}
#help{position:absolute;top:16px;right:16px;z-index:30;background:rgba(15,15,15,.92);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:12px 16px;font:13px/1.8 system-ui,sans-serif;color:#eee}
#help b{color:#ff4d4d;display:block;margin-bottom:4px}
#help span{color:#999}</style>
</head><body>
<video id="v" controls playsinline autoplay>${track}</video>
<div id="seekbar"><div class="rail"><div id="seekbuf"></div><div id="seekfill"></div></div><div id="thumb"><canvas id="tc" width="160" height="90"></canvas><div id="ttime"></div></div></div>
<button id="gear" title="Quality & speed">&#9881;</button>
<button id="pip" title="Picture in picture">&#9719;</button>
<button id="tv" title="Play on TV">&#128250;</button>
<button id="skip" title="Skip ahead 85s (S)">Skip 85s &raquo;</button>
<div id="tvpanel" hidden><iframe id="tvf" title="Play on TV"></iframe></div>
<div id="toast" style="display:none;position:absolute;left:50%;bottom:70px;transform:translateX(-50%);z-index:40;background:rgba(15,15,15,.9);border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:6px 14px;font:13px system-ui,sans-serif;color:#eee"></div>
<div id="help" hidden><b>Shortcuts</b>
<span>&larr;/&rarr;</span> or <span>J</span>/<span>L</span> seek &plusmn;10s &nbsp;<span>&uarr;/&darr;</span> volume<br>
<span>K</span> play/pause &nbsp;<span>F</span> or double-click fullscreen &nbsp;<span>M</span> mute<br>
<span>P</span> picture-in-picture &nbsp;<span>,</span>/<span>.</span> frame step<br>
<span>S</span> skip +85s &nbsp;<span>?</span> this help</div>
<div id="menu" hidden>
  <div class="sec" id="qsec">Quality</div>
  <div id="levels"></div>
  <div class="sec" id="ssec" hidden>Subtitles</div>
  <div id="subs"></div>
  <div class="sec" id="asec" hidden>Audio</div>
  <div id="atracks"></div>
  <div class="sec">Playback</div>
  <div id="playopts"></div>
  <div class="sec">Sleep timer</div>
  <div id="sleepopts"></div>
  <div id="sleepinfo" style="padding:2px 10px 4px;font-size:11px;color:#999"></div>
  <div class="sec">Speed</div>
  <div id="speeds"></div>
</div>
<script nonce="${nonce}" src="/hls.js?t=${_serverToken}"></script>
<script nonce="${nonce}">
  const video=document.getElementById('v');
  const gear=document.getElementById('gear');
  const menu=document.getElementById('menu');
  const levelsBox=document.getElementById('levels');
  const qsec=document.getElementById('qsec');
  const speedsBox=document.getElementById('speeds');
  const src=${jsonForScript(isFile ? `/file?t=${_serverToken}` : proxied(videoUrl))};
  const startTime=${start};
  const isFile=${isFile ? "true" : "false"};
  // Configured defaults from Settings — when present they override the
  // remembered (cookie) values below; cookie writes on user changes stay.
  const DEF=${jsonForScript(opts.prefs || {})};
  // Persist playback speed + volume across sessions via host-scoped cookies
  // (cookies ignore the player's random port where localStorage wouldn't)
  const ck=(n)=>{const m=document.cookie.match(new RegExp('(?:^|; )'+n+'=([^;]*)'));return m?decodeURIComponent(m[1]):null};
  const svRate=(DEF.rate!=null?DEF.rate:parseFloat(ck('sb_rate')));
  if(svRate>=0.25&&svRate<=4)video.playbackRate=svRate;
  const svVol=(DEF.vol!=null?DEF.vol:parseFloat(ck('sb_vol')));
  if(svVol>=0&&svVol<=1)video.volume=svVol;
  if(DEF.muted===true||ck('sb_muted')==='1')video.muted=true;
  video.addEventListener('ratechange',()=>{document.cookie='sb_rate='+video.playbackRate+';path=/;max-age=31536000'});
  video.addEventListener('volumechange',()=>{document.cookie='sb_vol='+video.volume.toFixed(2)+';path=/;max-age=31536000';document.cookie='sb_muted='+(video.muted?1:0)+';path=/;max-age=31536000'});
  // Report position back so the app can offer resume on the next open
  const report=()=>{if(video.duration>0)fetch('/progress?t='+new URLSearchParams(location.search).get('t'),{method:'POST',body:JSON.stringify({t:video.currentTime,d:video.duration})}).catch(()=>{})};
  setInterval(()=>{if(!video.paused)report()},5000);
  window.addEventListener('beforeunload',()=>{try{navigator.sendBeacon('/progress?t='+new URLSearchParams(location.search).get('t'),JSON.stringify({t:video.currentTime,d:video.duration}))}catch(e){}});
  // Keyboard: ←/→ seek ±10s, ↑/↓ volume, F fullscreen, M mute; dblclick = fullscreen
  document.addEventListener('keydown',(e)=>{
    if(e.target&&e.target.tagName==='INPUT')return;
    switch(e.key){
      case 'ArrowLeft':video.currentTime=Math.max(0,video.currentTime-10);e.preventDefault();break;
      case 'ArrowRight':video.currentTime=Math.min(video.duration||Infinity,video.currentTime+10);e.preventDefault();break;
      case 'ArrowUp':video.volume=Math.min(1,video.volume+0.1);e.preventDefault();break;
      case 'ArrowDown':video.volume=Math.max(0,video.volume-0.1);e.preventDefault();break;
      case 'f':case 'F':document.fullscreenElement?document.exitFullscreen():video.requestFullscreen();break;
      case 'm':case 'M':video.muted=!video.muted;break;
      case 'j':case 'J':video.currentTime=Math.max(0,video.currentTime-10);break;
      case 'l':case 'L':video.currentTime=Math.min(video.duration||Infinity,video.currentTime+10);break;
      case 'k':case 'K':video.paused?video.play():video.pause();break;
      case 's':case 'S':skipIntro();break;
      case ',':video.pause();video.currentTime=Math.max(0,video.currentTime-1/30);break;
      case '.':video.pause();video.currentTime=Math.min(video.duration||Infinity,video.currentTime+1/30);break;
      case 'p':case 'P':togglePip();break;
    }
  });
  // Skip-intro: +85s button shown during the opening stretch of the video
  // (where intros live), plus the S shortcut any time.
  const skipBtn=document.getElementById('skip');
  const skipIntro=()=>{video.currentTime=Math.min(video.duration||Infinity,video.currentTime+85);};
  skipBtn.onclick=skipIntro;
  video.addEventListener('timeupdate',()=>{skipBtn.style.display=(video.currentTime<900)?'block':'none';});
  // Click toggles play/pause (250ms delay so dblclick→fullscreen wins);
  // dblclick = fullscreen
  let clickT=null;
  video.addEventListener('click',()=>{clearTimeout(clickT);clickT=setTimeout(()=>{video.paused?video.play():video.pause()},250)});
  video.addEventListener('dblclick',()=>{clearTimeout(clickT);document.fullscreenElement?document.exitFullscreen():video.requestFullscreen()});
  // ? or H shows a shortcut cheat-sheet; any key/click hides it
  const help=document.getElementById('help');
  const toggleHelp=()=>{help.hidden=!help.hidden;};
  document.addEventListener('keydown',(e)=>{
    if(e.key==='?'||e.key==='h'||e.key==='H'){toggleHelp();return;}
    if(!help.hidden)help.hidden=true;
  });
  document.addEventListener('click',()=>{if(!help.hidden)help.hidden=true;});
  // ── Timeline strip: progress fill, buffered range, hover thumbnails ──
  // A hidden second video element renders frames for the preview bubble.
  const seekbar=document.getElementById('seekbar');
  const seekfill=document.getElementById('seekfill');
  const seekbuf=document.getElementById('seekbuf');
  const thumb=document.getElementById('thumb');
  const tc=document.getElementById('tc');
  const ttime=document.getElementById('ttime');
  const tctx=tc.getContext('2d');
  let pv=document.createElement('video');
  pv.muted=true;pv.preload='auto';
  const thumbCache=new Map();
  let pvHls=null,hoverT=null,seekTimer=null,grabBusy=false,scrubbing=false;
  function fmtT(t){
    if(!isFinite(t)||t<0)t=0;
    const h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=Math.floor(t%60);
    return (h?h+':':'')+String(m).padStart(h?2:1,'0')+':'+String(s).padStart(2,'0');
  }
  video.addEventListener('timeupdate',()=>{
    const d=video.duration;
    if(isFinite(d)&&d>0)seekfill.style.width=(video.currentTime/d*100)+'%';
  });
  video.addEventListener('progress',()=>{
    try{
      const b=video.buffered,d=video.duration;
      if(b.length&&isFinite(d)&&d>0)seekbuf.style.width=(b.end(b.length-1)/d*100)+'%';
    }catch(e){}
  });
  (function initPreview(){
    if(isFile){pv.src=src;}
    else if(window.Hls&&Hls.isSupported()){
      // tiny buffers: preview seeks shouldn't pull more of the stream
      pvHls=new Hls({maxBufferLength:2,maxMaxBufferLength:4});
      pvHls.loadSource(src);pvHls.attachMedia(pv);
    }else if(pv.canPlayType('application/vnd.apple.mpegurl')){pv.src=src;}
    else{pv=null;}
  })();
  function grabFrame(t){
    if(!pv||grabBusy)return;
    grabBusy=true;
    let done=false;
    const finish=()=>{
      if(done)return;done=true;
      clearTimeout(giveUp);
      pv.removeEventListener('seeked',onSeeked);
      try{
        tctx.drawImage(pv,0,0,tc.width,tc.height);
        // don't poison the cache with a blank frame
        const px=tctx.getImageData(80,45,1,1).data;
        if(px[0]||px[1]||px[2]){
          thumbCache.set(t,tc.toDataURL('image/jpeg',0.6));
          if(thumbCache.size>300)thumbCache.delete(thumbCache.keys().next().value);
        }
      }catch(e){}
      grabBusy=false;
      if(hoverT!==null&&hoverT!==t)queueGrab(hoverT);
    };
    const onSeeked=()=>{
      // 'seeked' fires when data is buffered at the target; give the
      // decoder a beat to present the new frame before drawing
      if(pv.readyState>=2){setTimeout(finish,120);return;}
      const iv=setInterval(()=>{
        if(pv.readyState>=2){clearInterval(iv);setTimeout(finish,120);}
      },60);
      setTimeout(()=>clearInterval(iv),4000);
    };
    const giveUp=setTimeout(finish,6000);
    pv.addEventListener('seeked',onSeeked);
    try{pv.currentTime=t;}catch(e){finish();}
  }
  function queueGrab(t){
    if(seekTimer)clearTimeout(seekTimer);
    seekTimer=setTimeout(()=>grabFrame(t),180);
  }
  function barTime(e){
    const r=seekbar.getBoundingClientRect();
    const f=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width));
    return {t:isFinite(video.duration)?f*video.duration:NaN,
            x:Math.min(r.width-86,Math.max(86,e.clientX-r.left))};
  }
  seekbar.addEventListener('mousemove',(e)=>{
    const {t,x}=barTime(e);
    if(scrubbing&&isFinite(t))video.currentTime=t;
    if(!isFinite(t))return;
    thumb.style.display='block';thumb.style.left=x+'px';
    ttime.textContent=fmtT(t);
    const b=Math.round(t);hoverT=b;
    const hit=thumbCache.get(b);
    if(hit){
      const img=new Image();
      img.onload=()=>tctx.drawImage(img,0,0,tc.width,tc.height);
      img.src=hit;
    }else if(pv){queueGrab(b);}
  });
  seekbar.addEventListener('mouseleave',()=>{
    thumb.style.display='none';hoverT=null;scrubbing=false;
    if(seekTimer)clearTimeout(seekTimer);
  });
  seekbar.addEventListener('mousedown',(e)=>{
    const {t}=barTime(e);
    if(isFinite(t)){scrubbing=true;video.currentTime=t;}
    e.preventDefault();
  });
  document.addEventListener('mouseup',()=>{scrubbing=false;});
  gear.addEventListener('click',(e)=>{e.stopPropagation();menu.hidden=!menu.hidden;});
  menu.addEventListener('click',(e)=>e.stopPropagation());
  document.addEventListener('click',()=>{menu.hidden=true;});
  const SPEEDS=(Array.isArray(DEF.speeds)&&DEF.speeds.length)?DEF.speeds:[0.75,1,1.25,1.5,2];
  function rebuildSpeeds(){
    speedsBox.innerHTML='';
    SPEEDS.forEach((r)=>{
      const b=document.createElement('button');
      b.textContent=(r===1?'Normal':r+'x');
      if(video.playbackRate===r)b.classList.add('on');
      b.onclick=()=>{video.playbackRate=r;rebuildSpeeds();menu.hidden=true;};
      speedsBox.appendChild(b);
    });
  }
  rebuildSpeeds();
  // ── Subtitle track selector: every captured .vtt becomes a <track>;
  // the gear menu switches textTracks[].mode between showing/hidden.
  const subsBox=document.getElementById('subs');
  const ssec=document.getElementById('ssec');
  const SUB_LABELS=${jsonForScript(trackList.map((t) => t.label))};
  function setTrack(idx){
    const tt=video.textTracks;
    for(let k=0;k<tt.length;k++)tt[k].mode=(k===idx?'showing':'hidden');
    [...subsBox.children].forEach((b,k)=>b.classList.toggle('on',k===idx+1));
  }
  // ── Subtitle sync: refetch the active track, shift cue timestamps by
  // subShift seconds, and swap in a shifted Blob URL (persisted via cookie)
  let subShift=(DEF.subOff!=null?DEF.subOff:parseFloat(ck('sb_suboff')))||0;
  const origSrc={};
  async function applyShift(){
    const tt=video.textTracks;let idx=-1;
    for(let k=0;k<tt.length;k++)if(tt[k].mode==='showing')idx=k;
    if(idx<0)return;
    const el=video.querySelectorAll('track')[idx];
    if(!el)return;
    if(!origSrc[idx])origSrc[idx]=el.src;
    try{
      const txt=await (await fetch(origSrc[idx])).text();
      const z=(n,l)=>String(n).padStart(l||2,'0');
      const shifted=txt.replace(/(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})/g,(m,h,mn,s,ms)=>{
        let t=(+(h||0))*3600000+(+mn)*60000+(+s)*1000+(+ms)+Math.round(subShift*1000);
        if(t<0)t=0;
        return z(Math.floor(t/3600000))+':'+z(Math.floor(t/60000)%60)+':'+z(Math.floor(t/1000)%60)+'.'+z(t%1000,3);
      });
      const old=el.src;
      el.src=URL.createObjectURL(new Blob([shifted],{type:'text/vtt'}));
      if(old.startsWith('blob:'))URL.revokeObjectURL(old);
      video.textTracks[idx].mode='hidden';video.textTracks[idx].mode='showing';
    }catch(e){}
  }
  if(SUB_LABELS.length){
    ssec.hidden=false;
    const mkSub=(label,idx)=>{
      const b=document.createElement('button');
      b.textContent=label;
      b.onclick=()=>{setTrack(idx);if(subShift)applyShift();menu.hidden=true;};
      subsBox.appendChild(b);
    };
    mkSub('Off',-1);
    SUB_LABELS.forEach((l,i)=>mkSub(l,i));
    setTrack(0);
    // Sync offset controls: −/＋ 0.5s buttons + live readout
    const syncLbl=document.createElement('span');
    syncLbl.style.cssText='color:#999;font-size:11px;align-self:center';
    syncLbl.textContent='Sync '+(subShift>=0?'+':'')+subShift.toFixed(1)+'s';
    const setShift=(d)=>{
      subShift=Math.round((subShift+d)*10)/10;
      syncLbl.textContent='Sync '+(subShift>=0?'+':'')+subShift.toFixed(1)+'s';
      document.cookie='sb_suboff='+subShift+';path=/;max-age=31536000';
      applyShift();
    };
    const mkSync=(label,ds)=>{
      const b=document.createElement('button');
      b.textContent=label;b.style.minWidth='34px';
      b.onclick=(e)=>{e.stopPropagation();setShift(ds);};
      subsBox.appendChild(b);
    };
    mkSync('−0.5',-0.5);subsBox.appendChild(syncLbl);mkSync('+0.5',0.5);
    if(subShift)applyShift();
  }
  // Loop toggle — handy for short clips
  const playOpts=document.getElementById('playopts');
  const loopBtn=document.createElement('button');
  loopBtn.textContent='Loop';
  loopBtn.onclick=()=>{video.loop=!video.loop;loopBtn.classList.toggle('on',video.loop);menu.hidden=true;};
  playOpts.appendChild(loopBtn);
  // Subtitle size — Small/Normal/Large cue scaling, persisted via cookie
  const szSec=document.createElement('div');szSec.className='sec';szSec.textContent='Caption size';
  const szBox=document.createElement('div');szBox.id='cuesizes';
  playOpts.appendChild(szSec);playOpts.appendChild(szBox);
  const setCue=(sz,b)=>{
    document.documentElement.style.setProperty('--cuesz',sz);
    document.cookie='sb_cuesz='+sz+';path=/;max-age=31536000';
    [...szBox.children].forEach(x=>x.classList.toggle('on',x===b));
  };
  const initCueSz=(DEF.cueSize!=null?DEF.cueSize+'em':ck('sb_cuesz'));
  [['S','0.75em'],['M','1.15em'],['L','1.7em']].forEach(([l,sz])=>{
    const b=document.createElement('button');b.textContent=l;
    b.onclick=()=>{setCue(sz,b);menu.hidden=true;};szBox.appendChild(b);
    if(initCueSz===sz)b.classList.add('on');
  });
  if(initCueSz)document.documentElement.style.setProperty('--cuesz',initCueSz);
  // Picture-in-picture (Chromium PiP floats the video over other windows)
  const pipBtn=document.getElementById('pip');
  const togglePip=()=>{
    try{
      if(document.pictureInPictureElement)document.exitPictureInPicture();
      else video.requestPictureInPicture().catch(()=>{});
    }catch(e){}
  };
  pipBtn.addEventListener('click',(e)=>{e.stopPropagation();togglePip();});
  if(document.pictureInPictureEnabled===false)pipBtn.style.display='none';
  // ── Play on TV: overlay embeds /tv (QR + LAN URL) for other devices ──
  const tvPanel=document.getElementById('tvpanel');
  const tvFrame=document.getElementById('tvf');
  document.getElementById('tv').addEventListener('click',(e)=>{
    e.stopPropagation();
    tvPanel.hidden=!tvPanel.hidden;
    if(!tvPanel.hidden)tvFrame.src='/tv?t='+new URLSearchParams(location.search).get('t');
  });
  tvPanel.addEventListener('click',(e)=>{if(e.target===tvPanel)tvPanel.hidden=true;});
  // Sleep timer — pause playback after N minutes
  const sleepBox=document.getElementById('sleepopts');
  const sleepInfo=document.getElementById('sleepinfo');
  let sleepT=null,sleepIv=null,sleepEnd=0;
  const paintSleep=()=>{
    const left=sleepEnd?Math.max(0,Math.ceil((sleepEnd-Date.now())/60000)):0;
    sleepInfo.textContent=left?('Sleeping in '+left+' min'):'';
  };
  const setSleep=(mins)=>{
    clearTimeout(sleepT);clearInterval(sleepIv);sleepT=sleepIv=null;sleepEnd=0;
    if(mins>0){
      sleepEnd=Date.now()+mins*60000;
      sleepT=setTimeout(()=>{
        video.pause();setSleep(0);
        [...sleepBox.children].forEach(x=>x.classList.remove('on'));
      },mins*60000);
      sleepIv=setInterval(paintSleep,15000);paintSleep();
    }else paintSleep();
  };
  [['Off',0],['15m',15],['30m',30],['45m',45],['60m',60]].forEach(([l,m])=>{
    const b=document.createElement('button');b.textContent=l;
    b.onclick=()=>{
      setSleep(m);
      [...sleepBox.children].forEach(x=>x.classList.remove('on'));
      if(m>0)b.classList.add('on');
      menu.hidden=true;
    };
    sleepBox.appendChild(b);
  });
  // ── A-B repeat: set point A, then B, loops the segment; third click clears
  let abA=null,abB=null;
  const abBtn=document.createElement('button');
  const paintAB=()=>{
    abBtn.textContent=abA==null?'A-B repeat':(abB==null?('A '+fmtT(abA)+' → set B'):('A-B '+fmtT(abA)+'–'+fmtT(abB)));
    abBtn.classList.toggle('on',abA!=null);
  };
  abBtn.onclick=()=>{
    if(abA==null)abA=video.currentTime;
    else if(abB==null){if(video.currentTime>abA+0.2)abB=video.currentTime;else abA=null;}
    else{abA=abB=null;}
    paintAB();
  };
  paintAB();playOpts.appendChild(abBtn);
  video.addEventListener('timeupdate',()=>{
    if(abA!=null&&abB!=null&&video.currentTime>=abB)video.currentTime=abA;
  });
  // ── Fit toggle: contain → cover → fill (for letterboxed/cropped encodes)
  const FITS=['contain','cover','fill'];let fitI=0;
  const fitBtn=document.createElement('button');
  fitBtn.onclick=()=>{
    fitI=(fitI+1)%FITS.length;video.style.objectFit=FITS[fitI];
    fitBtn.textContent='Fit: '+FITS[fitI];fitBtn.classList.toggle('on',fitI!==0);
    menu.hidden=true;
  };
  fitBtn.textContent='Fit: contain';playOpts.appendChild(fitBtn);
  // ── Snapshot: grab the current frame as PNG (saved to Downloads/Streambert)
  const toast=document.getElementById('toast');
  let toastT=null;
  const showToast=(m)=>{toast.textContent=m;toast.style.display='block';clearTimeout(toastT);toastT=setTimeout(()=>toast.style.display='none',2500);};
  const snapBtn=document.createElement('button');
  snapBtn.textContent='Snapshot';
  snapBtn.onclick=()=>{
    try{
      const c=document.createElement('canvas');
      c.width=video.videoWidth;c.height=video.videoHeight;
      c.getContext('2d').drawImage(video,0,0);
      fetch('/snapshot?t='+new URLSearchParams(location.search).get('t'),{method:'POST',body:JSON.stringify({png:c.toDataURL('image/png')})})
        .then(r=>showToast(r.ok?'Frame saved to Downloads/Streambert':'Save failed'))
        .catch(()=>showToast('Save failed'));
    }catch(e){showToast('Save failed');}
    menu.hidden=true;
  };
  playOpts.appendChild(snapBtn);
  function buildLevels(hls){
    // Auto first, then real levels sorted best→worst
    const items=[{label:'Auto',idx:-1}].concat(
      hls.levels
        .map((l,i)=>({label:(l.height?l.height+'p':Math.round(l.bitrate/1000)+' kbps'),idx:i,h:l.height||0,b:l.bitrate}))
        .sort((a,b)=>(b.h-a.h)||(b.b-a.b)));
    const paint=()=>{
      levelsBox.innerHTML='';
      items.forEach((it)=>{
        const b=document.createElement('button');
        b.textContent=it.label;
        if(hls.currentLevel===it.idx||(it.idx===-1&&hls.currentLevel===-1))b.classList.add('on');
        b.onclick=()=>{hls.currentLevel=it.idx;paint();};
        levelsBox.appendChild(b);
      });
    };
    hls.on(Hls.Events.LEVEL_SWITCHED,paint);
    paint();
    qsec.style.display='';
  }
  if(isFile){
    // local file served by /file — mp4/mkv play natively, no hls.js needed
    qsec.style.display='none';
    video.src=src;
    if(startTime>0)video.addEventListener('loadedmetadata',()=>{video.currentTime=startTime;},{once:true});
    video.play().catch(()=>{
      video.muted=true;
      video.play().catch(()=>{});
      const un=()=>{video.muted=false;document.removeEventListener('click',un);document.removeEventListener('keydown',un);};
      document.addEventListener('click',un);document.addEventListener('keydown',un);
    });
  }else if(window.Hls&&Hls.isSupported()){
    const hls=new Hls({autoStartLoad:false});
    window.__hls=hls;
    hls.loadSource(src);hls.attachMedia(video);
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED,()=>{
      // separate-audio manifests: make sure one track is actually selected
      const tracks=hls.audioTracks||[];
      if(tracks.length&&hls.audioTrack===-1){
        const def=tracks.findIndex(t=>t.default);
        hls.audioTrack=def>=0?def:0;
      }
      // Surface multi-audio streams (dubs/languages) in the gear menu
      if(tracks.length>1){
        const asec=document.getElementById('asec');
        const atracks=document.getElementById('atracks');
        asec.hidden=false;atracks.innerHTML='';
        const paintA=()=>{[...atracks.children].forEach((b,k)=>b.classList.toggle('on',k===hls.audioTrack));};
        tracks.forEach((t,i)=>{
          const b=document.createElement('button');
          b.textContent=t.name||t.lang||('Audio '+(i+1));
          b.onclick=()=>{hls.audioTrack=i;paintA();};
          atracks.appendChild(b);
        });
        paintA();
      }
    });
    hls.on(Hls.Events.MANIFEST_PARSED,()=>{
      // start on the best quality (like ani-cli); ABR may still adapt downwards
      hls.startLevel=hls.levels.length-1;
      hls.startLoad(startTime>0?startTime:-1);
      video.play().catch(()=>{
        // autoplay-with-sound blocked: start muted, unmute on first gesture
        video.muted=true;
        video.play().catch(()=>{});
        const un=()=>{video.muted=false;document.removeEventListener('click',un);document.removeEventListener('keydown',un);};
        document.addEventListener('click',un);document.addEventListener('keydown',un);
      });
      if(hls.levels&&hls.levels.length>1)buildLevels(hls);
      else qsec.style.display='none';
    });
  }else if(video.canPlayType('application/vnd.apple.mpegurl')){
    qsec.style.display='none';
    video.src=src;
    if(startTime>0)video.addEventListener('loadedmetadata',()=>{video.currentTime=startTime;},{once:true});
  }else{
    qsec.style.display='none';
  }
</script>
</body></html>`;
}

async function proxyRequest(target, req, res, hops = 0) {
  let targetUrl;
  try {
    targetUrl = await assertPublicUrl(target);
  } catch {
    res.writeHead(403);
    res.end();
    return;
  }
  const lib = targetUrl.protocol === "https:" ? https : http;
  // Prefer the headers the embed itself sent for this exact URL (child
  // playlists can sit on a different CDN needing its own Referer/Origin).
  let meta = null;
  try {
    meta = _streamMetaLookup && _streamMetaLookup(target);
  } catch {}
  const headers = {
    "User-Agent": meta?.userAgent || _currentVideoUA || USER_AGENT,
    Referer: meta?.referer || _currentVideoReferer,
    Accept: "*/*",
    "Accept-Encoding": "identity",
  };
  const origin = meta?.origin || _currentVideoOrigin;
  if (origin) headers.Origin = origin;
  if (req.headers["range"]) headers["Range"] = req.headers["range"];

  const proxyReq = lib.request(
    {
      hostname: targetUrl.hostname,
      port: targetUrl.port || undefined,
      path: targetUrl.pathname + targetUrl.search,
      method: "GET",
      headers,
      agent: lib === https ? httpsAgent : httpAgent,
    },
    (proxyRes) => {
      const status = proxyRes.statusCode || 502;
      if (
        status >= 300 &&
        status < 400 &&
        proxyRes.headers.location &&
        hops < 8
      ) {
        proxyRes.resume();
        proxyRequest(
          new URL(proxyRes.headers.location, target).href,
          req,
          res,
          hops + 1,
        );
        return;
      }

      const contentType = String(proxyRes.headers["content-type"] || "");
      const isPlaylist =
        /\.m3u8(\?|$)/i.test(targetUrl.pathname + targetUrl.search) ||
        /mpegurl/i.test(contentType);

      if (isPlaylist && status === 200) {
        const chunks = [];
        let size = 0;
        proxyRes.on("data", (c) => {
          size += c.length;
          if (size > MAX_TEXT_BYTES) {
            proxyReq.destroy();
            return;
          }
          chunks.push(c);
        });
        proxyRes.on("end", () => {
          if (size > MAX_TEXT_BYTES) {
            res.writeHead(502);
            res.end();
            return;
          }
          const text = Buffer.concat(chunks).toString("utf8");
          let out = text;
          try {
            if (text.trimStart().startsWith("#EXTM3U")) {
              out = rewritePlaylist(text, target);
            }
          } catch {
            res.writeHead(502);
            res.end();
            return;
          }
          res.writeHead(200, {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          });
          res.end(out);
        });
        proxyRes.on("error", () => {
          if (!res.headersSent) res.writeHead(502);
          res.end();
        });
        return;
      }

      // Peek at the first chunk: CDNs sometimes serve playlists as
      // text/plain or octet-stream, which would pass through un-rewritten
      // and break every resource they reference (e.g. audio tracks).
      let sawData = false;
      proxyRes.once("data", (first) => {
        sawData = true;
        if (
          status === 200 &&
          first
            .subarray(0, 16)
            .toString("utf8")
            .trimStart()
            .startsWith("#EXTM3U")
        ) {
          const chunks = [first];
          let size = first.length;
          proxyRes.on("data", (c) => {
            size += c.length;
            if (size <= MAX_TEXT_BYTES) chunks.push(c);
          });
          proxyRes.on("end", () => {
            let out;
            try {
              if (size > MAX_TEXT_BYTES) throw new Error("oversize");
              out = rewritePlaylist(
                Buffer.concat(chunks).toString("utf8"),
                target,
              );
            } catch {
              res.writeHead(502);
              res.end();
              return;
            }
            res.writeHead(200, {
              "Content-Type": "application/vnd.apple.mpegurl",
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            });
            res.end(out);
          });
          proxyRes.on("error", () => {
            if (!res.headersSent) res.writeHead(502);
            res.end();
          });
          return;
        }
        const passHeaders = {};
        for (const h of [
          "content-type",
          "content-length",
          "content-range",
          "accept-ranges",
          "last-modified",
          "etag",
        ]) {
          if (proxyRes.headers[h]) passHeaders[h] = proxyRes.headers[h];
        }
        passHeaders["Cache-Control"] = "no-store";
        passHeaders["X-Content-Type-Options"] = "nosniff";
        res.writeHead(status, passHeaders);
        res.write(first);
        proxyRes.pipe(res);
      });
      proxyRes.once("end", () => {
        if (!sawData && !res.headersSent) {
          res.writeHead(status, { "Cache-Control": "no-store" });
          res.end();
        }
      });
    },
  );
  proxyReq.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  proxyReq.setTimeout(20000, () => proxyReq.destroy());
  res.on("close", () => proxyReq.destroy());
  proxyReq.end();
}

const LOCAL_MEDIA_EXTENSIONS = new Set([
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".webm",
  ".m4v",
  ".ts",
  ".m2ts",
]);

// Extensionless files (e.g. "vid_720p") are validated by magic bytes:
// mp4/mov (ftyp), mkv/webm (EBML), MPEG-TS (0x47 sync), AVI (RIFF....AVI).
function sniffMediaFile(p) {
  try {
    const fd = fs.openSync(p, "r");
    const buf = Buffer.alloc(376);
    const n = fs.readSync(fd, buf, 0, 376, 0);
    fs.closeSync(fd);
    if (n < 12) return false;
    if (buf.subarray(4, 8).toString("ascii") === "ftyp") return true;
    if (
      buf[0] === 0x1a &&
      buf[1] === 0x45 &&
      buf[2] === 0xdf &&
      buf[3] === 0xa3
    )
      return true;
    if (buf[0] === 0x47 && n >= 376 && buf[188] === 0x47) return true;
    if (
      buf.subarray(0, 4).toString("ascii") === "RIFF" &&
      buf.subarray(8, 12).toString("ascii") === "AVI "
    )
      return true;
    return false;
  } catch {
    return false;
  }
}

// Resolve a renderer-supplied path to a real local media file, or null.
// Accepts known media extensions or extensionless files that sniff as media.
function resolveLocalMedia(p) {
  if (typeof p !== "string" || !p) return null;
  let real;
  try {
    real = fs.realpathSync(p);
  } catch {
    return null;
  }
  const st = fs.statSync(real);
  if (!st.isFile()) return null;
  const ext = path.extname(real).toLowerCase();
  if (!LOCAL_MEDIA_EXTENSIONS.has(ext) && !(ext === "" && sniffMediaFile(real)))
    return null;
  return real;
}

const MIME_BY_EXT = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".ts": "video/mp2t",
  ".m2ts": "video/mp2t",
  ".avi": "video/x-msvideo",
};

// Minimal .srt -> .vtt conversion for the <track> element.
function srtToVtt(text) {
  return (
    "WEBVTT\n\n" +
    text
      .replace(/\r/g, "")
      .replace(
        /(\d{2}:\d{2}:\d{2}),(\d{3}) --> (\d{2}:\d{2}:\d{2}),(\d{3})/g,
        "$1.$2 --> $3.$4",
      )
  );
}

let _hlsJs = null;
function loadHlsJs() {
  if (_hlsJs) return _hlsJs;
  _hlsJs = fs.readFileSync(require.resolve("hls.js/dist/hls.min.js"));
  return _hlsJs;
}

// Host-header gate (DNS-rebinding): the port must be ours and the name must
// be loopback, a LAN/private address, *.local or this machine's hostname —
// public domains pointed at this server are still rejected.
function isLanHost(h) {
  h = String(h || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (h === "localhost" || h === "127.0.0.1" || h.endsWith(".local"))
    return true;
  if (h === String(os.hostname()).toLowerCase()) return true;
  if (netMod.isIPv6(h)) return isPrivateIp(h);
  if (!netMod.isIPv4(h)) return false;
  const [a, b] = h.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

// First non-internal IPv4 — advertised on /tv so LAN browsers can reach us
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const it of list || []) {
      if ((it.family === "IPv4" || it.family === 4) && !it.internal) {
        return it.address;
      }
    }
  }
  return null;
}

function buildTvHtml(playerUrl, qrDataUrl) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;background:#101014;color:#eee;font:16px/1.5 system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;text-align:center}
h1{font-size:18px;font-weight:600}
img{background:#fff;border-radius:10px;padding:10px;width:280px;height:280px}
.url{font-size:21px;font-weight:600;word-break:break-all;color:#ff4d4d;max-width:34em}
.note{color:#999;font-size:13px;max-width:34em}</style>
</head><body>
<h1>Play on TV</h1>
${qrDataUrl ? `<img src="${qrDataUrl}" alt="QR code">` : ""}
<div class="url">${escapeHtmlAttr(playerUrl || "No LAN address found")}</div>
<div class="note">${qrDataUrl ? "Scan the code or open the address in a browser on this network." : "QR code unavailable — type the address into a browser on this network."}</div>
</body></html>`;
}

function getPlayerServer() {
  if (_playerServer) return Promise.resolve(_playerServer);
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      // DNS-rebinding guard + token check (POST only for /progress)
      const port = server.address()?.port;
      const hostHeader = String(req.headers.host || "");
      const hSep = hostHeader.lastIndexOf(":");
      if (
        (req.method !== "GET" && req.method !== "POST") ||
        hSep < 0 ||
        hostHeader.slice(hSep + 1) !== String(port) ||
        !isLanHost(hostHeader.slice(0, hSep))
      ) {
        res.writeHead(403);
        res.end();
        return;
      }
      const url = new URL(req.url, "http://127.0.0.1");
      const given = Buffer.from(url.searchParams.get("t") || "");
      const want = Buffer.from(_serverToken);
      if (
        given.length !== want.length ||
        !crypto.timingSafeEqual(given, want)
      ) {
        res.writeHead(403);
        res.end();
        return;
      }

      // Playback position reports from the player page → forwarded to the
      // registered listener (main process → renderer) for resume bookkeeping
      if (url.pathname === "/progress" && req.method === "POST") {
        let body = "";
        req.on("data", (c) => {
          body += c;
          if (body.length > 8192) req.destroy();
        });
        req.on("end", () => {
          try {
            const p = JSON.parse(body);
            _progressListener?.({
              file: _currentVideoFile || null,
              streamUrl: _currentVideoUrl || null,
              t: Math.max(0, +p.t || 0),
              d: Math.max(0, +p.d || 0),
            });
          } catch {}
          res.writeHead(204);
          res.end();
        });
        return;
      }

      // Frame snapshot from the player page — writes a PNG into the OS
      // Downloads folder under Streambert/ (bounded to 12 MB)
      if (url.pathname === "/snapshot" && req.method === "POST") {
        let body = "";
        req.on("data", (c) => {
          body += c;
          if (body.length > 16 * 1024 * 1024) req.destroy();
        });
        req.on("end", () => {
          try {
            const { png } = JSON.parse(body);
            const m = /^data:image\/png;base64,(.+)$/.exec(png || "");
            if (!m) throw new Error("bad png");
            const dir = path.join(app.getPath("downloads"), "Streambert");
            fs.mkdirSync(dir, { recursive: true });
            const name = `snapshot_${Date.now()}.png`;
            fs.writeFileSync(path.join(dir, name), Buffer.from(m[1], "base64"));
            res.writeHead(204);
          } catch {
            res.writeHead(400);
          }
          res.end();
        });
        return;
      }

      if (url.pathname === "/player") {
        const nonce = crypto.randomBytes(16).toString("base64");
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy":
            `default-src 'none'; script-src 'self' 'nonce-${nonce}'; ` +
            "style-src 'unsafe-inline'; media-src 'self' blob:; " +
            "connect-src 'self'; worker-src blob:; img-src 'self' data:; " +
            "frame-src 'self'",
        });
        res.end(
          buildPlayerHtml(
            _currentVideoFile ? "/file" : _currentVideoUrl || "",
            _currentVideoStartTime || 0,
            _currentVideoFile ? !!_currentSubtitleFile : _currentVideoSubtitle,
            nonce,
            {
              isFile: !!_currentVideoFile,
              subtitles: _currentVideoSubtitles,
              prefs: _currentVideoPrefs,
            },
          ),
        );
        return;
      }

      // ── Play on TV: QR + LAN URL other devices on the network can open ──
      if (url.pathname === "/tv") {
        const lan = lanAddress();
        const playerUrl = lan
          ? `http://${lan}:${port}/player?t=${_serverToken}`
          : null;
        let qrDataUrl = null;
        if (playerUrl) {
          try {
            // optional dependency — falls back to URL-as-text when absent
            qrDataUrl = await require("qrcode").toDataURL(playerUrl, {
              margin: 1,
              width: 280,
            });
          } catch {}
        }
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
        });
        res.end(buildTvHtml(playerUrl, qrDataUrl));
        return;
      }

      // Streams the registered local media file (setPlayerFile). Byte-range
      // support is required for <video> seeking on mp4.
      if (url.pathname === "/file") {
        if (!_currentVideoFile) {
          res.writeHead(404);
          res.end();
          return;
        }
        let stat;
        try {
          stat = fs.statSync(_currentVideoFile);
        } catch {
          res.writeHead(404);
          res.end();
          return;
        }
        const mime =
          MIME_BY_EXT[path.extname(_currentVideoFile).toLowerCase()] ||
          "application/octet-stream";
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
        if (range && (range[1] || range[2])) {
          const start = range[1]
            ? parseInt(range[1], 10)
            : Math.max(0, stat.size - parseInt(range[2], 10));
          const end = range[2]
            ? Math.min(parseInt(range[2], 10), stat.size - 1)
            : stat.size - 1;
          if (start > end || start >= stat.size) {
            res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
            res.end();
            return;
          }
          res.writeHead(206, {
            "Content-Type": mime,
            "Content-Range": `bytes ${start}-${end}/${stat.size}`,
            "Accept-Ranges": "bytes",
            "Content-Length": end - start + 1,
            "Cache-Control": "no-store",
          });
          fs.createReadStream(_currentVideoFile, { start, end }).pipe(res);
          return;
        }
        res.writeHead(200, {
          "Content-Type": mime,
          "Accept-Ranges": "bytes",
          "Content-Length": stat.size,
          "Cache-Control": "no-store",
        });
        fs.createReadStream(_currentVideoFile).pipe(res);
        return;
      }

      // Serves the registered subtitle file as WebVTT (.srt is converted).
      if (url.pathname === "/sub") {
        if (!_currentSubtitleFile) {
          res.writeHead(404);
          res.end();
          return;
        }
        let text;
        try {
          text = fs.readFileSync(_currentSubtitleFile, "utf8");
        } catch {
          res.writeHead(404);
          res.end();
          return;
        }
        if (path.extname(_currentSubtitleFile).toLowerCase() === ".srt")
          text = srtToVtt(text);
        res.writeHead(200, {
          "Content-Type": "text/vtt; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(text);
        return;
      }

      if (url.pathname === "/hls.js") {
        // load first: if hls.js is missing (npm install not run) nothing has
        // been written yet, so the error response below is still possible
        let script;
        try {
          script = loadHlsJs();
        } catch (e) {
          console.error(
            "[hianime] hls.js not found:",
            e.message,
          );
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("hls.js missing");
          return;
        }
        res.writeHead(200, {
          "Content-Type": "application/javascript",
          "Cache-Control": "private, max-age=86400",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(script);
        return;
      }

      if (url.pathname === "/proxy") {
        const target = url.searchParams.get("url");
        if (!target) {
          res.writeHead(400);
          res.end();
          return;
        }
        proxyRequest(target, req, res);
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "0.0.0.0", () => {
      _playerServer = server;
      resolve(server);
    });
    server.on("error", reject);
  });
}

// ── Show / episode resolution ────────────────────────────────────────────────

const SHOW_LOOKUP_TTL = 30 * 60 * 1000;
const _showCache = new Map(); // normalized candidates -> { ts, show }

// Finds the HiAnime show for the given title candidates. Prefers an exact
// (normalized) title match over the first search hit. Candidates that normalize
// to the same string are searched only once; results are cached.
async function findShow(candidates) {
  const seen = new Set();
  const unique = candidates.filter((c) => {
    const n = normalizeTitle(c);
    if (!n || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
  const cacheKey = [...seen].join("|");
  const hit = _showCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < SHOW_LOOKUP_TTL) return hit.show;

  let fallback = null;
  let found = null;
  for (const candidate of unique) {
    let results;
    try {
      results = await hianimeSearch(candidate);
    } catch (e) {
      if (/Cloudflare/i.test(e.message)) throw e;
      continue;
    }
    if (!results.length) continue;
    const exact = results.find(
      (r) =>
        seen.has(normalizeTitle(r.title)) ||
        (r.jname && seen.has(normalizeTitle(r.jname))),
    );
    if (exact) {
      found = exact;
      break;
    }
    if (!fallback) fallback = results[0];
  }
  const show = found || fallback;
  if (show) {
    if (_showCache.size > 200)
      _showCache.delete(_showCache.keys().next().value);
    _showCache.set(cacheKey, { ts: Date.now(), show });
  }
  return show;
}

// ── IPC input validation ──────────────────────────────────────────────────────

const asString = (v, max = 300) =>
  typeof v === "string" ? v.slice(0, max) : "";
const asPosInt = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 100000 ? n : fallback;
};

// Whitelist + range-check the renderer-supplied player defaults — the values
// are embedded verbatim into the generated player page (`const DEF=…`).
function sanitizePlayerPrefs(p) {
  const out = {};
  if (!p || typeof p !== "object") return out;
  const num = (v, lo, hi) =>
    typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi
      ? v
      : undefined;
  let v = num(p.rate, 0.25, 4);
  if (v !== undefined) out.rate = v;
  v = num(p.vol, 0, 1);
  if (v !== undefined) out.vol = v;
  if (p.muted === true) out.muted = true;
  v = num(p.cueSize, 0.5, 3);
  if (v !== undefined) out.cueSize = v;
  v = num(p.subOff, -30, 30);
  if (v !== undefined) out.subOff = v;
  if (Array.isArray(p.speeds)) {
    const seen = new Set();
    const speeds = p.speeds
      .filter((n) => typeof n === "number" && n >= 0.25 && n <= 4)
      .filter((n) => !seen.has(n) && seen.add(n))
      .sort((a, b) => a - b)
      .slice(0, 10);
    if (speeds.length) out.speeds = speeds;
  }
  return out;
}

// ── IPC registration ──────────────────────────────────────────────────────────

// Register a video URL with the local player server. Works for any public
// http(s) stream — HiAnime passes its own referer, other callers (native
// player mode) pass the headers captured by the session hook.
// Without an explicit referer the stream's own origin is used.
async function setPlayerVideo(args = {}) {
  const url = asString(args.url, 4096);
  // only public http(s) targets may ever reach the local proxy
  await assertPublicUrl(url);
  const referer = asString(args.referer, 2048) || new URL(url).origin + "/";
  const origin = asString(args.origin, 512) || null;
  const userAgent = asString(args.userAgent, 512) || null;
  const subtitle = asString(args.subtitle, 4096) || null;
  const subtitles = (Array.isArray(args.subtitles) ? args.subtitles : [])
    .map((s) => ({
      url: asString(s?.url, 4096),
      lang: asString(s?.lang, 32) || null,
    }))
    .filter((s) => s.url)
    .slice(0, 16);
  await assertPublicUrl(referer);
  if (origin) await assertPublicUrl(origin);
  if (subtitle) await assertPublicUrl(subtitle);
  for (const s of subtitles) await assertPublicUrl(s.url);
  // The explicitly chosen track leads the list so it starts as the default
  if (subtitle && !subtitles.some((s) => s.url === subtitle))
    subtitles.unshift({ url: subtitle, lang: null });
  _currentVideoUrl = url;
  _currentVideoReferer = referer;
  _currentVideoOrigin = origin;
  _currentVideoUA = userAgent;
  _currentVideoSubtitle = subtitle;
  _currentVideoSubtitles = subtitles;
  _currentVideoStartTime = asPosInt(args.startTime, 0);
  _currentVideoPrefs = sanitizePlayerPrefs(args.prefs);
  _currentVideoFile = null;
  _currentSubtitleFile = null;
  const server = await getPlayerServer();
  return {
    playerUrl: `http://127.0.0.1:${server.address().port}/player?t=${_serverToken}`,
  };
}

// Register a local media file (e.g. a download) with the local player server.
// The /file and /sub routes only ever serve the paths registered here.
async function setPlayerFile(args = {}) {
  const file = resolveLocalMedia(asString(args.file, 4096));
  if (!file) return { ok: false, error: "Not a readable media file" };
  let sub = null;
  const sp = args.subtitle;
  if (typeof sp === "string" && sp) {
    try {
      const real = fs.realpathSync(sp);
      const ext = path.extname(real).toLowerCase();
      if (
        fs.statSync(real).isFile() &&
        (ext === ".srt" || ext === ".vtt")
      )
        sub = real;
    } catch {}
  }
  _currentVideoUrl = null;
  _currentVideoFile = file;
  _currentSubtitleFile = sub;
  _currentVideoSubtitle = null;
  _currentVideoSubtitles = [];
  _currentVideoStartTime = asPosInt(args.startTime, 0);
  _currentVideoPrefs = sanitizePlayerPrefs(args.prefs);
  const server = await getPlayerServer();
  return {
    ok: true,
    playerUrl: `http://127.0.0.1:${server.address().port}/player?t=${_serverToken}`,
  };
}

function register() {
  ipcMain.handle("set-player-video", (_, args) => setPlayerVideo(args));

  ipcMain.handle("resolve-hianime", async (event, args = {}) => {
    // progress events drive the loading screen in the renderer
    const report = (stage) => {
      try {
        if (!event.sender.isDestroyed()) {
          event.sender.send("hianime-progress", { stage });
        }
      } catch {
        // renderer went away, nothing to report to
      }
    };
    try {
      const title = asString(args.title);
      if (!title) return { ok: false, error: "Missing title" };
      const isMovie = args.isMovie === true;
      const season = asPosInt(args.seasonNumber, 1) || 1;
      const episodeNumber = asPosInt(args.episodeNumber, 1) || 1;
      const mode = args.translationType === "dub" ? "dub" : "sub";
      report("search");

      // 1. AniList season title lookup (S2+ have their own HiAnime entry)
      const anilistResult = isMovie
        ? {
            title,
            romaji: null,
            episodes: null,
            nextTitle: null,
            nextRomaji: null,
          }
        : await anilistSeasonTitle(title, season);

      let searchTitle = anilistResult.title;
      let adjustedEpisodeNumber = episodeNumber;

      if (
        !isMovie &&
        anilistResult.episodes &&
        episodeNumber > anilistResult.episodes &&
        anilistResult.nextTitle
      ) {
        adjustedEpisodeNumber = episodeNumber - anilistResult.episodes;
        searchTitle = anilistResult.nextTitle;
      }

      // 2. Build search candidate list
      const candidates = [
        ...new Set([
          searchTitle,
          sanitizeTitle(searchTitle),
          ...(anilistResult.romaji && searchTitle === anilistResult.title
            ? [anilistResult.romaji]
            : []),
          ...(anilistResult.nextRomaji &&
          searchTitle === anilistResult.nextTitle
            ? [anilistResult.nextRomaji]
            : []),
          title,
          sanitizeTitle(title),
        ]),
      ].filter(Boolean);

      // 3. Search HiAnime (cached per title)
      const show = await findShow(candidates);
      if (!show) return { ok: false, error: "No results for: " + searchTitle };

      // 4. Episode list → episode id
      report("episodes");
      const episodes = await cachedEpisodes(show.id);
      if (!episodes.length) {
        return { ok: false, error: "No episodes found for: " + show.title };
      }
      const wantedNumber = isMovie ? "1" : String(adjustedEpisodeNumber);
      const episode =
        episodes.find((e) => e.number === wantedNumber) ||
        episodes.find((e) => parseFloat(e.number) === Number(wantedNumber)) ||
        (isMovie ? episodes[0] : null);
      if (!episode) {
        return { ok: false, error: "Episode " + wantedNumber + " not found" };
      }

      // 5. Stream (servers → embed → de-obfuscate)
      report("stream");
      const stream = await hianimeStream(episode.epId, mode);
      return {
        ok: true,
        url: stream.masterUrl,
        resolution: stream.resolution,
        sourceName: SERVER_NAME,
        isDirectMp4: false,
        referer: stream.referer,
        subtitle: stream.subtitle,
        malId: stream.malId,
        searchTitle,
        matchedTitle: show.title,
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e).slice(0, 200) };
    }
  });

  // Debug helper, only available in development builds
  ipcMain.handle("debug-hianime", async (_, args = {}) => {
    if (app.isPackaged) return { error: "disabled in packaged builds" };
    try {
      if (args.epId) {
        const stream = await hianimeStream(
          String(args.epId),
          args.mode || "sub",
        );
        return stream;
      }
      if (args.showId) {
        const episodes = await hianimeEpisodes(args.showId);
        return { count: episodes.length, episodes: episodes.slice(0, 50) };
      }
      const season = args.season || 1;
      const resolved = await anilistSeasonTitle(args.title || "", season);
      const results = await hianimeSearch(resolved.title);
      return { resolvedTitle: resolved, results };
    } catch (e) {
      return { error: e.message };
    }
  });
}

module.exports = {
  register,
  setPlayerVideo,
  setPlayerFile,
  setStreamMetaLookup,
  setProgressListener,
  // exported for tests
  _internal: {
    deobfuscateBlob,
    unwrapApiHtml,
    rewritePlaylist,
    normalizeTitle,
    resolveLocalMedia,
    sniffMediaFile,
  },
};
