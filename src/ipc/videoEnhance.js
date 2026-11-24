// ── Video enhancement for guest webviews ─────────────────────────────────────
// Applies the user's Settings → Player defaults enhancement (brightness /
// contrast / saturation CSS filters + an SVG feConvolveMatrix sharpen) to
// <video> elements inside guest webviews — including embed iframes, via
// per-frame injection. Config is pushed from the renderer over the
// "video-enhance" channel; all-default config injects nothing.

const { ipcMain } = require("electron");

let cfg = { bright: 1, contrast: 1, saturate: 1, sharpen: false };
const watched = new Set(); // live guest webContents

const clamp01 = (v) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0.5 && v <= 2 ? v : 1;

const isDefault = () =>
  cfg.bright === 1 && cfg.contrast === 1 && cfg.saturate === 1 && !cfg.sharpen;

const SHARP_DEFS =
  '<filter id="sb-vsharp">' +
  '<feConvolveMatrix order="3" preserveAlpha="true" ' +
  'kernelMatrix="0 -0.3 0 -0.3 2.2 -0.3 0 -0.3 0"/></filter>';

function injectJs() {
  if (isDefault()) {
    // Turning the feature off removes previously injected nodes so the
    // change applies live to an already-playing video.
    return `(function(){
      var s=document.getElementById('sb-venh');if(s)s.remove();
      var g=document.getElementById('sb-vsharpdefs');if(g)g.remove();
    })()`;
  }
  const parts = [];
  if (cfg.bright !== 1) parts.push(`brightness(${cfg.bright})`);
  if (cfg.contrast !== 1) parts.push(`contrast(${cfg.contrast})`);
  if (cfg.saturate !== 1) parts.push(`saturate(${cfg.saturate})`);
  if (cfg.sharpen) parts.push("url(#sb-vsharp)");
  const rule = `video{filter:${parts.join(" ")} !important}`;
  return `(function(){
    var st=document.getElementById('sb-venh');
    if(!st){st=document.createElement('style');st.id='sb-venh';
      (document.head||document.documentElement).appendChild(st);}
    st.textContent=${JSON.stringify(rule)};
    if(${cfg.sharpen ? "true" : "false"}&&!document.getElementById('sb-vsharpdefs')){
      var s=document.createElementNS('http://www.w3.org/2000/svg','svg');
      s.id='sb-vsharpdefs';s.setAttribute('width','0');s.setAttribute('height','0');
      s.setAttribute('style','position:absolute');
      s.innerHTML=${JSON.stringify(SHARP_DEFS)};
      (document.body||document.documentElement).appendChild(s);
    }
  })()`;
}

function applyTo(wc) {
  if (wc.isDestroyed()) return;
  const js = injectJs();
  try {
    for (const f of wc.frames || []) f.executeJavaScript(js).catch(() => {});
  } catch {}
}

// Watch a guest so enhancement survives navigations and reaches iframes.
function watch(wc) {
  if (!wc || wc.isDestroyed() || watched.has(wc)) return;
  watched.add(wc);
  wc.once("destroyed", () => watched.delete(wc));
  wc.on("dom-ready", () => applyTo(wc));
  wc.on("did-frame-navigate", () => applyTo(wc));
  wc.on("did-navigate-in-page", () => applyTo(wc));
}

function register() {
  ipcMain.on("video-enhance", (_e, c) => {
    cfg = {
      bright: clamp01(c?.bright),
      contrast: clamp01(c?.contrast),
      saturate: clamp01(c?.saturate),
      sharpen: c?.sharpen === true,
    };
    // Live-apply to everything currently playing
    for (const wc of watched) applyTo(wc);
  });
}

module.exports = { register, watch };
