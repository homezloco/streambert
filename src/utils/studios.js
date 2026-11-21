// ── Studio / Network resolution (keyless) ────────────────────────────────────
// Cinemeta exposes no company data, so studios come from Wikidata:
// P272 = production company (films), P449 = original network (series).
// One batched SPARQL VALUES query resolves a whole browse page at once,
// same pattern as fetchWikidataCertMap in ageRating.js.
import { useState, useEffect } from "react";
import { storage } from "./storage";

const WDQS = "https://query.wikidata.org/sparql";
const QID = /^Q\d+$/;
const CACHE_KEY = "studioCache";
const CAT_CACHE_KEY = "studioCatCache";
const CACHE_TTL = 90 * 24 * 60 * 60 * 1000;
const CAT_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

// Corporate-suffix normalize so "HBO", "HBO Entertainment" and
// "Warner Bros. Pictures"/"Warner Bros. Entertainment" merge into one
// dropdown entry instead of three near-duplicates.
const CO_SUFFIX =
  /(?:[,\s]+(?:inc|llc|ltd|co|company|corp|corporation|group|media|pictures|entertainment|studios|productions|films|international|television|animation|network|networks|gmbh|sa|kk)\.?)+$/i;
export const normalizeStudio = (name) =>
  (name || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(CO_SUFFIX, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export async function fetchStudioMap(imdbIds) {
  const map = new Map();
  const ids = [...new Set((imdbIds || []).filter((id) => /^tt\d+$/.test(id)))];
  for (let i = 0; i < ids.length; i += 150) {
    const values = ids
      .slice(i, i + 150)
      .map((id) => `"${id}"`)
      .join(" ");
    const query =
      `SELECT ?imdb ?coLabel WHERE { VALUES ?imdb { ${values} } ` +
      `?item wdt:P345 ?imdb. ` +
      `{ ?item wdt:P272 ?co. } UNION { ?item wdt:P449 ?co. } ` +
      `SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
    try {
      const res = await fetch(
        `${WDQS}?format=json&query=${encodeURIComponent(query)}`,
        {
          headers: {
            Accept: "application/sparql-results+json",
            "User-Agent": "streambert/1.0 (media browser)",
          },
        },
      );
      if (!res.ok) continue;
      const data = await res.json();
      for (const b of data?.results?.bindings || []) {
        const id = b.imdb?.value;
        const name = (b.coLabel?.value || "").trim();
        if (!id || !name || QID.test(name)) continue;
        const arr = map.get(id) || [];
        if (!arr.includes(name)) arr.push(name);
        map.set(id, arr);
      }
    } catch {}
  }
  return map;
}

// ── Studio catalog ──────────────────────────────────────────────────────────
// "Browse by studio" isn't a filter of loaded items — resolve the company
// to a Wikidata entity, then list every film/series it produced/aired.
const WD_TYPE_Q = { movie: "wd:Q11424", tv: "wd:Q5398426" };

async function resolveCompanyQid(name) {
  try {
    const url =
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json` +
      `&language=en&limit=6&type=item&origin=*&search=${encodeURIComponent(name)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "streambert/1.0 (media browser)" },
    });
    if (!res.ok) return null;
    const list = (await res.json())?.search || [];
    if (!list.length) return null;
    const exact = list.find(
      (e) => (e.label || "").toLowerCase() === name.toLowerCase(),
    );
    return (exact || list[0]).id || null;
  } catch {
    return null;
  }
}

// Returns IMDb ids (newest first) for a company name, or []. Cached.
export async function fetchStudioTitleIds(companyName, type, limit = 150) {
  const cacheKey = `${type}|${companyName.toLowerCase()}`;
  const cache = storage.get(CAT_CACHE_KEY) || {};
  const hit = cache[cacheKey];
  if (hit && Date.now() - hit.ts <= CAT_CACHE_TTL) return hit.ids;

  const qid = await resolveCompanyQid(companyName);
  if (!qid) return [];
  const typeQ = WD_TYPE_Q[type] || WD_TYPE_Q.movie;
  const query =
    `SELECT DISTINCT ?imdb WHERE { ` +
    `?item wdt:P345 ?imdb. ?item wdt:P31 ${typeQ}. ` +
    `{ ?item wdt:P272 wd:${qid}. } UNION { ?item wdt:P449 wd:${qid}. } ` +
    `OPTIONAL { ?item wdt:P577 ?date. } ` +
    `} ORDER BY DESC(?date) LIMIT ${limit}`;
  let ids = [];
  try {
    const res = await fetch(
      `${WDQS}?format=json&query=${encodeURIComponent(query)}`,
      {
        headers: {
          Accept: "application/sparql-results+json",
          "User-Agent": "streambert/1.0 (media browser)",
        },
      },
    );
    if (res.ok) {
      const data = await res.json();
      ids = (data?.results?.bindings || [])
        .map((b) => b.imdb?.value)
        .filter((v) => /^tt\d+$/.test(v));
      ids = [...new Set(ids)];
    }
  } catch {}
  cache[cacheKey] = { ids, ts: Date.now() };
  storage.set(CAT_CACHE_KEY, cache);
  return ids;
}

// Hook: given browse items (tt ids in keyless mode), returns a map
// {imdbId: [company,…]}. Cached in storage so repeat visits need no queries.
export function useStudios(items) {
  const [studioMap, setStudioMap] = useState({});

  useEffect(() => {
    const ids = (items || [])
      .map((i) => i.id)
      .filter((id) => /^tt\d+$/.test(id));
    if (!ids.length) return;

    const cache = storage.get(CACHE_KEY) || {};
    const now = Date.now();
    const initial = {};
    const missing = [];
    for (const id of new Set(ids)) {
      const e = cache[id];
      if (e && now - e.ts <= CACHE_TTL) initial[id] = e.cos;
      else missing.push(id);
    }
    if (Object.keys(initial).length)
      setStudioMap((prev) => ({ ...prev, ...initial }));
    if (!missing.length) return;

    let cancelled = false;
    (async () => {
      const found = await fetchStudioMap(missing);
      if (cancelled) return;
      const patch = {};
      for (const id of missing) {
        const cos = found.get(id) || [];
        cache[id] = { cos, ts: now };
        patch[id] = cos;
      }
      storage.set(CACHE_KEY, cache);
      setStudioMap((prev) => ({ ...prev, ...patch }));
    })();
    return () => {
      cancelled = true;
    };
  }, [items]);

  return studioMap;
}
