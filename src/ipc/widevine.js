// ── Widevine CDM management ─────────────────────────────────────────────────
// Electron doesn't ship the Widevine Content Decryption Module, so DRM
// services (Netflix, Paramount+, Crave…) can't play.
//
// Google's public dl.google.com/widevine-cdm zips were taken down, so the
// install path mirrors what Firefox does: Mozilla's widevinecdm.json manifest
// (in the Firefox source tree) points at the same signed .crx3 component
// packages Chromium's component updater fetches, with a sha512 hash for every
// platform. We fetch the manifest → pick the platform entry → download the
// crx3 → verify hash + size → strip the CRX header → unzip.
//
// Files land under userData/widevine/<ver>/ (manifest.json +
// _platform_specific/<plat>/lib*) and are also mirrored beside the Electron
// binary as WidevineCdm/ — the bundled dir is what actually gets the CDM
// loaded: Electron 46+ auto-detects <exe dir>/WidevineCdm at zygote time,
// which happens before app JS runs, so appendSwitch is too late on Linux.
// Electron 45 and older lack CDM loading entirely (the support landed with
// electron/electron#50046). Verified: EME requestMediaKeySystemAccess
// accepts com.widevine.alpha on 46.0.0-alpha.12 with the flat layout.

const { app, session, net, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const crypto = require("crypto");

const MANIFEST_URL =
  "https://raw.githubusercontent.com/mozilla-firefox/firefox/refs/heads/main/toolkit/content/gmp-sources/widevinecdm.json";

// Manifest platform keys (Mozilla's gmp-sources naming)
const PLAT_KEY = () => {
  if (process.platform === "linux") {
    if (process.arch === "x64") return "Linux_x86_64-gcc3";
    return null; // Google doesn't publish a linux-arm64 CDM
  }
  if (process.platform === "win32")
    return process.arch === "arm64"
      ? "WINNT_aarch64-msvc-aarch64"
      : "WINNT_x86_64-msvc";
  if (process.platform === "darwin")
    return process.arch === "arm64"
      ? "Darwin_aarch64-gcc3"
      : "Darwin_x86_64-gcc3";
  return null;
};

// Files inside the crx3 zip use e.g. _platform_specific/linux_x64
const PLAT_SUBDIR = () => {
  if (process.platform === "linux") return "linux_x64";
  if (process.platform === "win32")
    return process.arch === "arm64" ? "win_arm64" : "win_x64";
  if (process.platform === "darwin")
    return process.arch === "arm64" ? "mac_arm64" : "mac_x64";
  return `${process.platform}_${process.arch}`;
};
const LIB_NAME = () =>
  process.platform === "win32"
    ? "widevinecdm.dll"
    : process.platform === "darwin"
      ? "libwidevinecdm.dylib"
      : "libwidevinecdm.so";

const rootDir = () => path.join(app.getPath("userData"), "widevine");
const libPath = (dir) =>
  path.join(dir, "_platform_specific", PLAT_SUBDIR(), LIB_NAME());
const manifestPath = (dir) => path.join(dir, "manifest.json");

function readManifestJson(dir) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(dir), "utf8"));
  } catch {
    return null;
  }
}

// Newest installed version dir, or null.
function installedDir() {
  try {
    const dirs = fs
      .readdirSync(rootDir())
      .filter((d) => /^\d/.test(d))
      .filter((d) => fs.existsSync(libPath(path.join(rootDir(), d))))
      .sort();
    return dirs.length ? path.join(rootDir(), dirs[dirs.length - 1]) : null;
  } catch {
    return null;
  }
}

const distCdmDir = () =>
  path.join(path.dirname(process.execPath), "WidevineCdm");

// What the launcher will actually load: the bundled dir beside the binary.
function bundledDir() {
  const dd = distCdmDir();
  try {
    if (fs.existsSync(manifestPath(dd)) && fs.existsSync(libPath(dd)))
      return dd;
  } catch {}
  return null;
}

let loadedAtLaunch = false;

function status() {
  const dir = installedDir();
  const bdir = bundledDir();
  const m = dir && readManifestJson(dir);
  const bm = bdir && readManifestJson(bdir);
  return {
    installed: !!dir || !!bdir,
    version: m?.version || bm?.version || (dir ? path.basename(dir) : null),
    bundled: !!bdir,
    bundledVersion: bm?.version || null,
    loadedAtLaunch,
    path: dir,
    supported: !!PLAT_KEY(),
  };
}

// On Linux the zygote preloads the bundled WidevineCdm dir before app JS, so
// this mostly records whether a loadable CDM was present at startup. If the
// userData copy exists but the bundled mirror was wiped (node_modules
// reinstalls), it gets re-mirrored here so the NEXT launch loads it.
function applyWidevineFlag() {
  const wasBundled = !!bundledDir();
  if (!wasBundled) {
    const udir = installedDir();
    if (udir) {
      try {
        fs.cpSync(udir, distCdmDir(), { recursive: true });
      } catch {}
    }
  }
  const dir = bundledDir() || installedDir();
  if (!dir) return;
  // On Linux the CDM only loads when the bundled dir existed at zygote time.
  loadedAtLaunch = wasBundled || process.platform !== "linux";
  try {
    app.commandLine.appendSwitch("widevine-cdm-path", dir);
    const v = readManifestJson(dir)?.version || path.basename(dir);
    app.commandLine.appendSwitch("widevine-cdm-version", v);
  } catch {}
}

// ── Minimal ZIP reader (store + deflate) ────────────────────────────────────
function unzip(buf) {
  const files = {};
  const tail = buf.subarray(Math.max(0, buf.length - 0x10000));
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file");
  const count = tail.readUInt16LE(eocd + 10);
  let off = tail.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    const lh = localOff;
    const lNameLen = buf.readUInt16LE(lh + 26);
    const lExtraLen = buf.readUInt16LE(lh + 28);
    const dataOff = lh + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataOff, dataOff + compSize);
    files[name] =
      method === 8
        ? zlib.inflateRawSync(raw)
        : method === 0
          ? Buffer.from(raw)
          : null;
  }
  return files;
}

// CRX3: "Cr24" + uint32 version + uint32 headerLen + signed header + zip
function stripCrx(buf) {
  if (buf.toString("latin1", 0, 4) === "Cr24") {
    const headerLen = buf.readUInt32LE(8);
    return buf.subarray(12 + headerLen);
  }
  return buf; // plain zip already
}

async function install() {
  const platKey = PLAT_KEY();
  if (!platKey)
    throw new Error(
      `No CDM build for ${process.platform}/${process.arch}`,
    );
  const ses = session.defaultSession;
  const mRes = await net.fetch(MANIFEST_URL, { session: ses });
  if (!mRes.ok) throw new Error(`Manifest HTTP ${mRes.status}`);
  const manifest = await mRes.json();
  const entry =
    manifest?.vendors?.["gmp-widevinecdm"]?.platforms?.[platKey];
  const url = entry?.fileUrl || entry?.mirrorUrls?.[0];
  if (!url) throw new Error("Platform not in manifest");

  const fetchCrx = async (u) => {
    const r = await net.fetch(u, { session: ses });
    if (!r.ok) throw new Error(`CDM HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  };
  let crx;
  try {
    crx = await fetchCrx(url);
  } catch (e) {
    const mirror = entry.mirrorUrls?.find((u) => u !== url);
    if (!mirror) throw e;
    crx = await fetchCrx(mirror);
  }

  // Integrity: size + sha512 from the signed manifest
  if (entry.filesize && crx.length !== entry.filesize)
    throw new Error("CDM size mismatch");
  if (entry.hashValue) {
    const sha = crypto.createHash("sha512").update(crx).digest("hex");
    if (sha !== entry.hashValue)
      throw new Error("CDM sha512 mismatch — aborting install");
  }

  const files = unzip(stripCrx(crx));
  const platSub = PLAT_SUBDIR();
  const libKey = Object.keys(files).find(
    (k) => k.includes(platSub) && k.endsWith(LIB_NAME()),
  ) || Object.keys(files).find((k) => k.endsWith(LIB_NAME()));
  const lib = libKey && files[libKey];
  const cdmManifest = files["manifest.json"];
  if (!lib || !cdmManifest) throw new Error("CDM files missing in package");
  const version = JSON.parse(cdmManifest.toString("utf8"))?.version;

  const dir = path.join(rootDir(), version || "unknown");
  const platDir = path.join(dir, "_platform_specific", platSub);
  fs.mkdirSync(platDir, { recursive: true });
  fs.writeFileSync(path.join(platDir, LIB_NAME()), lib, { mode: 0o755 });
  fs.writeFileSync(manifestPath(dir), cdmManifest);
  for (const k of ["LICENSE", "LICENSE.txt"]) {
    if (files[k]) {
      fs.writeFileSync(path.join(dir, "LICENSE.txt"), files[k]);
      break;
    }
  }

  // Mirror beside the Electron binary — on Linux the zygote preloads the CDM
  // before app JS, making this location the reliable one. Best-effort.
  try {
    const dd = distCdmDir();
    const dPlat = path.join(dd, "_platform_specific", platSub);
    fs.mkdirSync(dPlat, { recursive: true });
    fs.writeFileSync(path.join(dPlat, LIB_NAME()), lib, { mode: 0o755 });
    fs.writeFileSync(path.join(dd, "manifest.json"), cdmManifest);
    const lic = files["LICENSE"] || files["LICENSE.txt"];
    if (lic) fs.writeFileSync(path.join(dd, "LICENSE.txt"), lic);
  } catch {}

  return { ok: true, version, restartRequired: true };
}

function remove() {
  try {
    fs.rmSync(rootDir(), { recursive: true, force: true });
  } catch {}
  try {
    fs.rmSync(distCdmDir(), { recursive: true, force: true });
  } catch {}
  return { ok: true, restartRequired: true };
}

function register() {
  ipcMain.handle("widevine-status", () => status());
  ipcMain.handle("widevine-install", async () => {
    try {
      return await install();
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("widevine-remove", () => {
    try {
      return remove();
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  // Generic relaunch — used after CDM install/remove.
  ipcMain.handle("restart-app", () => {
    app.relaunch();
    app.exit(0);
  });
}

module.exports = { register, applyWidevineFlag };
