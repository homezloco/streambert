// ── Network privacy: proxy, DNS-over-HTTPS, WebRTC leak protection ───────────
//
// Settings live in userData/network-settings.json (plain JSON — not secret,
// and it must be readable synchronously before app ready for the WebRTC
// command-line flag).

const { app, session, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const DEFAULTS = {
  proxyMode: "off", // off | socks5 | http
  proxyHost: "",
  proxyPort: "",
  proxyBypass: "", // comma-separated hosts to exclude
  dohMode: "off", // off | cloudflare | google | quad9 | custom
  dohCustom: "", // DoH template URL for custom mode
  webrtcProtect: true, // force default-route-only WebRTC candidate gathering
  // Per-section proxy for the adult site partitions (persist:adult_*).
  // "main" inherits the global proxy settings above; "off" is a direct
  // connection even when the global proxy is on; socks5/http use their own
  // host/port/bypass.
  adultProxyMode: "main", // main | off | socks5 | http
  adultProxyHost: "",
  adultProxyPort: "",
  adultProxyBypass: "",
};

const DOH_SERVERS = {
  cloudflare: ["https://cloudflare-dns.com/dns-query"],
  google: ["https://dns.google/dns-query"],
  quad9: ["https://dns.quad9.net/dns-query"],
};

const settingsFile = () =>
  path.join(app.getPath("userData"), "network-settings.json");

function getSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    return { ...DEFAULTS, ...(raw || {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeSettings(s) {
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
}

const HOST_RE = /^[a-zA-Z0-9._-]+$/;
const HOST_PORT_RE = /^[a-zA-Z0-9._-]+:\d{1,5}$/;
const SCHEME_HOST_PORT_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[a-zA-Z0-9._-]+:\d{1,5}$/;

// Chromium proxyRules grammar is fussy; emit exactly one of its accepted forms.
function proxyConfig(s) {
  const host = (s.proxyHost || "").trim();
  const port = parseInt(s.proxyPort, 10);
  if (s.proxyMode === "off" || !HOST_RE.test(host) || !(port > 0 && port < 65536))
    return { mode: "system" };
  const scheme = s.proxyMode === "socks5" ? "socks5" : "http";
  const cfg = { proxyRules: `${scheme}://${host}:${port}` };
  const bypass = (s.proxyBypass || "").trim();
  if (bypass) cfg.proxyBypassRules = bypass;
  return cfg;
}

// Proxy for adult site partitions: "main" inherits the global config,
// "off" forces a direct connection, socks5/http use the adult_* fields.
function adultProxyConfig(s) {
  if (s.adultProxyMode === "main") return proxyConfig(s);
  if (s.adultProxyMode === "off") return { mode: "direct" };
  return proxyConfig({
    proxyMode: s.adultProxyMode,
    proxyHost: s.adultProxyHost,
    proxyPort: s.adultProxyPort,
    proxyBypass: s.adultProxyBypass,
  });
}

// Apply the adult-section proxy to a single session (called when each
// persist:adult_* partition is lazily configured).
async function applyAdultSessionProxy(ses) {
  try {
    await ses.setProxy(adultProxyConfig(getSettings()));
  } catch {}
}

// Partitions persist under userData/Partitions/<name> — enumerate site/service
// partitions so settings changes reach sessions created earlier.
function partitionsWithPrefix(prefix) {
  try {
    const dir = path.join(app.getPath("userData"), "Partitions");
    return fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((d) => d.startsWith(prefix))
      : [];
  } catch {
    return [];
  }
}

const adultPartitions = () => partitionsWithPrefix("adult_");
const svcPartitions = () => partitionsWithPrefix("svc_");

// Apply proxy + DoH to every session the app uses (default session covers the
// main window; player/trailer partitions cover webviews and the pop-out).
// Safe to call any time — takes effect for subsequent requests.
async function applyNetwork() {
  const s = getSettings();
  const cfg = proxyConfig(s);
  const sessions = [
    session.defaultSession,
    session.fromPartition("persist:player"),
    session.fromPartition("persist:trailer"),
  ];
  for (const ses of sessions) {
    try {
      await ses.setProxy(cfg);
    } catch {}
  }
  // Per-site adult partitions route through their own proxy setting;
  // streaming-service partitions follow the global proxy.
  const adultCfg = adultProxyConfig(s);
  for (const name of adultPartitions()) {
    try {
      await session.fromPartition(`persist:${name}`).setProxy(adultCfg);
    } catch {}
  }
  for (const name of svcPartitions()) {
    try {
      await session.fromPartition(`persist:${name}`).setProxy(cfg);
    } catch {}
  }
  try {
    if (s.dohMode === "off") {
      app.configureSecureDNS({ enableSecureDns: false });
      return;
    }
    const servers =
      s.dohMode === "custom"
        ? [s.dohCustom].filter((u) => /^https:\/\//.test(u || ""))
        : DOH_SERVERS[s.dohMode];
    if (servers && servers.length) {
      app.configureSecureDNS({ enableSecureDns: true, secureDnsServers: servers });
    }
  } catch {}
}

// WebRTC's default-route-only policy must be a command-line switch, so it has
// to be applied before app ready. Default ON: it only prevents sites from
// enumerating your real/local IPs via ICE candidates.
function applyWebRtcFlag() {
  if (getSettings().webrtcProtect) {
    app.commandLine.appendSwitch(
      "force-webrtc-ip-handling-policy",
      "disable_non_proxied_udp",
    );
  }
}

const asStr = (v, max = 256) =>
  typeof v === "string" ? v.slice(0, max).trim() : "";

function sanitize(raw = {}) {
  const s = { ...DEFAULTS };
  s.proxyMode = ["off", "socks5", "http"].includes(raw.proxyMode)
    ? raw.proxyMode
    : "off";
  s.proxyHost = asStr(raw.proxyHost, 253);
  s.proxyPort = String(parseInt(raw.proxyPort, 10) || "").slice(0, 5);
  s.proxyBypass = asStr(raw.proxyBypass, 512)
    .split(",")
    .map((h) => h.trim())
    .filter((h) => HOST_RE.test(h) || HOST_PORT_RE.test(h) || SCHEME_HOST_PORT_RE.test(h) || h === "<local>" || h.startsWith("*."))
    .join(",");
  s.dohMode = ["off", "cloudflare", "google", "quad9", "custom"].includes(
    raw.dohMode,
  )
    ? raw.dohMode
    : "off";
  s.dohCustom = asStr(raw.dohCustom, 512);
  s.webrtcProtect = raw.webrtcProtect !== false;
  s.adultProxyMode = ["main", "off", "socks5", "http"].includes(
    raw.adultProxyMode,
  )
    ? raw.adultProxyMode
    : "main";
  s.adultProxyHost = asStr(raw.adultProxyHost, 253);
  s.adultProxyPort = String(parseInt(raw.adultProxyPort, 10) || "").slice(0, 5);
  s.adultProxyBypass = asStr(raw.adultProxyBypass, 512)
    .split(",")
    .map((h) => h.trim())
    .filter((h) => HOST_RE.test(h) || HOST_PORT_RE.test(h) || SCHEME_HOST_PORT_RE.test(h) || h === "<local>" || h.startsWith("*."))
    .join(",");
  return s;
}

function register() {
  ipcMain.handle("network-get", () => getSettings());
  ipcMain.handle("network-set", async (_, raw) => {
    const prev = getSettings();
    const next = sanitize(raw);
    writeSettings(next);
    await applyNetwork();
    return {
      ok: true,
      restartRequired: prev.webrtcProtect !== next.webrtcProtect,
    };
  });
}

// Apply the global app proxy to one session (streaming-service partitions).
async function applyGlobalSessionProxy(ses) {
  try {
    await ses.setProxy(proxyConfig(getSettings()));
  } catch {}
}

module.exports = {
  register,
  applyNetwork,
  applyWebRtcFlag,
  applyAdultSessionProxy,
  applyGlobalSessionProxy,
  getSettings,
};
