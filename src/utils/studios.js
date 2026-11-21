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
const CACHE_TTL = 90 * 24 * 60 * 60 * 1000;

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

// Hook: given browse items (tt ids in keyless mode), returns
// { studioMap, studioReady } — studioMap: {imdbId: [company,…]}.
// Cached in storage so repeat visits need no queries.
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
