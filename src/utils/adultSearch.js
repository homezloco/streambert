// Cross-site adult search: each adapter hits a free/public JSON catalog and
// normalizes results into one shape so AdultPage can merge them into a single
// grid. Every adapter fails soft (returns []) — one dead site must not break
// the merge.
//
// Normalized item:
//   {
//     id,          // site-prefixed unique key ("ph_abc123")
//     title,
//     url,         // video page URL — play fallback + dedupe key
//     embed,       // iframe player URL when the site provides one (preferred)
//     thumb,       // primary thumbnail URL
//     thumbs,      // extra thumbnail URLs for hover-cycling (may be [])
//     duration,    // seconds
//     durationMin, // "m:ss" label when the API provides one
//     rating,      // normalized to the 0–5 scale the card badge expects
//     views,
//     site,        // source label shown as a badge on the card
//     keywords,    // tags/categories when the API provides them
//   }

// Same free JSON catalog the Browse tab already uses — no key.
const EPORNER_API = "https://www.eporner.com/api/v2/video/search/";

// Duration arrives as seconds (Eporner) or "m:ss"/"h:mm:ss" strings (the
// Pornhub/RedTube webmaster family).
const toSeconds = (d) => {
  if (typeof d === "number" && isFinite(d)) return d;
  if (!d) return 0;
  const parts = String(d).split(":").map(Number);
  if (!parts.length || parts.some((n) => !isFinite(n))) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
};

// These APIs all rate on a 0–5 scale; anything above 5 is treated as a
// percentage and scaled down so the card's rate×20 math still works.
const toRate5 = (r) => {
  const n = parseFloat(r);
  if (!isFinite(n)) return 0;
  return n > 5 ? n / 20 : n;
};

// Thumbs come as URL strings or {src, size, …} objects depending on the API.
const thumbSrc = (t) => (typeof t === "string" ? t : t?.src) || null;

// Pornhub/RedTube ship tags + categories as [{name}] or plain strings.
const toKeywords = (v) =>
  [...(v.tags || []), ...(v.categories || [])]
    .map((t) => (typeof t === "string" ? t : t?.name || t?.tag_name || ""))
    .filter(Boolean)
    .join(", ");

const epornerItem = (v) => ({
  id: `eporner_${v.id}`,
  title: v.title,
  url: v.url,
  embed: v.embed || null,
  thumb: thumbSrc(v.default_thumb) || thumbSrc(v.thumbs?.[0]),
  thumbs: (v.thumbs || []).map(thumbSrc).filter(Boolean),
  duration: v.length_sec || 0,
  durationMin: v.length_min || "",
  rating: toRate5(v.rate),
  views: v.views || 0,
  site: "Eporner",
  keywords: v.keywords || "",
});

// Pornhub webmaster API: {videos:[{video_id,title,url,embed,duration,rating,
// ratings,views,thumb,default_thumb,thumbs,tags}]}
const phItem = (v) => ({
  id: `ph_${v.video_id || v.id}`,
  title: v.title,
  url: v.url,
  embed: v.embed || null,
  thumb:
    thumbSrc(v.default_thumb) ||
    thumbSrc(v.thumb) ||
    thumbSrc(v.thumbs?.[0]),
  thumbs: (v.thumbs || []).map(thumbSrc).filter(Boolean),
  duration: toSeconds(v.duration),
  rating: toRate5(v.rating),
  views: v.views || 0,
  site: "Pornhub",
  keywords: toKeywords(v),
});

// RedTube ships the same video-shape family; items may be flat video objects
// or wrapped in {video:{…}} depending on the call.
const rtItem = (item) => {
  const v = item.video || item;
  return {
    id: `rt_${v.video_id || v.id}`,
    title: v.title,
    url: v.url,
    embed: v.embed || null,
    thumb:
      thumbSrc(v.default_thumb) ||
      thumbSrc(v.thumb) ||
      thumbSrc(v.thumbs?.[0]),
    thumbs: (v.thumbs || []).map(thumbSrc).filter(Boolean),
    duration: toSeconds(v.duration),
    rating: toRate5(v.rating),
    views: v.views || 0,
    site: "RedTube",
    keywords: toKeywords(v),
  };
};

export const SEARCH_SOURCES = [
  {
    id: "eporner",
    label: "Eporner",
    async search(q, page) {
      try {
        const u =
          `${EPORNER_API}?query=${encodeURIComponent(q)}&per_page=30` +
          `&page=${page}&thumbsize=big&order=latest`;
        const data = await (await fetch(u)).json();
        return (data?.videos || []).map(epornerItem);
      } catch {
        return [];
      }
    },
    // "popular" = most viewed, "top-rated" = highest rated (all-time)
    async browse(order, page) {
      try {
        const u =
          `${EPORNER_API}?query=all&per_page=30&page=${page}` +
          `&thumbsize=big&order=${order === "top-rated" ? "top-rated" : "popular"}`;
        const data = await (await fetch(u)).json();
        return (data?.videos || []).map(epornerItem);
      } catch {
        return [];
      }
    },
  },
  {
    id: "pornhub",
    label: "Pornhub",
    async search(q, page) {
      try {
        const u =
          `https://www.pornhub.com/webmasters/search` +
          `?search=${encodeURIComponent(q)}&page=${page}&thumbsize=big`;
        const data = await (await fetch(u)).json();
        return (data?.videos || []).map(phItem);
      } catch {
        return [];
      }
    },
    // Empty query + ordering works — the API lists its whole catalog
    async browse(order, page) {
      try {
        const o = order === "top-rated" ? "rating" : "mostviewed";
        const u =
          `https://www.pornhub.com/webmasters/search` +
          `?ordering=${o}&page=${page}&thumbsize=big`;
        const data = await (await fetch(u)).json();
        return (data?.videos || []).map(phItem);
      } catch {
        return [];
      }
    },
  },
  {
    id: "redtube",
    label: "RedTube",
    async search(q, page) {
      try {
        const u =
          `https://api.redtube.com/?data=redtube.Videos.searchVideos` +
          `&output=json&search=${encodeURIComponent(q)}` +
          `&page=${page}&thumbsize=big`;
        const data = await (await fetch(u)).json();
        return (data?.videos || []).map(rtItem);
      } catch {
        return [];
      }
    },
    async browse(order, page) {
      try {
        const o = order === "top-rated" ? "rating" : "mostviewed";
        const u =
          `https://api.redtube.com/?data=redtube.Videos.searchVideos` +
          `&output=json&ordering=${o}` +
          `&page=${page}&thumbsize=big`;
        const data = await (await fetch(u)).json();
        return (data?.videos || []).map(rtItem);
      } catch {
        return [];
      }
    },
  },
];

// Interleave site buckets round-robin so one prolific site can't crowd out
// the rest, and dedupe on normalized URL — mirror sites occasionally index
// the same video.
function mergeBuckets(buckets) {
  const seen = new Set();
  const out = [];
  let added = true;
  for (let i = 0; added; i++) {
    added = false;
    for (const bucket of buckets) {
      const item = bucket[i];
      if (!item) continue;
      added = true;
      const key = (item.url || item.id || "")
        .replace(/\/+$/, "")
        .toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

// Fire every adapter in parallel and merge one page of results.
export async function searchAllSites(query, page = 1) {
  const settled = await Promise.allSettled(
    SEARCH_SOURCES.map((s) => s.search(query, page)),
  );
  const buckets = settled.map((r) => (r.status === "fulfilled" ? r.value : []));
  return mergeBuckets(buckets);
}

// Same merge for catalog "top" feeds — the adult Home rows pull Trending
// ("popular") and Top Rated ("top-rated") from every site that has a browse
// endpoint, so the rows aren't Eporner-only.
export async function browseAllSites(order = "popular", page = 1) {
  const settled = await Promise.allSettled(
    SEARCH_SOURCES.map((s) => s.browse?.(order, page) ?? []),
  );
  const buckets = settled.map((r) => (r.status === "fulfilled" ? r.value : []));
  return mergeBuckets(buckets);
}
