// Configured player defaults (Settings → player defaults). Each value is
// optional; anything absent or invalid is omitted so the generated player
// page falls back to its "remember last" cookie behaviour.
//
// Keys read:  playerDefRate, playerDefVol, playerDefMuted,
//             playerDefCueSize, playerDefSubOff, playerSpeeds
// Keys emit:  { rate, vol, muted, cueSize, subOff, speeds }

import { storage } from "./storage";

const numInRange = (v, lo, hi) =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi
    ? v
    : undefined;

export function playerDefaults() {
  const prefs = {};
  const rate = numInRange(storage.get("playerDefRate"), 0.25, 4);
  if (rate !== undefined) prefs.rate = rate;
  const vol = numInRange(storage.get("playerDefVol"), 0, 1);
  if (vol !== undefined) prefs.vol = vol;
  if (storage.get("playerDefMuted") === true) prefs.muted = true;
  const cueSize = numInRange(storage.get("playerDefCueSize"), 0.5, 3);
  if (cueSize !== undefined) prefs.cueSize = cueSize;
  const subOff = numInRange(storage.get("playerDefSubOff"), -30, 30);
  if (subOff !== undefined) prefs.subOff = subOff;
  const speeds = parseSpeedList(storage.get("playerSpeeds"));
  if (speeds.length) prefs.speeds = speeds;
  return prefs;
}

// "0.75, 1, 1.5, 2" → [0.75,1,1.5,2]; clamps to 0.25–4, dedupes, sorts, max 10
export function parseSpeedList(raw) {
  if (typeof raw !== "string") return [];
  const seen = new Set();
  return raw
    .split(/[\s,;]+/)
    .map((s) => parseFloat(s))
    .filter((n) => Number.isFinite(n) && n >= 0.25 && n <= 4)
    .filter((n) => !seen.has(n) && seen.add(n))
    .sort((a, b) => a - b)
    .slice(0, 10);
}
