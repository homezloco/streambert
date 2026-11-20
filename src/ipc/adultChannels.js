// ── Adult channel catalogs ──────────────────────────────────────────────────
// Neither public API exposes channels, so these scrape the sites' own
// /channels listing pages in the browser process (no CORS) and normalize the
// cards into one shape for the renderer.
//
// Requests go through the site's own persist:adult_<id> session — the
// per-site proxy from Settings → "Adult section proxy" applies, and cookie
// state stays isolated per site (see index.js configureAdultSessionIfNeeded).
//
// Normalized channel:
//   { site, slug, name, url, avatar, rank, subs, videos, views }
// Counts are raw numbers where parseable; 0 when the card doesn't show them.

const { ipcMain, session, net } = require("electron");
const networkIpc = require("./network");

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// "1,043,755" | "3.9K" | "124M" | number → number
function parseCount(v) {
  if (typeof v === "number" && isFinite(v)) return v;
  if (!v) return 0;
  const s = String(v).trim().replace(/,/g, "");
  const m = s.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return 0;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase()] || 1;
  return Math.round(n * mult);
}

const decodeEntities = (s) =>
  String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

// ── Pornhub ─────────────────────────────────────────────────────────────────
// /channels?o=rk|tr|al|mr&page=N — cards are <li class="wrap"> blocks with a
// .channelsWrapper: avatar img, usernameLink name, Rank + Subscribers/Videos/
// Videos Views <li><label><span>count</span></li> rows.
const PH_SORTS = {
  rank: "rk",
  trending: "tr",
  alpha: "al",
  recent: "mr",
  // PH has no subs/views ordering on this page — rank is the sensible default
  subs: "rk",
  views: "rk",
  top: "rk",
};

function parsePornhubChannels(html) {
  const out = [];
  const blocks = html.split('<li class="wrap">').slice(1);
  for (const b of blocks) {
    // The split already bounds each card; cap length for regex cost
    const card = b.slice(0, 6000);
    const slug = card.match(/href="\/channels\/([a-z0-9-]+)"/i)?.[1];
    if (!slug) continue;
    const name =
      card.match(/class="usernameLink"[^>]*>([^<]+)</i)?.[1] ||
      card.match(/alt="([^"]+)"/i)?.[1] ||
      slug;
    const avatar = card.match(
      /class="avatar"[\s\S]*?<img[^>]*src="([^"]+)"/i,
    )?.[1];
    const rank = parseCount(
      card.match(/Rank<br\/>\s*([\d,]+)/i)?.[1],
    );
    const grab = (label) =>
      parseCount(
        new RegExp(`${label}<span>([\\d.,KMkm\\s]+)</span>`, "i").exec(
          card,
        )?.[1],
      );
    out.push({
      site: "Pornhub",
      siteId: "pornhub",
      slug,
      name: decodeEntities(name),
      url: `https://www.pornhub.com/channels/${slug}`,
      avatar,
      rank,
      subs: grab("Subscribers"),
      videos: grab("Videos"),
      views: grab("Videos Views"),
    });
  }
  return out;
}

// ── RedTube ─────────────────────────────────────────────────────────────────
// /channel[/sort] — cards are <li class="channel-card-wrapper"> with a
// card-link href, channel-name, stats-label/stats-value pairs, channel-logo img.
const RT_SORTS = {
  rank: "",
  subs: "/most-subscribed",
  views: "/most-viewed",
  recent: "/recently-updated",
  top: "/top-rated",
  trending: "/trending",
  alpha: "/alphabetical",
};

function parseRedtubeChannels(html) {
  const out = [];
  const blocks = html
    .split('<li class="channel-card-wrapper">')
    .slice(1);
  for (const b of blocks) {
    const card = b.split("</li>")[0];
    const slug = card.match(/href="\/channels\/([a-z0-9-]+)"/i)?.[1];
    if (!slug) continue;
    const name =
      card.match(/class="channel-name"[^>]*>([^<]+)</i)?.[1] || slug;
    const avatar = card.match(/class="channel-logo"[\s\S]*?<img[^>]*src="([^"]+)"/i)?.[1];
    const stat = (cls) =>
      parseCount(
        new RegExp(
          `class="${cls}"[^>]*>[\\s\\S]*?class="stats-value"[^>]*>([^<]+)`,
          "i",
        ).exec(card)?.[1],
      );
    out.push({
      site: "RedTube",
      siteId: "redtube",
      slug,
      name: decodeEntities(name),
      url: `https://www.redtube.com/channels/${slug}`,
      avatar,
      rank: stat("channel-rank"),
      videos: stat("channel-videos"),
      views: stat("channel-views"),
      subs: stat("channel-subscribers"),
    });
  }
  return out;
}

const SITES = {
  pornhub: {
    url: (sort, page) =>
      `https://www.pornhub.com/channels?o=${PH_SORTS[sort] || "rk"}${
        page > 1 ? `&page=${page}` : ""
      }`,
    parse: parsePornhubChannels,
  },
  redtube: {
    url: (sort, page) =>
      `https://www.redtube.com/channel${RT_SORTS[sort] ?? ""}${
        page > 1 ? `?page=${page}` : ""
      }`,
    parse: parseRedtubeChannels,
  },
};

async function fetchChannels(siteId, sort, page) {
  const site = SITES[siteId];
  if (!site) return [];
  const url = site.url(sort, page);
  const ses = session.fromPartition(`persist:adult_${siteId}`);
  // Adult-section proxy applies if the user configured one; harmless when
  // the partition was already configured for a webview.
  try {
    await networkIpc.applyAdultSessionProxy(ses);
  } catch {}
  const res = await net.fetch(url, {
    session: ses,
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  if (!res.ok) return [];
  const html = await res.text();
  return site.parse(html);
}

function register() {
  ipcMain.handle("adult-channels", async (_, args = {}) => {
    try {
      const site = args.site === "all" ? "all" : args.site;
      const sort = typeof args.sort === "string" ? args.sort : "rank";
      const page =
        Number.isFinite(args.page) && args.page > 0 && args.page < 200
          ? Math.floor(args.page)
          : 1;
      const ids =
        site === "all" ? Object.keys(SITES) : SITES[site] ? [site] : [];
      const settled = await Promise.allSettled(
        ids.map((id) => fetchChannels(id, sort, page)),
      );
      // Round-robin interleave, dedupe by site+slug
      const buckets = settled.map((r) =>
        r.status === "fulfilled" ? r.value : [],
      );
      const seen = new Set();
      const out = [];
      let added = true;
      for (let i = 0; added; i++) {
        added = false;
        for (const bucket of buckets) {
          const c = bucket[i];
          if (!c) continue;
          added = true;
          const key = `${c.siteId}:${c.slug}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(c);
        }
      }
      return { ok: true, channels: out };
    } catch (e) {
      return { ok: false, error: e.message, channels: [] };
    }
  });
}

module.exports = { register };
