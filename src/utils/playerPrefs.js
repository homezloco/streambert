// Configured player defaults (Settings → player defaults). Each value is
// optional; anything absent or invalid is omitted so the generated player
// page falls back to its "remember last" cookie behaviour.
//
// Keys read:  playerDefRate, playerDefVol, playerDefMuted,
//             playerDefCueSize, playerDefSubOff, playerSpeeds,
//             playerDefPrebuffer
// Keys emit:  { rate, vol, muted, cueSize, subOff, speeds, prebuffer }

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
  const prebuffer = numInRange(storage.get("playerDefPrebuffer"), 1, 120);
  if (prebuffer !== undefined) prefs.prebuffer = Math.round(prebuffer);
  Object.assign(prefs, videoEnhancePrefs());
  return prefs;
}

// Video enhancement settings (brightness/contrast/saturation/sharpen),
// applied both to the app's own player (via prefs below) and injected into
// guest webviews over the "video-enhance" IPC channel.
export function videoEnhancePrefs() {
  return {
    bright: numInRange(storage.get("playerEnhBrightness"), 0.5, 2) ?? 1,
    contrast: numInRange(storage.get("playerEnhContrast"), 0.5, 2) ?? 1,
    saturate: numInRange(storage.get("playerEnhSaturation"), 0.5, 2) ?? 1,
    sharpen: storage.get("playerEnhSharpen") === true,
  };
}

// Push current enhancement prefs to the main process so it can inject them
// into embedded players (app start + every settings change).
export function pushVideoEnhance() {
  window.electron?.setVideoEnhance?.(videoEnhancePrefs());
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
