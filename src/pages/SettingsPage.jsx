import { useState, useEffect, useRef } from "react";
import UpdateModal from "../components/UpdateModal";
import BlockedStatsModal from "../components/BlockedStatsModal";
import {
  storage,
  STORAGE_KEYS,
  secureStorage,
  isElectron,
  clearAppCaches,
  getSourceStats,
  hashPin,
} from "../utils/storage";
import {
  clearTmdbCache,
  CINEMETA_KEY,
  PLAYER_SOURCES,
  NON_ANIME_DEFAULT_SOURCE,
} from "../utils/api";
import {
  ACCENT_PRESETS,
  applyAccentColor,
  THEME_PRESETS,
  applyTheme,
  DEFAULT_CUSTOM_VARS,
} from "../utils/appearance";
import { SUBTITLE_LANGUAGES } from "../utils/subtitles";
import { parseSpeedList, pushVideoEnhance } from "../utils/playerPrefs";
import { DEFAULT_INVIDIOUS_BASE } from "../components/TrailerModal";
import { RATING_COUNTRIES } from "../utils/ageRating";
import { WarningIcon } from "../components/Icons";
import {
  checkForUpdatesWithFallback,
  UPDATE_SOURCES,
  DEFAULT_UPDATE_SOURCE,
} from "../utils/updates";
import {
  HOME_ROWS,
  loadHomeLayout,
  loadHomeViewMode,
  saveHomeViewMode,
} from "../utils/homeLayout";
import { collectBackupData, restoreBackupData } from "../utils/backup";
import { formatBytes } from "../utils/storage";

// ── Relative-time label ("3m ago", "2d ago") for stat tooltips ───────────────
const relAgo = (ts) => {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

// ── Custom Select ─────────────────────────────────────────────────────────────
function SettingsSelect({ value, onChange, options, style }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selectedLabel =
    options.find((o) => String(o.value) === String(value))?.label ?? value;

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div
      ref={ref}
      style={{ position: "relative", display: "inline-block", ...style }}
    >
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 28,
          padding: "9px 14px",
          background: open ? "var(--surface3)" : "var(--surface2)",
          border: `1px solid ${open ? "var(--red)" : "var(--border)"}`,
          boxShadow: open ? "0 0 0 3px rgba(229,9,20,0.12)" : "none",
          borderRadius: 8,
          color: "var(--text)",
          fontFamily: "var(--font-body)",
          fontSize: 14,
          cursor: "pointer",
          whiteSpace: "nowrap",
          minWidth: 0,
          transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.background = "var(--surface3)";
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = "var(--surface2)";
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {selectedLabel}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text3)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 999,
            background: "var(--surface3)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
            minWidth: "100%",
            maxHeight: 280,
            overflowY: "auto",
            padding: "4px",
          }}
        >
          {options.map((o) => {
            const active = String(o.value) === String(value);
            return (
              <div
                key={o.value}
                onMouseDown={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                style={{
                  padding: "8px 12px",
                  fontSize: 14,
                  borderRadius: 7,
                  cursor: "pointer",
                  color: active ? "var(--red)" : "var(--text)",
                  background: active ? "rgba(229,9,20,0.10)" : "transparent",
                  fontWeight: active ? 600 : 400,
                  transition: "background 0.1s, color 0.1s",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => {
                  if (!active)
                    e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = "transparent";
                }}
              >
                {o.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Start page config ─────────────────────────────────────────────────────────

// Age limit options: null = none, or specific ages
const AGE_LIMIT_OPTIONS = [
  { value: "", label: "No restriction" },
  { value: "0", label: "0 — All audiences (G / FSK 0)" },
  { value: "7", label: "7 — Family friendly (PG / FSK 6)" },
  { value: "12", label: "12 — Teens and up" },
  { value: "13", label: "13 — PG-13 and equivalent" },
  { value: "15", label: "15 — Older teens" },
  { value: "16", label: "16 — FSK 16 and equivalent" },
  { value: "17", label: "17 — R / 17+ and equivalent" },
  { value: "18", label: "18 — Adults only (NC-17 / FSK 18)" },
];

// ── Confirmation Dialog ───────────────────────────────────────────────────────
function ResetConfirmDialog({ onConfirm, onCancel }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "36px 40px",
          maxWidth: 460,
          width: "90%",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
      >
        {/* Warning icon */}
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "rgba(229,9,20,0.12)",
            border: "1px solid rgba(229,9,20,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
          }}
        >
          <WarningIcon size={24} />
        </div>

        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 26,
            letterSpacing: 1,
            marginBottom: 10,
          }}
        >
          RESET STREAMBERT?
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--text2)",
            lineHeight: 1.7,
            marginBottom: 28,
          }}
        >
          This will permanently delete all your settings, watch history, saved
          titles, progress data, and cached data. Your downloaded video files
          will{" "}
          <span style={{ color: "var(--text)", fontWeight: 600 }}>not</span> be
          deleted.
          <br />
          <br />
          <span style={{ color: "var(--red)" }}>
            This action cannot be undone.
          </span>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <button
            className="btn btn-ghost"
            style={{ flex: 1 }}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="btn"
            style={{
              flex: 1,
              background: "var(--red)",
              color: "#fff",
              border: "none",
              fontWeight: 600,
            }}
            onClick={onConfirm}
          >
            Yes, Reset Everything
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Generic Confirm Dialog ───────────────────────────────────────────────────
function ConfirmDialog({
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "36px 40px",
          maxWidth: 460,
          width: "90%",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "rgba(229,9,20,0.12)",
            border: "1px solid rgba(229,9,20,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
          }}
        >
          <WarningIcon size={24} />
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 22,
            letterSpacing: 1,
            marginBottom: 10,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--text2)",
            lineHeight: 1.7,
            marginBottom: 28,
          }}
        >
          {description}
          <br />
          <br />
          <span style={{ color: "var(--red)" }}>
            This action cannot be undone.
          </span>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            className="btn btn-ghost"
            style={{ flex: 1 }}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="btn"
            style={{
              flex: 1,
              background: "var(--red)",
              color: "#fff",
              border: "none",
              fontWeight: 600,
            }}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Toggle Switch ─────────────────────────────────────────────────────────────
function Toggle({ value, onChange, title }) {
  return (
    <button
      onClick={() => onChange(!value)}
      title={title}
      style={{
        background: value ? "var(--red)" : "var(--surface2)",
        border: "1px solid " + (value ? "var(--red)" : "var(--border)"),
        borderRadius: 20,
        width: 40,
        height: 22,
        cursor: "pointer",
        position: "relative",
        flexShrink: 0,
        transition: "background 0.2s, border-color 0.2s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: value ? 20 : 2,
          width: 16,
          height: 16,
          background: "#fff",
          borderRadius: "50%",
          transition: "left 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }}
      />
    </button>
  );
}

// ── Status Badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  if (!status) return null;
  const isError = status.startsWith("✕");
  return (
    <div
      style={{
        marginTop: 10,
        fontSize: 13,
        fontWeight: 500,
        color: isError ? "var(--red)" : "#48c774",
      }}
    >
      {status}
    </div>
  );
}

// ── Clean Row ─────────────────────────────────────────────────────────────────
function CleanRow({
  title,
  description,
  buttonLabel,
  onAction,
  danger,
  sizeLabel,
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [hovered, setHovered] = useState(false);

  const handle = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await onAction();
      if (result?.cancelled) {
        // User dismissed the confirm dialog
        return;
      }
      setStatus(result?.msg || "✓ Done");
      setTimeout(() => setStatus(null), 4000);
    } catch (e) {
      setStatus("✕ " + (e.message || "Something went wrong"));
      setTimeout(() => setStatus(null), 4000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 24,
      }}
    >
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "var(--text)",
            marginBottom: 4,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {title}
          {sizeLabel && (
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text2)",
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "3px 10px",
                letterSpacing: 0.2,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {sizeLabel}
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: "var(--text3)", lineHeight: 1.6 }}>
          {description}
        </div>
        <StatusBadge status={status} />
      </div>
      <div style={{ flexShrink: 0, paddingTop: 2 }}>
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={handle}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={
            danger
              ? {
                  color: hovered ? "#fff" : "var(--red)",
                  background: hovered ? "rgba(229,9,20,0.85)" : "transparent",
                  borderColor: hovered ? "transparent" : "rgba(229,9,20,0.35)",
                  opacity: busy ? 0.5 : 1,
                  transition: "all 0.2s",
                }
              : { opacity: busy ? 0.5 : 1 }
          }
        >
          {busy ? "Working…" : buttonLabel}
        </button>
      </div>
    </div>
  );
}

// ── Version & Update Section ──────────────────────────────────────────────────
function VersionSection() {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null); // { latest, current, url, hasUpdate } | { error }
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [autoCheck, setAutoCheck] = useState(() => {
    const stored = storage.get(STORAGE_KEYS.AUTO_CHECK_UPDATES);
    return stored === null || stored === undefined ? true : !!stored;
  });
  const [autoSaved, setAutoSaved] = useState(false);
  const [currentVersion, setCurrentVersion] = useState("0.0.0");
  const [updateSource, setUpdateSource] = useState(
    () => storage.get(STORAGE_KEYS.UPDATE_SOURCE) || DEFAULT_UPDATE_SOURCE,
  );

  useEffect(() => {
    if (window.electron?.getAppVersion) {
      window.electron.getAppVersion().then((v) => {
        setCurrentVersion(v);
      });
    }
  }, []);

  const runCheck = async () => {
    setChecking(true);
    setResult(null);
    try {
      const r = await checkForUpdatesWithFallback(updateSource);
      setResult(r);
    } catch (e) {
      setResult({
        error:
          e.message ||
          `Could not reach ${UPDATE_SOURCES[updateSource]?.label || "the update server"}.`,
      });
    } finally {
      setChecking(false);
    }
  };

  const changeSource = (src) => {
    setUpdateSource(src);
    storage.set(STORAGE_KEYS.UPDATE_SOURCE, src);
    setResult(null);
  };

  const toggleAuto = (val) => {
    setAutoCheck(val);
    storage.set(STORAGE_KEYS.AUTO_CHECK_UPDATES, val ? 1 : 0);
    setAutoSaved(true);
    setTimeout(() => setAutoSaved(false), 1800);
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">App Version</div>

      {/* Version row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "var(--text3)" }}>
            Current version
          </span>
          <code
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--text)",
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 12px",
            }}
          >
            v{currentVersion}
          </code>
        </div>

        <button
          className="btn btn-ghost"
          disabled={checking}
          onClick={runCheck}
          style={{ opacity: checking ? 0.6 : 1 }}
        >
          {checking ? "Checking…" : "Check for Updates"}
        </button>

        {/* Update source toggle */}
        <div
          style={{
            display: "inline-flex",
            border: "1px solid var(--border)",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {Object.values(UPDATE_SOURCES).map((src) => (
            <button
              key={src.id}
              onClick={() => changeSource(src.id)}
              disabled={checking}
              title={`Check for updates via ${src.label}`}
              style={{
                border: "none",
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 600,
                cursor: checking ? "not-allowed" : "pointer",
                background:
                  updateSource === src.id ? "var(--red)" : "var(--surface2)",
                color: updateSource === src.id ? "#fff" : "var(--text3)",
              }}
            >
              {src.label}
            </button>
          ))}
        </div>

        {result && !result.error && result.hasUpdate && (
          <button
            onClick={() => setShowUpdateModal(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "rgba(229,9,20,0.12)",
              border: "1px solid rgba(229,9,20,0.4)",
              color: "var(--red)",
              borderRadius: 8,
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 0.2s",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "rgba(229,9,20,0.22)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "rgba(229,9,20,0.12)")
            }
          >
            🎉 v{result.latest} available. Install Update
          </button>
        )}

        {result?.usedFallback && (
          <span style={{ fontSize: 12, color: "var(--text3)" }}>
            ({UPDATE_SOURCES[result.fallbackFrom]?.label || result.fallbackFrom}{" "}
            unavailable, used {result.sourceLabel} instead)
          </span>
        )}

        {result && !result.error && !result.hasUpdate && (
          <span style={{ fontSize: 13, color: "#48c774", fontWeight: 500 }}>
            ✓ You're up to date
          </span>
        )}

        {result?.error && (
          <span style={{ fontSize: 13, color: "var(--red)" }}>
            ✕ {result.error}
          </span>
        )}
      </div>

      {showUpdateModal && result?.hasUpdate && (
        <UpdateModal
          updateInfo={result}
          onClose={() => setShowUpdateModal(false)}
        />
      )}

      {/* Auto-check toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <Toggle
          value={autoCheck}
          onChange={toggleAuto}
          title={autoCheck ? "Disable auto-check" : "Enable auto-check"}
        />
        <div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>
            Check for updates on startup
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
            Shows a notification banner if a new version is available. Turned on
            by default.
          </div>
        </div>
        {autoSaved && (
          <span style={{ fontSize: 12, color: "#48c774" }}>✓ Saved</span>
        )}
      </div>
    </div>
  );
}

// ── Home Layout Section ───────────────────────────────────────────────────────
function HomeLayoutSection() {
  const [order, setOrder] = useState(() => {
    const { order: o } = loadHomeLayout();
    return o;
  });
  const [visible, setVisible] = useState(() => {
    const { visible: v } = loadHomeLayout();
    return v;
  });
  const [viewMode, setViewMode] = useState(() => loadHomeViewMode());
  const [saved, setSaved] = useState(false);
  const dragItem = useRef(null);
  const dragOver = useRef(null);

  const handleDragStart = (idx) => {
    dragItem.current = idx;
  };
  const handleDragEnter = (idx) => {
    dragOver.current = idx;
  };
  const handleDragEnd = () => {
    const newOrder = [...order];
    const dragged = newOrder.splice(dragItem.current, 1)[0];
    newOrder.splice(dragOver.current, 0, dragged);
    dragItem.current = null;
    dragOver.current = null;
    setOrder(newOrder);
  };

  const toggleVisible = (id) => {
    setVisible((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSave = () => {
    storage.set(STORAGE_KEYS.HOME_ROW_ORDER, order);
    storage.set(STORAGE_KEYS.HOME_ROW_VISIBLE, visible);
    saveHomeViewMode(viewMode);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const rowLabels = Object.fromEntries(HOME_ROWS.map((r) => [r.id, r.label]));

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">Home Page Layout</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        Choose which rows appear on the Home page and drag to reorder them. The
        hero banner is always shown at the top.
      </div>

      {/* ── View mode selector ── */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text2)",
            marginBottom: 8,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Row display style
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {[
            {
              value: "carousel",
              label: "Carousel",
              desc: "Scrollable spotlight with featured poster",
            },
            {
              value: "list",
              label: "⊞ Grid",
              desc: "Compact grid of all items",
            },
          ].map(({ value, label, desc }) => (
            <button
              key={value}
              onClick={() => setViewMode(value)}
              style={{
                flex: 1,
                maxWidth: 220,
                padding: "10px 14px",
                borderRadius: 8,
                border: `2px solid ${viewMode === value ? "var(--red)" : "var(--border)"}`,
                background:
                  viewMode === value
                    ? "color-mix(in srgb, var(--red) 12%, var(--surface))"
                    : "var(--surface)",
                color: viewMode === value ? "var(--text)" : "var(--text2)",
                cursor: "pointer",
                textAlign: "left",
                transition: "border-color 0.15s, background 0.15s",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
              <div
                style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}
              >
                {desc}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxWidth: 480,
        }}
      >
        {order.map((id, idx) => (
          <div
            key={id}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragEnter={() => handleDragEnter(idx)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => e.preventDefault()}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "10px 14px",
              cursor: "grab",
              opacity: visible[id] ? 1 : 0.45,
              transition: "opacity 0.2s",
              userSelect: "none",
            }}
          >
            {/* Drag handle */}
            <span
              style={{
                color: "var(--text3)",
                fontSize: 16,
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              ⠿
            </span>

            {/* Label */}
            <span
              style={{
                flex: 1,
                fontSize: 14,
                fontWeight: 500,
                color: "var(--text)",
              }}
            >
              {rowLabels[id] || id}
            </span>

            {/* Toggle */}
            <Toggle
              value={visible[id]}
              onChange={() => toggleVisible(id)}
              title={visible[id] ? "Hide row" : "Show row"}
            />
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <button className="btn btn-primary" onClick={handleSave}>
          Save Layout
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: "#48c774" }}>✓ Saved</span>
        )}
      </div>
    </div>
  );
}

// ── Scheduled Backup Section ──────────────────────────────────────────────────
const FREQUENCY_OPTIONS = [
  { value: "startup", label: "On App Start" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

function ScheduledBackupSection() {
  const [enabled, setEnabled] = useState(false);
  const [backupPath, setBackupPath] = useState("");
  const [keepCount, setKeepCount] = useState(5);
  const [frequency, setFrequency] = useState("startup");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isElectron) {
      setLoading(false);
      return;
    }
    window.electron.getScheduledBackupSettings().then((s) => {
      if (s) {
        setEnabled(!!s.enabled);
        setBackupPath(s.path || "");
        setKeepCount(s.keepCount ?? 5);
        setFrequency(s.frequency || "startup");
      }
      setLoading(false);
    });
  }, []);

  const pickFolder = async () => {
    if (!isElectron) return;
    const folder = await window.electron.pickFolder();
    if (folder) setBackupPath(folder);
  };

  const handleSave = async () => {
    if (!isElectron) return;
    const settings = {
      enabled,
      path: backupPath,
      keepCount: Math.max(1, Math.min(99, Number(keepCount) || 5)),
      frequency,
      lastRun: null,
    };
    // preserve lastRun from existing settings
    const existing = await window.electron.getScheduledBackupSettings();
    if (existing?.lastRun) settings.lastRun = existing.lastRun;
    await window.electron.setScheduledBackupSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!isElectron || loading) return null;

  return (
    <div
      style={{
        marginTop: 28,
        padding: "20px 22px",
        background: "var(--surface2)",
        border: "1px solid var(--border)",
        borderRadius: 10,
      }}
    >
      {/* Header row with toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: enabled ? 20 : 0,
        }}
      >
        <Toggle value={enabled} onChange={setEnabled} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
            Scheduled Backups
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
            Automatically save a backup file on a schedule
          </div>
        </div>
      </div>

      {enabled && (
        <>
          {/* Backup path */}
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--text2)",
                marginBottom: 6,
              }}
            >
              Backup Folder
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                className="apikey-input"
                style={{ flex: 1, marginBottom: 0 }}
                placeholder="/home/you/Backups"
                value={backupPath}
                onChange={(e) => setBackupPath(e.target.value)}
              />
              <button
                className="btn btn-ghost"
                style={{ padding: "7px 14px", fontSize: 13 }}
                onClick={pickFolder}
              >
                Browse…
              </button>
            </div>
          </div>

          {/* Frequency + Keep count row */}
          <div
            style={{
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
              marginBottom: 16,
            }}
          >
            <div style={{ flex: 1, minWidth: 160 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text2)",
                  marginBottom: 6,
                }}
              >
                Frequency
              </div>
              <SettingsSelect
                value={frequency}
                onChange={(v) => setFrequency(v)}
                options={FREQUENCY_OPTIONS}
                style={{ width: "100%" }}
              />
            </div>

            <div style={{ flex: 1, minWidth: 120 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text2)",
                  marginBottom: 6,
                }}
              >
                Keep Last N Backups
              </div>
              <input
                type="number"
                min={1}
                max={99}
                className="apikey-input"
                style={{ width: "100%", marginBottom: 0 }}
                value={keepCount}
                onChange={(e) => setKeepCount(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button className="btn btn-primary" onClick={handleSave}>
              Save
            </button>
            {saved && (
              <span style={{ fontSize: 13, color: "#48c774" }}>✓ Saved</span>
            )}
          </div>
        </>
      )}

      {!enabled && (
        <div
          style={{ display: "flex", justifyContent: "flex-end", marginTop: 0 }}
        >
          {/* empty, toggle handles everything */}
        </div>
      )}
    </div>
  );
}

// ── Backup & Restore ─────────────────────────────────────────────────────────
function BackupRestoreSection({ onRestored }) {
  const [restoreStatus, setRestoreStatus] = useState(null);

  const handleExport = () => {
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: collectBackupData(),
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `streambert-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const backup = JSON.parse(ev.target.result);
        if (!backup?.data)
          throw new Error("Invalid backup file, missing data field.");
        restoreBackupData(backup.data);
        setRestoreStatus("✓ Backup restored: reloading…");
        setTimeout(() => window.location.reload(), 1200);
        onRestored?.();
      } catch (err) {
        setRestoreStatus("✕ " + (err.message || "Could not read backup file."));
        setTimeout(() => setRestoreStatus(null), 4000);
      }
    };
    reader.readAsText(file);
    // Reset input so same file can be re-selected
    e.target.value = "";
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">Backup &amp; Restore</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 20,
          lineHeight: 1.6,
        }}
      >
        Export your watchlist, watch history, progress, and all settings to a
        JSON file. Import it later to restore everything, useful before
        reinstalling or switching devices.
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <button className="btn btn-primary" onClick={handleExport}>
          ⬆ Export Backup
        </button>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 18px",
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text)",
            cursor: "pointer",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--surface)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "var(--surface2)")
          }
        >
          ⬇ Import Backup
          <input
            type="file"
            accept=".json,application/json"
            onChange={handleImport}
            style={{ display: "none" }}
          />
        </label>
        {restoreStatus && (
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: restoreStatus.startsWith("✕") ? "var(--red)" : "#48c774",
            }}
          >
            {restoreStatus}
          </span>
        )}
      </div>
      <ScheduledBackupSection />
    </div>
  );
}

// ── Start Page Section ────────────────────────────────────────────────────────
// ── Appearance Section ────────────────────────────────────────────────────────
function AppearanceSection() {
  const [accent, setAccent] = useState(
    () => storage.get(STORAGE_KEYS.ACCENT_COLOR) || "red",
  );
  const [fontSize, setFontSize] = useState(
    () => storage.get(STORAGE_KEYS.FONT_SIZE) || "normal",
  );
  const [compact, setCompact] = useState(
    () => !!storage.get(STORAGE_KEYS.COMPACT_MODE),
  );
  const [noAnim, setNoAnim] = useState(
    () => !!storage.get(STORAGE_KEYS.REDUCE_ANIMATIONS),
  );
  const [gamepadEnabled, setGamepadEnabled] = useState(
    () => storage.get(STORAGE_KEYS.GAMEPAD_ENABLED) !== false,
  );
  const [accentInPlayer, setAccentInPlayer] = useState(
    () => storage.get(STORAGE_KEYS.ACCENT_IN_PLAYER) !== false,
  );
  const [theme, setTheme] = useState(
    () => storage.get(STORAGE_KEYS.THEME) || "dark",
  );
  const [customVars, setCustomVars] = useState(
    () =>
      storage.get(STORAGE_KEYS.CUSTOM_THEME_VARS) || { ...DEFAULT_CUSTOM_VARS },
  );
  const [showCustomEditor, setShowCustomEditor] = useState(false);
  const [saved, setSaved] = useState(false);

  // Remember the committed (saved) values to revert on unmount if unsaved
  const committedRef = useRef({
    accent: storage.get(STORAGE_KEYS.ACCENT_COLOR) || "red",
    theme: storage.get(STORAGE_KEYS.THEME) || "dark",
    customVars: storage.get(STORAGE_KEYS.CUSTOM_THEME_VARS) || {
      ...DEFAULT_CUSTOM_VARS,
    },
  });
  const savedRef = useRef(false);

  // Revert live preview when leaving without saving
  useEffect(() => {
    return () => {
      if (!savedRef.current) {
        const { accent, theme, customVars } = committedRef.current;
        applyAccentColor(accent);
        applyTheme(theme, theme === "custom" ? customVars : null);
      }
    };
  }, []);

  const handleThemeSelect = (id) => {
    setTheme(id);
    if (id !== "custom") {
      applyTheme(id);
    } else {
      applyTheme("custom", customVars);
      setShowCustomEditor(true);
    }
  };

  const handleCustomVarChange = (prop, value) => {
    const next = { ...customVars, [prop]: value };
    setCustomVars(next);
    applyTheme("custom", next);
  };

  const handleSave = () => {
    storage.set(STORAGE_KEYS.ACCENT_COLOR, accent);
    storage.set(STORAGE_KEYS.ACCENT_IN_PLAYER, accentInPlayer);
    storage.set(STORAGE_KEYS.FONT_SIZE, fontSize);
    storage.set(STORAGE_KEYS.COMPACT_MODE, compact ? 1 : 0);
    storage.set(STORAGE_KEYS.REDUCE_ANIMATIONS, noAnim ? 1 : 0);
    storage.set(STORAGE_KEYS.GAMEPAD_ENABLED, gamepadEnabled);
    window.dispatchEvent(new CustomEvent("streambert:gamepad-settings-changed"));
    storage.set(STORAGE_KEYS.THEME, theme);
    if (theme === "custom") {
      storage.set(STORAGE_KEYS.CUSTOM_THEME_VARS, customVars);
    }
    // Apply immediately
    applyAccentColor(accent);
    applyTheme(theme, theme === "custom" ? customVars : null);
    const zoomMap = { sm: 0.85, normal: 1, lg: 1.15 };
    if (window.electron?.setZoomFactor)
      window.electron.setZoomFactor(zoomMap[fontSize] ?? 1);
    document.body.classList.toggle("compact-mode", compact);
    document.body.classList.toggle("no-anim", noAnim);
    // Mark as saved so the cleanup effect doesn't revert
    savedRef.current = true;
    committedRef.current = { accent, theme, customVars };
    // Notify App.jsx so playerSettings prop (accent + lang) is refreshed
    window.dispatchEvent(new CustomEvent("streambert:player-settings-changed"));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const CUSTOM_VAR_LABELS = {
    "--bg": "Background",
    "--surface": "Surface",
    "--surface2": "Surface 2",
    "--surface3": "Surface 3",
    "--border": "Border",
    "--text": "Text",
    "--text2": "Text 2",
    "--text3": "Text 3",
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">Appearance</div>

      {/* Theme */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text2)",
            marginBottom: 10,
          }}
        >
          Theme
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {THEME_PRESETS.map((t) => (
            <button
              key={t.id}
              onClick={() => handleThemeSelect(t.id)}
              title={t.description}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                padding: "10px 14px",
                borderRadius: "var(--radius)",
                background:
                  theme === t.id
                    ? "color-mix(in srgb, var(--red) 15%, var(--surface2))"
                    : "var(--surface2)",
                border:
                  theme === t.id
                    ? "1.5px solid var(--red)"
                    : "1.5px solid var(--border)",
                cursor: "pointer",
                transition: "border-color 0.15s, background 0.15s",
                minWidth: 70,
              }}
            >
              {/* Mini preview swatch */}
              <div
                style={{
                  width: 40,
                  height: 28,
                  borderRadius: 4,
                  background:
                    t.id === "custom"
                      ? `linear-gradient(135deg, ${customVars["--bg"]} 50%, ${customVars["--surface2"]} 50%)`
                      : t.vars
                        ? `linear-gradient(135deg, ${t.vars["--bg"]} 50%, ${t.vars["--surface2"]} 50%)`
                        : "var(--surface3)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: theme === t.id ? 600 : 400,
                  color: theme === t.id ? "var(--text)" : "var(--text2)",
                  whiteSpace: "nowrap",
                }}
              >
                {t.label}
              </span>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 8 }}>
          {THEME_PRESETS.find((t) => t.id === theme)?.description}
        </div>
      </div>

      {/* Custom theme editor */}
      {theme === "custom" && (
        <div style={{ marginBottom: 24 }}>
          <button
            onClick={() => setShowCustomEditor((v) => !v)}
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: "5px 12px", marginBottom: 12 }}
          >
            {showCustomEditor ? "▲ Hide" : "▼ Edit"} custom colours
          </button>
          {showCustomEditor && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                gap: 12,
                padding: 16,
                background: "var(--surface2)",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
              }}
            >
              {Object.entries(CUSTOM_VAR_LABELS).map(([prop, label]) => (
                <div
                  key={prop}
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <input
                    type="color"
                    value={customVars[prop] || "#000000"}
                    onChange={(e) =>
                      handleCustomVarChange(prop, e.target.value)
                    }
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 4,
                      border: "1px solid var(--border)",
                      cursor: "pointer",
                      background: "none",
                      padding: 2,
                      flexShrink: 0,
                    }}
                  />
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--text)",
                        fontWeight: 500,
                      }}
                    >
                      {label}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text3)",
                        fontFamily: "monospace",
                      }}
                    >
                      {customVars[prop]}
                    </div>
                  </div>
                </div>
              ))}
              <div
                style={{
                  gridColumn: "1 / -1",
                  display: "flex",
                  gap: 8,
                  marginTop: 4,
                }}
              >
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: "5px 12px" }}
                  onClick={() => {
                    setCustomVars({ ...DEFAULT_CUSTOM_VARS });
                    applyTheme("custom", DEFAULT_CUSTOM_VARS);
                  }}
                >
                  Reset to defaults
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Accent Colour */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text2)",
            marginBottom: 10,
          }}
        >
          Accent Colour
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setAccent(p.id);
                applyAccentColor(p.id);
              }}
              title={p.label}
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: p.color,
                border:
                  accent === p.id
                    ? `3px solid var(--text)`
                    : "3px solid transparent",
                outline: accent === p.id ? `2px solid ${p.color}` : "none",
                outlineOffset: 2,
                cursor: "pointer",
                transition: "transform 0.15s",
                transform: accent === p.id ? "scale(1.15)" : "scale(1)",
                flexShrink: 0,
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 8 }}>
          {ACCENT_PRESETS.find((p) => p.id === accent)?.label}, applied to
          buttons, highlights, and indicators.
        </div>
        {/* Accent in streaming player */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 14,
          }}
        >
          <Toggle value={accentInPlayer} onChange={setAccentInPlayer} />
          <div>
            <div
              style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}
            >
              Apply accent colour to streaming player
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
              Passes the selected accent colour to the player source (Videasy,
              Vidking). VidSrc does not support colour theming.
            </div>
          </div>
        </div>
      </div>

      {/* Font Size */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text2)",
            marginBottom: 10,
          }}
        >
          Font Size
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { id: "sm", label: "Small" },
            { id: "normal", label: "Normal" },
            { id: "lg", label: "Large" },
          ].map((o) => (
            <button
              key={o.id}
              onClick={() => setFontSize(o.id)}
              className={
                fontSize === o.id ? "btn btn-primary" : "btn btn-ghost"
              }
              style={{
                padding: "7px 18px",
                fontSize: o.id === "sm" ? 12 : o.id === "lg" ? 16 : 14,
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Toggles */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Toggle value={compact} onChange={setCompact} />
          <div>
            <div
              style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}
            >
              Compact card grid
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
              Shows more titles per row by reducing card size.
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Toggle value={noAnim} onChange={setNoAnim} />
          <div>
            <div
              style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}
            >
              Reduce animations
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
              Disables transitions and hover effects throughout the app.
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Toggle value={gamepadEnabled} onChange={setGamepadEnabled} />
          <div>
            <div
              style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}
            >
              Controller support
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
              Navigate menus with a D-pad/stick and use A/B to select and go
              back. In the player: A play/pause, D-pad seek/volume, LB/RB
              skip ±15s, Y fullscreen, B exit.
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-primary" onClick={handleSave}>
          Save
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: "#48c774" }}>✓ Saved</span>
        )}
      </div>
    </div>
  );
}

// ── Library & Privacy Section ─────────────────────────────────────────────────
function LibraryPrivacySection() {
  const [sort, setSort] = useState(
    () => storage.get(STORAGE_KEYS.LIBRARY_SORT) || "manual",
  );
  const [savedSort, setSavedSort] = useState(
    () => storage.get("libSavedSort") || "added",
  );
  const [historySort, setHistorySort] = useState(
    () => storage.get("libHistorySort") || "recent",
  );
  const [historyEnabled, setHistoryEnabled] = useState(() => {
    const v = storage.get(STORAGE_KEYS.HISTORY_ENABLED);
    return v === 0 || v === false ? false : true;
  });
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    storage.set(STORAGE_KEYS.LIBRARY_SORT, sort);
    storage.set("libSavedSort", savedSort);
    storage.set("libHistorySort", historySort);
    storage.set(STORAGE_KEYS.HISTORY_ENABLED, historyEnabled ? 1 : 0);
    window.dispatchEvent(
      new CustomEvent("streambert:library-sort-changed", { detail: sort }),
    );
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const SORT_OPTIONS = [
    { value: "manual", label: "Custom order" },
    { value: "title", label: "Title A-Z" },
    { value: "rating", label: "Top rated" },
    { value: "year", label: "Newest first" },
  ];

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">Library & Privacy</div>

      {/* Watchlist Sort */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text2)",
            marginBottom: 8,
          }}
        >
          Watchlist sort order
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--text3)",
            marginBottom: 12,
            lineHeight: 1.6,
          }}
        >
          How titles in your watchlist are sorted. "Custom order" keeps your
          drag-and-drop arrangement.
        </div>
        <SettingsSelect
          value={sort}
          onChange={(v) => setSort(v)}
          options={SORT_OPTIONS}
        />
      </div>

      {/* Saved Tab Sort */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text2)",
            marginBottom: 8,
          }}
        >
          Saved tab sort order
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--text3)",
            marginBottom: 12,
            lineHeight: 1.6,
          }}
        >
          How titles in the Library's "Saved" tab are sorted.
        </div>
        <SettingsSelect
          value={savedSort}
          onChange={(v) => setSavedSort(v)}
          options={[
            { value: "added", label: "Added" },
            { value: "title", label: "Title A–Z" },
            { value: "newest", label: "Newest" },
            { value: "oldest", label: "Oldest" },
          ]}
        />
      </div>

      {/* History Tab Sort */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text2)",
            marginBottom: 8,
          }}
        >
          History tab sort order
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--text3)",
            marginBottom: 12,
            lineHeight: 1.6,
          }}
        >
          How items in the Library's "History" tab are sorted.
        </div>
        <SettingsSelect
          value={historySort}
          onChange={(v) => setHistorySort(v)}
          options={[
            { value: "recent", label: "Recent" },
            { value: "title", label: "Title A–Z" },
          ]}
        />
      </div>

      {/* Watch History Toggle */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Toggle value={historyEnabled} onChange={setHistoryEnabled} />
          <div>
            <div
              style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}
            >
              Record watch history
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
              When off, nothing you watch will be added to history or "Continue
              Watching".
            </div>
          </div>
        </div>
        {!historyEnabled && (
          <div
            style={{
              marginTop: 12,
              fontSize: 13,
              color: "var(--red)",
              background: "rgba(229,9,20,0.08)",
              border: "1px solid rgba(229,9,20,0.2)",
              borderRadius: 8,
              padding: "10px 14px",
            }}
          >
            ⚠ Watch history is disabled. Progress tracking and "Continue
            Watching" will not work.
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-primary" onClick={handleSave}>
          Save
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: "#48c774" }}>✓ Saved</span>
        )}
      </div>
    </div>
  );
}

function StartPageSection() {
  const [startPage, setStartPage] = useState(
    () => storage.get(STORAGE_KEYS.START_PAGE) || "home",
  );
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    storage.set(STORAGE_KEYS.START_PAGE, startPage);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">Start Page</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        Choose which page opens when you launch Streambert.
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <SettingsSelect
          value={startPage}
          onChange={(v) => setStartPage(v)}
          options={[
            { value: "home", label: "🏠  Home" },
            { value: "history", label: "🕐  Library / History" },
            { value: "downloads", label: "⬇  Downloads" },
          ]}
        />
        <button className="btn btn-primary" onClick={handleSave}>
          Save
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: "#48c774" }}>✓ Saved</span>
        )}
      </div>
    </div>
  );
}

// ── TMDB Metadata Language ────────────────────────────────────────────────────
const TMDB_LANGUAGES = [
  { value: "en-US", label: "English (en-US)" },
  { value: "de-DE", label: "Deutsch (de-DE)" },
  { value: "fr-FR", label: "Français (fr-FR)" },
  { value: "es-ES", label: "Español (es-ES)" },
  { value: "it-IT", label: "Italiano (it-IT)" },
  { value: "pt-BR", label: "Português (Brasil) (pt-BR)" },
  { value: "nl-NL", label: "Nederlands (nl-NL)" },
  { value: "pl-PL", label: "Polski (pl-PL)" },
  { value: "sv-SE", label: "Svenska (sv-SE)" },
  { value: "nb-NO", label: "Norsk (nb-NO)" },
  { value: "da-DK", label: "Dansk (da-DK)" },
  { value: "fi-FI", label: "Suomi (fi-FI)" },
  { value: "tr-TR", label: "Türkçe (tr-TR)" },
  { value: "ru-RU", label: "Русский (ru-RU)" },
  { value: "ja-JP", label: "日本語 (ja-JP)" },
  { value: "ko-KR", label: "한국어 (ko-KR)" },
  { value: "zh-CN", label: "中文 (简体) (zh-CN)" },
  { value: "ar-SA", label: "العربية (ar-SA)" },
];

function TmdbLanguageSection() {
  const [lang, setLang] = useState(
    () => storage.get(STORAGE_KEYS.TMDB_LANG) || "en-US",
  );
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    storage.set(STORAGE_KEYS.TMDB_LANG, lang);
    // Clear in-memory cache
    clearTmdbCache();
    // Notify App.jsx to re-fetch trending data immediately.
    window.dispatchEvent(new CustomEvent("streambert:tmdb-lang-changed"));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">Metadata Language</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        Language used when fetching titles, descriptions, and other metadata
        from TMDB. Changing this clears the metadata cache so updated content
        loads immediately.
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <SettingsSelect
          value={lang}
          onChange={(v) => setLang(v)}
          options={TMDB_LANGUAGES}
        />
        <button className="btn btn-primary" onClick={handleSave}>
          Save
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: "#48c774" }}>
            ✓ Saved, cache cleared
          </span>
        )}
      </div>
    </div>
  );
}

// ── Subtitle Settings ─────────────────────────────────────────────────────────
function SubtitleSettingsSection() {
  const [enabled, setEnabled] = useState(
    () =>
      storage.get(STORAGE_KEYS.SUBTITLE_ENABLED) !== 0 &&
      storage.get(STORAGE_KEYS.SUBTITLE_ENABLED) !== "0",
  );
  const [lang, setLang] = useState(
    () => storage.get(STORAGE_KEYS.SUBTITLE_LANG) || "en",
  );
  const [subdlApiKey, setSubdlApiKey] = useState("");
  const [showSubdlKey, setShowSubdlKey] = useState(false);
  const [wyzieApiKey, setWyzieApiKey] = useState("");
  const [showWyzieKey, setShowWyzieKey] = useState(false);
  const [wyzieCopied, setWyzieCopied] = useState(false);
  const [wyzieClearConfirm, setWyzieClearConfirm] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load keys from secure storage
  useEffect(() => {
    secureStorage.get(STORAGE_KEYS.SUBDL_API_KEY).then((val) => {
      if (val) setSubdlApiKey(val);
    });
    secureStorage.get(STORAGE_KEYS.WYZIE_API_KEY).then((val) => {
      if (val) setWyzieApiKey(val);
    });
  }, []);

  const hasSubdlKey = subdlApiKey.trim().length > 0;
  const hasWyzieKey = wyzieApiKey.trim().length > 0;

  const handleWyzieCopy = () => {
    navigator.clipboard.writeText(wyzieApiKey.trim()).then(() => {
      setWyzieCopied(true);
      setTimeout(() => setWyzieCopied(false), 1500);
    });
  };

  const handleSave = () => {
    storage.set(STORAGE_KEYS.SUBTITLE_ENABLED, enabled ? 1 : 0);
    storage.set(STORAGE_KEYS.SUBTITLE_LANG, lang);
    secureStorage.set(STORAGE_KEYS.SUBDL_API_KEY, subdlApiKey.trim());
    secureStorage.set(STORAGE_KEYS.WYZIE_API_KEY, wyzieApiKey.trim());
    // refresh playerSettings prop (subtitle lang)
    window.dispatchEvent(new CustomEvent("streambert:player-settings-changed"));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">Subtitle Downloads</div>

      {/* Source info */}
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 20,
          lineHeight: 1.7,
        }}
      >
        <span style={{ color: "var(--text)", fontWeight: 600 }}>
          Wyzie Subs
        </span>{" "}
        is used by default and requires a free API key (no account needed).
        Optionally add a{" "}
        <span
          style={{
            color: "var(--red)",
            cursor: "pointer",
            textDecoration: "underline",
          }}
          onClick={() =>
            window.electron?.openExternal("https://subdl.com/settings")
          }
        >
          SubDL API key
        </span>{" "}
        (free), to use SubDL as the primary source instead.
        {hasSubdlKey && (
          <span
            style={{
              display: "inline-block",
              marginLeft: 8,
              fontSize: 11,
              fontWeight: 700,
              padding: "1px 7px",
              borderRadius: 3,
              background: "rgba(99,149,255,0.15)",
              color: "#6395ff",
              border: "1px solid rgba(99,149,255,0.3)",
            }}
          >
            SubDL ACTIVE
          </span>
        )}
      </div>

      {/* Enable toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <Toggle value={enabled} onChange={setEnabled} />
        <span
          style={{
            fontSize: 14,
            color: enabled ? "var(--text)" : "var(--text3)",
          }}
        >
          {enabled
            ? "Auto-download subtitles when downloading videos"
            : "Subtitle download disabled"}
        </span>
      </div>

      {enabled && (
        <>
          {/* Default language */}
          <div style={{ marginBottom: 16 }}>
            <div
              style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}
            >
              Default language
            </div>
            <SettingsSelect
              value={lang}
              onChange={(v) => setLang(v)}
              options={SUBTITLE_LANGUAGES.map((l) => ({
                value: l.code,
                label: l.label,
              }))}
            />
          </div>

          {/* Wyzie API key */}
          <div style={{ marginBottom: 20 }}>
            <div
              style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}
            >
              Wyzie API key{" "}
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: hasWyzieKey
                    ? "rgba(99,202,183,0.12)"
                    : "rgba(255,180,80,0.12)",
                  color: hasWyzieKey ? "#63cab7" : "#ffb450",
                  border: `1px solid ${hasWyzieKey ? "rgba(99,202,183,0.25)" : "rgba(255,180,80,0.25)"}`,
                }}
              >
                {hasWyzieKey ? "SET" : "REQUIRED"}
              </span>
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text3)",
                marginBottom: 8,
                lineHeight: 1.5,
              }}
            >
              Required for Wyzie Subs. Get a free key by following the tutorial.{" "}
              <button
                className="btn btn-ghost"
                style={{
                  display: "inline",
                  padding: 0,
                  fontSize: 12,
                  color: "var(--red)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
                onClick={() =>
                  window.electron?.openExternal(
                    "https://codeberg.org/truelockmc/streambert/src/branch/main/wyzie-tutorial.md",
                  )
                }
              >
                How to get a key ↗
              </button>
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <input
                className="apikey-input"
                style={{ flex: 1, maxWidth: 340, marginBottom: 0 }}
                type={showWyzieKey ? "text" : "password"}
                placeholder="wyzie-..."
                value={wyzieApiKey}
                onChange={(e) => setWyzieApiKey(e.target.value)}
              />
              <button
                className="btn btn-ghost"
                style={{ padding: "6px 12px", fontSize: 12 }}
                onClick={() => setShowWyzieKey((v) => !v)}
              >
                {showWyzieKey ? "Hide" : "Show"}
              </button>
              {hasWyzieKey && (
                <button
                  className="btn btn-ghost"
                  style={{ padding: "6px 12px", fontSize: 12 }}
                  onClick={handleWyzieCopy}
                  title="Copy key"
                >
                  {wyzieCopied ? "Copied!" : "Copy"}
                </button>
              )}
              {hasWyzieKey && (
                <button
                  className="btn btn-ghost"
                  style={{ padding: "6px 12px", fontSize: 12 }}
                  onClick={() =>
                    window.electron?.openExternal(
                      `https://store.wyzie.io/dashboard?key=${wyzieApiKey.trim()}`,
                    )
                  }
                  title="Open your wyzie dashboard"
                >
                  Dashboard ↗
                </button>
              )}
            </div>
          </div>

          {/* SubDL API key */}
          <div style={{ marginBottom: 8 }}>
            <div
              style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}
            >
              SubDL API key{" "}
              <span
                style={{
                  color: "var(--text3)",
                  cursor: "pointer",
                  fontSize: 11,
                }}
                onClick={() =>
                  window.electron?.openExternal("https://subdl.com/settings")
                }
              >
                (free, register at subdl.com ↗)
              </span>
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: "rgba(99,202,183,0.12)",
                  color: "#63cab7",
                  border: "1px solid rgba(99,202,183,0.25)",
                }}
              >
                OPTIONAL
              </span>
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text3)",
                marginBottom: 8,
                lineHeight: 1.5,
              }}
            >
              Leave empty to use{" "}
              <strong style={{ color: "var(--text)" }}>Wyzie Subs</strong>{" "}
              (default, requires Wyzie API key above). Add a SubDL key to switch
              to SubDL as the primary source.
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                className="apikey-input"
                style={{ flex: 1, maxWidth: 400, marginBottom: 0 }}
                type={showSubdlKey ? "text" : "password"}
                placeholder="SubDL API key, leave empty to use Wyzie"
                value={subdlApiKey}
                onChange={(e) => setSubdlApiKey(e.target.value)}
              />
              <button
                className="btn btn-ghost"
                style={{ padding: "6px 12px", fontSize: 12 }}
                onClick={() => setShowSubdlKey((v) => !v)}
              >
                {showSubdlKey ? "Hide" : "Show"}
              </button>
              {subdlApiKey.trim() && (
                <button
                  className="btn btn-ghost"
                  style={{
                    padding: "6px 12px",
                    fontSize: 12,
                    color: "var(--text3)",
                  }}
                  onClick={() => setSubdlApiKey("")}
                  title="Clear key (revert to Wyzie)"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </>
      )}

      <div
        style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}
      >
        <button className="btn btn-primary" onClick={handleSave}>
          Save
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: "#4caf50" }}>✓ Saved</span>
        )}
      </div>
    </div>
  );
}

// ── Notifications Section ─────────────────────────────────────────────────────
function NotificationsSection() {
  const [notifyDownload, setNotifyDownload] = useState(
    () => storage.get(STORAGE_KEYS.NOTIFY_DOWNLOAD_COMPLETE) !== false,
  );
  const [notifyEpisode, setNotifyEpisode] = useState(() => {
    const stored = storage.get(STORAGE_KEYS.NOTIFY_NEW_EPISODE);
    return stored === null || stored === undefined ? true : !!stored;
  });
  const [saved, setSaved] = useState(false);

  const saveSettings = () => {
    storage.set(STORAGE_KEYS.NOTIFY_DOWNLOAD_COMPLETE, notifyDownload);
    storage.set(STORAGE_KEYS.NOTIFY_NEW_EPISODE, notifyEpisode);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const ToggleRow = ({ label, description, value, onChange }) => (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        padding: "16px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <Toggle value={value} onChange={onChange} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>
          {label}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--text3)",
            marginTop: 3,
            lineHeight: 1.5,
          }}
        >
          {description}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">Desktop Notifications</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        Control which events trigger a desktop notification.
      </div>

      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "0 16px",
          marginBottom: 20,
        }}
      >
        <ToggleRow
          label="Notify when a download completes"
          description="Shows a desktop notification when an item finishes downloading."
          value={notifyDownload}
          onChange={setNotifyDownload}
        />
        <ToggleRow
          label="Notify about new episodes on startup"
          description="On startup, checks every TV series you have saved for newly released episodes and notifies you if any aired since the last check."
          value={notifyEpisode}
          onChange={setNotifyEpisode}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-primary" onClick={saveSettings}>
          Save
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: "#48c774" }}>✓ Saved</span>
        )}
      </div>
    </div>
  );
}

// ── Section Group Header ──────────────────────────────────────────────────────
function DiscordRpcSection() {
  const [enabled, setEnabledState] = useState(
    () => !!storage.get(STORAGE_KEYS.DISCORD_RPC_ENABLED),
  );
  const [showCover, setShowCover] = useState(
    () => storage.get(STORAGE_KEYS.DISCORD_RPC_SHOW_COVER) !== false,
  );
  const [showTimestamp, setShowTimestamp] = useState(
    () => storage.get(STORAGE_KEYS.DISCORD_RPC_SHOW_TIMESTAMP) !== false,
  );
  const [showButton, setShowButton] = useState(
    () => storage.get(STORAGE_KEYS.DISCORD_RPC_SHOW_BUTTON) !== false,
  );
  const [saved, setSaved] = useState(false);

  const saveSettings = () => {
    storage.set(STORAGE_KEYS.DISCORD_RPC_ENABLED, enabled);
    storage.set(STORAGE_KEYS.DISCORD_RPC_SHOW_COVER, showCover);
    storage.set(STORAGE_KEYS.DISCORD_RPC_SHOW_TIMESTAMP, showTimestamp);
    storage.set(STORAGE_KEYS.DISCORD_RPC_SHOW_BUTTON, showButton);
    window.dispatchEvent(
      new CustomEvent("streambert:discord-rpc-settings-changed"),
    );
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const ToggleRow = ({ label, description, value, onChange, disabled }) => (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        padding: "16px 0",
        borderBottom: "1px solid var(--border)",
        opacity: disabled ? 0.45 : 1,
        pointerEvents: disabled ? "none" : "auto",
      }}
    >
      <Toggle value={value} onChange={onChange} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>
          {label}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--text3)",
            marginTop: 3,
            lineHeight: 1.5,
          }}
        >
          {description}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">Discord Rich Presence</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        Shows what you're currently watching on your Discord profile (title +
        cover, or "Idling" when nothing is open). Off by default. Requires
        the Discord desktop client to be running.
      </div>

      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "0 16px",
          marginBottom: 20,
        }}
      >
        <ToggleRow
          label="Enable Discord Rich Presence"
          description="Connects to your local Discord client and updates your status automatically."
          value={enabled}
          onChange={setEnabledState}
        />
        <ToggleRow
          label="Show cover art"
          description="Uses the movie/show poster as the large image. When off, only the Streambert icon is shown."
          value={showCover}
          onChange={setShowCover}
          disabled={!enabled}
        />
        <ToggleRow
          label="Show elapsed time"
          description="Displays how long you've been on the current title's page."
          value={showTimestamp}
          onChange={setShowTimestamp}
          disabled={!enabled}
        />
        <ToggleRow
          label="Show GitHub button"
          description="Adds a button linking to the Streambert GitHub repository."
          value={showButton}
          onChange={setShowButton}
          disabled={!enabled}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-primary" onClick={saveSettings}>
          Save
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: "#48c774" }}>✓ Saved</span>
        )}
      </div>
    </div>
  );
}

// ── Stream Defaults Section ───────────────────────────────────────────────────
function StreamDefaultsSection() {
  const [source, setSource] = useState(
    () => storage.get(STORAGE_KEYS.PLAYER_SOURCE) || NON_ANIME_DEFAULT_SOURCE,
  );
  const [nativePref, setNativePref] = useState(
    () => storage.get("nativePlayer") === true,
  );
  const [dubMode, setDubMode] = useState(
    () => storage.get(STORAGE_KEYS.HIANIME_DUB_MODE) || "",
  );
  const [saved, setSaved] = useState(false);

  const flash = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const rowLabel = {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text2)",
    marginBottom: 8,
  };
  const rowDesc = {
    fontSize: 12,
    color: "var(--text3)",
    marginBottom: 10,
    lineHeight: 1.6,
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">Stream Defaults</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 20,
          lineHeight: 1.6,
        }}
      >
        Which streaming provider and playback mode to use when you press play.
        These are starting points — you can still switch per title from inside
        the player.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Default source */}
        <div>
          <div style={rowLabel}>Default Source</div>
          <div style={rowDesc}>
            Streaming provider used for new titles. Anime titles fall back to
            the HiAnime source automatically when the pick can't serve them.
          </div>
          <SettingsSelect
            value={source}
            onChange={(v) => {
              setSource(v);
              storage.set(STORAGE_KEYS.PLAYER_SOURCE, v);
              flash();
            }}
            options={PLAYER_SOURCES.map((s) => ({
              value: s.id,
              label: s.label + (s.movieOnly ? " (movies only)" : ""),
            }))}
          />
        </div>

        {/* Anime dub mode */}
        <div>
          <div style={rowLabel}>Anime Audio Default</div>
          <div style={rowDesc}>
            Prefer subtitled (Sub) or dubbed (Dub) audio for anime sources.
            "Auto" uses whichever you picked last inside the player.
          </div>
          <SettingsSelect
            value={dubMode}
            onChange={(v) => {
              setDubMode(v);
              if (v === "") storage.remove(STORAGE_KEYS.HIANIME_DUB_MODE);
              else storage.set(STORAGE_KEYS.HIANIME_DUB_MODE, v);
              flash();
            }}
            options={[
              { value: "", label: "Auto (remember last)" },
              { value: "sub", label: "Sub" },
              { value: "dub", label: "Dub" },
            ]}
          />
        </div>

        {/* Native player preference */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Toggle
            value={nativePref}
            onChange={(v) => {
              setNativePref(v);
              storage.set("nativePlayer", v);
              flash();
            }}
            title="Prefer the built-in native player"
          />
          <div>
            <div
              style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}
            >
              Prefer native player
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
              Start playback in Streambert's built-in player instead of the
              embedded site webview whenever a direct stream URL can be
              captured. Can still be toggled per title inside the player.
            </div>
          </div>
        </div>
      </div>

      {saved && (
        <div style={{ marginTop: 12, fontSize: 13, color: "#48c774" }}>
          ✓ Saved
        </div>
      )}
    </div>
  );
}

// ── Player Defaults Section ───────────────────────────────────────────────────
function PlayerDefaultsSection() {
  const [rate, setRate] = useState(() => storage.get("playerDefRate") ?? "");
  const [vol, setVol] = useState(() => storage.get("playerDefVol") ?? "");
  const [muted, setMuted] = useState(() => storage.get("playerDefMuted") ?? "");
  const [autoFs, setAutoFs] = useState(() =>
    storage.get("playerAutoFs") !== false ? "true" : "false",
  );
  const [cueSize, setCueSize] = useState(
    () => storage.get("playerDefCueSize") ?? "",
  );
  const [subOff, setSubOff] = useState(
    () => storage.get("playerDefSubOff") ?? "",
  );
  const [speeds, setSpeeds] = useState(
    () => storage.get("playerSpeeds") ?? "",
  );
  const [prebuffer, setPrebuffer] = useState(
    () => storage.get("playerDefPrebuffer") ?? "",
  );
  const [enhBright, setEnhBright] = useState(
    () => storage.get("playerEnhBrightness") ?? "",
  );
  const [enhContrast, setEnhContrast] = useState(
    () => storage.get("playerEnhContrast") ?? "",
  );
  const [enhSaturate, setEnhSaturate] = useState(
    () => storage.get("playerEnhSaturation") ?? "",
  );
  const [enhSharpen, setEnhSharpen] = useState(
    () => storage.get("playerEnhSharpen") === true,
  );
  // Enhancement selects write "" for Normal (key removed); everything pushes
  // straight to the main process so embeds update live too.
  const setEnh = (key, setter) => (v) => {
    setter(v);
    if (v === "") storage.remove(key);
    else if (v === true || v === false) storage.set(key, v);
    else storage.set(key, Number(v));
    pushVideoEnhance();
    flash();
  };
  const [saved, setSaved] = useState(false);

  const flash = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // "" removes the key entirely → "Auto" (remember last in-player value)
  const setOrClear = (key, setter) => (v) => {
    setter(v);
    if (v === "") storage.remove(key);
    else storage.set(key, Number(v));
    flash();
  };

  const commitSubOff = () => {
    const n = parseFloat(subOff);
    if (subOff === "" || Number.isNaN(n)) {
      setSubOff("");
      storage.remove("playerDefSubOff");
    } else {
      const c = Math.max(-10, Math.min(10, n));
      setSubOff(c);
      storage.set("playerDefSubOff", c);
    }
    flash();
  };

  const commitSpeeds = () => {
    const list = parseSpeedList(speeds);
    if (!list.length) {
      setSpeeds("");
      storage.remove("playerSpeeds");
    } else {
      setSpeeds(list.join(", "));
      storage.set("playerSpeeds", list.join(", "));
    }
    flash();
  };

  const rowLabel = {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text2)",
    marginBottom: 8,
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">Player defaults</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 20,
          lineHeight: 1.6,
        }}
      >
        Applied to every new stream — in-player changes only stick when no
        default is set here. Pick "Auto" to clear an override and fall back to
        whatever was last used inside the player.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Playback speed */}
        <div>
          <div style={rowLabel}>Default playback speed</div>
          <SettingsSelect
            value={rate}
            onChange={setOrClear("playerDefRate", setRate)}
            options={[
              { value: "", label: "Auto (remember last)" },
              { value: 0.5, label: "0.5×" },
              { value: 0.75, label: "0.75×" },
              { value: 1, label: "1× (normal)" },
              { value: 1.25, label: "1.25×" },
              { value: 1.5, label: "1.5×" },
              { value: 2, label: "2×" },
              { value: 2.5, label: "2.5×" },
              { value: 3, label: "3×" },
            ]}
          />
        </div>

        {/* Volume */}
        <div>
          <div style={rowLabel}>Default volume</div>
          <SettingsSelect
            value={vol}
            onChange={setOrClear("playerDefVol", setVol)}
            options={[
              { value: "", label: "Auto (remember last)" },
              ...[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((p) => ({
                value: p / 100,
                label: `${p}%`,
              })),
            ]}
          />
        </div>

        {/* Start muted */}
        <div>
          <div style={rowLabel}>Start muted</div>
          <SettingsSelect
            value={muted}
            onChange={(v) => {
              setMuted(v);
              if (v === "") storage.remove("playerDefMuted");
              else storage.set("playerDefMuted", v === "true");
              flash();
            }}
            options={[
              { value: "", label: "Auto (remember last)" },
              { value: "true", label: "Muted" },
              { value: "false", label: "Unmuted" },
            ]}
          />
        </div>

        {/* Auto-fullscreen */}
        <div>
          <div style={rowLabel}>Auto-fullscreen on play</div>
          <SettingsSelect
            value={autoFs}
            onChange={(v) => {
              setAutoFs(v);
              storage.set("playerAutoFs", v === "true");
              flash();
            }}
            options={[
              { value: "true", label: "On" },
              { value: "false", label: "Off" },
            ]}
          />
        </div>

        {/* Caption size */}
        <div>
          <div style={rowLabel}>Caption size</div>
          <SettingsSelect
            value={cueSize}
            onChange={setOrClear("playerDefCueSize", setCueSize)}
            options={[
              { value: "", label: "Auto (remember last)" },
              { value: 0.85, label: "Small" },
              { value: 1.15, label: "Medium" },
              { value: 1.6, label: "Large" },
            ]}
          />
        </div>

        {/* Subtitle sync offset */}
        <div>
          <div style={rowLabel}>Subtitle sync offset</div>
          <div
            style={{
              fontSize: 12,
              color: "var(--text3)",
              marginBottom: 10,
              lineHeight: 1.6,
            }}
          >
            Shift all subtitles forward (+) or backward (−), in seconds.
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <input
              type="number"
              min={-10}
              max={10}
              step={0.5}
              className="apikey-input"
              style={{ width: 90, marginBottom: 0 }}
              placeholder="Auto"
              value={subOff}
              onChange={(e) => setSubOff(e.target.value)}
              onBlur={commitSubOff}
            />
            <span style={{ fontSize: 14, color: "var(--text2)" }}>
              seconds
            </span>
            {subOff !== "" && (
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12 }}
                onClick={() => {
                  setSubOff("");
                  storage.remove("playerDefSubOff");
                  flash();
                }}
              >
                Reset to Auto
              </button>
            )}
          </div>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-label">Speed presets</div>
            <div className="settings-desc">
              Buttons shown in the player's speed menu — comma-separated,
              0.25–4×. Empty keeps the defaults (0.75 / 1 / 1.25 / 1.5 / 2).
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <input
              type="text"
              className="apikey-input"
              style={{ width: 200, marginBottom: 0 }}
              placeholder="0.75, 1, 1.25, 1.5, 2"
              value={speeds}
              onChange={(e) => setSpeeds(e.target.value)}
              onBlur={commitSpeeds}
            />
            {speeds !== "" && (
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12 }}
                onClick={() => {
                  setSpeeds("");
                  storage.remove("playerSpeeds");
                  flash();
                }}
              >
                Reset
              </button>
            )}
          </div>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-label">Buffer ahead before playing</div>
            <div className="settings-desc">
              The app's own player waits until this much video is buffered
              before it starts — good for connections that stall mid-watch.
              It never waits longer than 30s, and keeps buffering well past
              the target while playing. Only affects the native player, not
              embedded sites.
            </div>
          </div>
          <SettingsSelect
            value={prebuffer}
            onChange={setOrClear("playerDefPrebuffer", setPrebuffer)}
            options={[
              { value: "", label: "Off (start immediately)" },
              { value: 10, label: "10 seconds" },
              { value: 20, label: "20 seconds" },
              { value: 30, label: "30 seconds" },
              { value: 45, label: "45 seconds" },
              { value: 60, label: "60 seconds" },
              { value: 90, label: "90 seconds" },
            ]}
          />
        </div>

        {/* Video enhancement — GPU filters applied to the video itself:
            the app's player AND embedded site players. Applies live. */}
        <div className="settings-row">
          <div>
            <div className="settings-label">Video enhancement</div>
            <div className="settings-desc">
              Brighten a dark picture and sharpen soft streams — applied to
              the video image itself in both the app's player and embedded
              site players. Changes apply live.
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <SettingsSelect
              value={enhBright}
              onChange={setEnh("playerEnhBrightness", setEnhBright)}
              options={[
                { value: "", label: "Brightness: Normal" },
                { value: 1.1, label: "Brightness: +10%" },
                { value: 1.2, label: "Brightness: +20%" },
                { value: 1.3, label: "Brightness: +30%" },
                { value: 1.45, label: "Brightness: +45%" },
                { value: 0.9, label: "Brightness: −10%" },
              ]}
            />
            <SettingsSelect
              value={enhContrast}
              onChange={setEnh("playerEnhContrast", setEnhContrast)}
              options={[
                { value: "", label: "Contrast: Normal" },
                { value: 1.05, label: "Contrast: +5%" },
                { value: 1.1, label: "Contrast: +10%" },
                { value: 1.2, label: "Contrast: +20%" },
              ]}
            />
            <SettingsSelect
              value={enhSaturate}
              onChange={setEnh("playerEnhSaturation", setEnhSaturate)}
              options={[
                { value: "", label: "Colour: Normal" },
                { value: 1.1, label: "Colour: +10%" },
                { value: 1.25, label: "Colour: +25%" },
                { value: 1.5, label: "Colour: +50%" },
              ]}
            />
            <SettingsSelect
              value={enhSharpen}
              onChange={setEnh("playerEnhSharpen", setEnhSharpen)}
              options={[
                { value: false, label: "Sharpen: Off" },
                { value: true, label: "Sharpen: On" },
              ]}
            />
          </div>
        </div>
      </div>

      {saved && (
        <div style={{ marginTop: 12, fontSize: 13, color: "#48c774" }}>
          ✓ Saved
        </div>
      )}
    </div>
  );
}

// ── Widevine CDM ───────────────────────────────────────────────────────────
// Lets subscription services (Services page: Netflix, Paramount+, Crave…)
// play DRM video. Downloads the official CDM from Google's CDN into
// userData/widevine (+ a beside-binary mirror) and registers
// --widevine-cdm-path on next launch.
function WidevineSection() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = () =>
    window.electron
      ?.getWidevineStatus?.()
      .then(setStatus)
      .catch(() => {});
  useEffect(() => {
    refresh();
  }, []);

  const install = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await window.electron?.installWidevine?.();
      if (r?.ok) refresh();
      else setError(r?.error || "Install failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await window.electron?.removeWidevine?.();
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const rowLabel = {
    fontSize: 13,
    color: "var(--text2)",
    display: "block",
    marginBottom: 6,
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">Widevine CDM</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        DRM services on the Services page (Netflix, Paramount+, Crave, Disney+…)
        need Google's Widevine Content Decryption Module. Electron can't ship
        it, so Streambert downloads the official CDM component on demand
        (~22 MB, hash-verified) — the same one Chromium fetches. Playback is
        L3 (standard quality); services that demand VMP signing may refuse.
      </div>
      <label style={rowLabel}>Status</label>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 13 }}>
          {!status
            ? "…"
            : status.installed
              ? status.loadedAtLaunch
                ? `✓ Active — Widevine ${status.version || ""}`
                : `✓ Installed (v${status.version || "?"}) — restart to activate`
              : "Not installed"}
        </span>
        {status?.installed && !status.loadedAtLaunch && (
          <button
            className="btn btn-primary"
            style={{ fontSize: 12 }}
            onClick={() => window.electron?.restartApp?.()}
          >
            Restart now
          </button>
        )}
        {!status?.installed && (
          <button
            className="btn btn-primary"
            style={{ fontSize: 12 }}
            disabled={busy}
            onClick={install}
          >
            {busy ? "Downloading…" : "Install Widevine CDM"}
          </button>
        )}
        {status?.installed && (
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12 }}
            disabled={busy}
            onClick={remove}
          >
            Remove
          </button>
        )}
      </div>
      {error && (
        <div style={{ fontSize: 12, color: "#ff5d5d" }}>{error}</div>
      )}
    </div>
  );
}

// ── Adult Section (18+) Defaults ─────────────────────────────────────────────
// Option ids mirror the ORDERS / DURS / RATINGS / grid-size lists in
// AdultPage.jsx so defaults picked here line up exactly with its filters.
const ADULT_MODE_OPTIONS = [
  { value: "home", label: "Home (rows)" },
  { value: "browse", label: "Browse (video catalog)" },
  { value: "channels", label: "Channels" },
  { value: "sites", label: "Sites" },
  { value: "images", label: "Images" },
  { value: "creators", label: "Creators" },
];
const ADULT_ORDER_OPTIONS = [
  { value: "top-weekly", label: "Top weekly" },
  { value: "top-monthly", label: "Top monthly" },
  { value: "top-rated", label: "Top rated" },
  { value: "most-voted", label: "Most voted" },
  { value: "popular", label: "Most viewed" },
  { value: "latest", label: "Newest" },
  { value: "longest", label: "Longest" },
];
const ADULT_DUR_OPTIONS = [
  { value: "", label: "Any length" },
  { value: "short", label: "< 5 min" },
  { value: "mid", label: "5–15 min" },
  { value: "long", label: "15–30 min" },
  { value: "xlong", label: "30+ min" },
];
const ADULT_RATE_OPTIONS = [
  { value: "", label: "Any rating" },
  { value: "3.5", label: "70%+ rated" },
  { value: "4", label: "80%+ rated" },
  { value: "4.25", label: "85%+ rated" },
  { value: "4.5", label: "90%+ rated" },
  { value: "4.75", label: "95%+ rated" },
];
const ADULT_GRID_OPTIONS = [
  { value: "s", label: "S — small cards" },
  { value: "m", label: "M — medium cards" },
  { value: "l", label: "L — large cards" },
];

function AdultDefaultsSection() {
  const [mode, setMode] = useState(() => storage.get("adultMode") || "browse");
  const [searchAll, setSearchAll] = useState(
    () => storage.get("adultSearchAll") === true,
  );
  const [order, setOrder] = useState(
    () => storage.get("adultOrder") || "top-weekly",
  );
  const [dur, setDur] = useState(() => storage.get("adultDur") || "");
  const [minRate, setMinRate] = useState(() => storage.get("adultRate") || "");
  const [gridSize, setGridSize] = useState(
    () => storage.get("adultGridSize") || "m",
  );
  const [gay, setGay] = useState(() => storage.get("adultGay") === true);
  const [hideSeen, setHideSeen] = useState(
    () => storage.get("adultHideSeen") === true,
  );
  const [gateReset, setGateReset] = useState(false);
  const [saved, setSaved] = useState(false);

  const flash = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const rowLabel = {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text2)",
    marginBottom: 8,
  };
  const rowDesc = {
    fontSize: 12,
    color: "var(--text3)",
    marginBottom: 10,
    lineHeight: 1.6,
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">18+ Section Defaults</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 20,
          lineHeight: 1.6,
        }}
      >
        Defaults for the 18+ section — applied every time it opens. The age
        confirmation gate (and PIN, if one is set under Privacy &amp; Network)
        still applies.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Default tab */}
        <div>
          <div style={rowLabel}>Default tab</div>
          <div style={rowDesc}>
            Which view the 18+ section opens on.
          </div>
          <SettingsSelect
            value={mode}
            onChange={(v) => {
              setMode(v);
              storage.set("adultMode", v);
              flash();
            }}
            options={ADULT_MODE_OPTIONS}
          />
        </div>

        {/* Multi-site search on open */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Toggle
            value={searchAll}
            onChange={(v) => {
              setSearchAll(v);
              storage.set("adultSearchAll", v);
              flash();
            }}
            title="Search every site at once when the 18+ section opens"
          />
          <div>
            <div
              style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}
            >
              Multi-site search on open
            </div>
            <div
              style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}
            >
              Opens the merged "🌐 All" view — searching every site at once —
              instead of the single-site browse catalog. Only applies to the
              Browse tab.
            </div>
          </div>
        </div>

        {/* Default sort */}
        <div>
          <div style={rowLabel}>Default sort</div>
          <div style={rowDesc}>
            Sort order applied to browse and multi-site results.
          </div>
          <SettingsSelect
            value={order}
            onChange={(v) => {
              setOrder(v);
              storage.set("adultOrder", v);
              flash();
            }}
            options={ADULT_ORDER_OPTIONS}
          />
        </div>

        {/* Length filter */}
        <div>
          <div style={rowLabel}>Default length filter</div>
          <div style={rowDesc}>
            Filter out videos shorter or longer than this on open.
          </div>
          <SettingsSelect
            value={dur}
            onChange={(v) => {
              setDur(v);
              storage.set("adultDur", v);
              flash();
            }}
            options={ADULT_DUR_OPTIONS}
          />
        </div>

        {/* Minimum rating */}
        <div>
          <div style={rowLabel}>Minimum rating</div>
          <div style={rowDesc}>
            Hide videos rated below this threshold on open.
          </div>
          <SettingsSelect
            value={minRate}
            onChange={(v) => {
              setMinRate(v);
              storage.set("adultRate", v);
              flash();
            }}
            options={ADULT_RATE_OPTIONS}
          />
        </div>

        {/* Grid density */}
        <div>
          <div style={rowLabel}>Grid density</div>
          <div style={rowDesc}>
            Card size used by the browse grid.
          </div>
          <SettingsSelect
            value={gridSize}
            onChange={(v) => {
              setGridSize(v);
              storage.set("adultGridSize", v);
              flash();
            }}
            options={ADULT_GRID_OPTIONS}
          />
        </div>

        {/* Gay content */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Toggle
            value={gay}
            onChange={(v) => {
              setGay(v);
              storage.set("adultGay", v);
              flash();
            }}
            title="Include gay content"
          />
          <div>
            <div
              style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}
            >
              Gay content
            </div>
            <div
              style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}
            >
              Include gay content in browse and multi-site results.
            </div>
          </div>
        </div>

        {/* Hide seen */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Toggle
            value={hideSeen}
            onChange={(v) => {
              setHideSeen(v);
              storage.set("adultHideSeen", v);
              flash();
            }}
            title="Hide already-watched videos"
          />
          <div>
            <div
              style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}
            >
              Hide already watched
            </div>
            <div
              style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}
            >
              Filter out videos that appear in your recents list.
            </div>
          </div>
        </div>

        {/* Reset confirmation gate */}
        <div>
          <div style={rowLabel}>18+ confirmation gate</div>
          <div style={rowDesc}>
            The "are you 18?" confirmation (and PIN prompt, if a PIN is set)
            was previously dismissed for this install. Resetting brings it
            back — it will be shown again the next time you open the 18+
            section.
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <button
              className="btn btn-ghost"
              onClick={() => {
                storage.remove("adultConfirmed");
                sessionStorage.removeItem("adultUnlocked");
                setGateReset(true);
                setTimeout(() => setGateReset(false), 3000);
              }}
            >
              Reset 18+ confirmation
            </button>
            {gateReset && (
              <span style={{ fontSize: 13, color: "#48c774" }}>
                ✓ Reset — the gate will reappear on your next visit
              </span>
            )}
          </div>
        </div>
      </div>

      {saved && (
        <div style={{ marginTop: 12, fontSize: 13, color: "#48c774" }}>
          ✓ Saved
        </div>
      )}
    </div>
  );
}

// ── Section Group Header ─────────────────────────────────────────────────────
function SectionGroupHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 32, marginTop: 4 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: subtitle ? 6 : 0,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 16,
            letterSpacing: 2,
            color: "var(--red)",
            textTransform: "uppercase",
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
        <div
          style={{ flex: 1, height: 1, background: "rgba(229,9,20,0.18)" }}
        />
      </div>
      {subtitle && (
        <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.5 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

// ── Section divider ───────────────────────────────────────────────────────────
function Divider() {
  return (
    <div style={{ height: 1, background: "var(--border)", marginBottom: 40 }} />
  );
}

// ── Search & Nav Bar ──────────────────────────────────────────────────────────
const SUPPORTS_HIGHLIGHT =
  typeof CSS !== "undefined" && typeof CSS.highlights !== "undefined";
function NetworkSection() {
  const [cfg, setCfg] = useState(null);
  const [saved, setSaved] = useState(false);
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [blockStats, setBlockStats] = useState(null);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [adultPin, setAdultPin] = useState("");
  const [hasPin, setHasPin] = useState(() => !!storage.get("adultPinHash"));
  const [appPin, setAppPin] = useState("");
  const [hasAppPin, setHasAppPin] = useState(
    () => !!storage.get("appPinHash"),
  );

  useEffect(() => {
    window.electron?.getNetworkSettings?.().then(setCfg).catch(() => {});
    window.electron?.getBlockStats?.().then(setBlockStats).catch(() => {});
  }, []);

  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));

  const save = async () => {
    const r = await window.electron?.setNetworkSettings?.(cfg);
    setRestartNeeded(!!r?.restartRequired);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (!cfg) return null;

  const rowLabel = {
    fontSize: 13,
    color: "var(--text2)",
    display: "block",
    marginBottom: 6,
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">Proxy</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        Route all of Streambert's traffic (player webviews included) through a
        SOCKS5 or HTTP proxy — e.g. your VPN's SOCKS5 endpoint. A system-wide
        VPN already covers the app; this is for per-app routing.
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <select
          className="apikey-input"
          style={{ width: 150, marginBottom: 0 }}
          value={cfg.proxyMode}
          onChange={(e) => set("proxyMode", e.target.value)}
        >
          <option value="off">Off</option>
          <option value="socks5">SOCKS5</option>
          <option value="http">HTTP</option>
        </select>
        <input
          className="apikey-input"
          style={{ flex: 1, minWidth: 140, marginBottom: 0 }}
          placeholder="host (e.g. 127.0.0.1)"
          disabled={cfg.proxyMode === "off"}
          value={cfg.proxyHost}
          onChange={(e) => set("proxyHost", e.target.value)}
        />
        <input
          className="apikey-input"
          style={{ width: 90, marginBottom: 0 }}
          placeholder="port"
          disabled={cfg.proxyMode === "off"}
          value={cfg.proxyPort}
          onChange={(e) => set("proxyPort", e.target.value)}
        />
      </div>
      <div style={{ marginBottom: 24 }}>
        <label style={rowLabel}>
          Bypass list (optional, comma-separated hosts that skip the proxy)
        </label>
        <input
          className="apikey-input"
          style={{ flex: 1, minWidth: 260, marginBottom: 0, width: "100%" }}
          placeholder="localhost, *.internal.lan"
          disabled={cfg.proxyMode === "off"}
          value={cfg.proxyBypass}
          onChange={(e) => set("proxyBypass", e.target.value)}
        />
      </div>

      <div className="settings-section-title">Adult section proxy</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        Route the 18+ site tabs through a different route than the rest of the
        app — e.g. Tor's SOCKS5 at 127.0.0.1:9050 while streams stay on your
        normal connection. Each adult site already gets its own isolated
        session; this controls what network those sessions use.
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <select
          className="apikey-input"
          style={{ width: 170, marginBottom: 0 }}
          value={cfg.adultProxyMode}
          onChange={(e) => set("adultProxyMode", e.target.value)}
        >
          <option value="main">Same as app</option>
          <option value="off">Direct (no proxy)</option>
          <option value="socks5">SOCKS5</option>
          <option value="http">HTTP</option>
        </select>
        <input
          className="apikey-input"
          style={{ flex: 1, minWidth: 140, marginBottom: 0 }}
          placeholder="host (e.g. 127.0.0.1)"
          disabled={
            cfg.adultProxyMode !== "socks5" && cfg.adultProxyMode !== "http"
          }
          value={cfg.adultProxyHost}
          onChange={(e) => set("adultProxyHost", e.target.value)}
        />
        <input
          className="apikey-input"
          style={{ width: 90, marginBottom: 0 }}
          placeholder="port"
          disabled={
            cfg.adultProxyMode !== "socks5" && cfg.adultProxyMode !== "http"
          }
          value={cfg.adultProxyPort}
          onChange={(e) => set("adultProxyPort", e.target.value)}
        />
      </div>
      <div style={{ marginBottom: 24 }}>
        <label style={rowLabel}>Adult bypass list (optional)</label>
        <input
          className="apikey-input"
          style={{ flex: 1, minWidth: 260, marginBottom: 0, width: "100%" }}
          placeholder="localhost, *.internal.lan"
          disabled={
            cfg.adultProxyMode !== "socks5" && cfg.adultProxyMode !== "http"
          }
          value={cfg.adultProxyBypass}
          onChange={(e) => set("adultProxyBypass", e.target.value)}
        />
      </div>

      <div className="settings-section-title">Secure DNS (DoH)</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        Encrypt DNS lookups made inside the app. Redundant if your VPN already
        handles DNS, useful otherwise.
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 24,
        }}
      >
        <select
          className="apikey-input"
          style={{ width: 180, marginBottom: 0 }}
          value={cfg.dohMode}
          onChange={(e) => set("dohMode", e.target.value)}
        >
          <option value="off">Off (system DNS)</option>
          <option value="cloudflare">Cloudflare</option>
          <option value="google">Google</option>
          <option value="quad9">Quad9</option>
          <option value="custom">Custom URL…</option>
        </select>
        {cfg.dohMode === "custom" && (
          <input
            className="apikey-input"
            style={{ flex: 1, minWidth: 260, marginBottom: 0 }}
            placeholder="https://your-doh-server/dns-query"
            value={cfg.dohCustom}
            onChange={(e) => set("dohCustom", e.target.value)}
          />
        )}
      </div>

      <div className="settings-section-title">WebRTC leak protection</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        Prevents embedded sites from discovering your real or local IP through
        WebRTC. Takes effect on next app start.
      </div>
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "0 16px",
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 14,
            padding: "16px 0",
          }}
        >
          <Toggle
            value={cfg.webrtcProtect}
            onChange={(v) => set("webrtcProtect", v)}
          />
          <div style={{ flex: 1 }}>
            <div
              style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}
            >
              Block non-proxied WebRTC traffic
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text3)",
                marginTop: 3,
                lineHeight: 1.5,
              }}
            >
              Forces WebRTC onto the default route only, so ICE candidates
              can't expose alternate interfaces or your real IP.
            </div>
          </div>
        </div>
      </div>

      {blockStats && (
        <>
          <div className="settings-section-title">Ad &amp; tracker blocking</div>
          <div
            style={{
              fontSize: 13,
              color: "var(--text2)",
              marginBottom: 16,
            }}
          >
            <span style={{ color: "#4caf50", fontWeight: 600 }}>
              {blockStats.total.toLocaleString()}
            </span>{" "}
            ad/tracker requests blocked this session
            {blockStats.domains && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: "var(--text3)",
                  lineHeight: 1.6,
                }}
              >
                Top blocked:{" "}
                {Object.entries(blockStats.domains)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([d, n]) => `${d} (${n})`)
                  .join(", ")}{" "}
                <button
                  className="btn btn-ghost dl-btn--sm"
                  style={{ padding: "1px 8px", fontSize: 11 }}
                  onClick={() => setShowBlockModal(true)}
                >
                  View all
                </button>
              </div>
            )}
          </div>
          {showBlockModal && (
            <BlockedStatsModal
              sessionDomains={Object.entries(blockStats.domains || {}).sort(
                (a, b) => b[1] - a[1],
              )}
              sessionTotal={blockStats.total || 0}
              alltimeTotal={blockStats.total || 0}
              subtitle="All-time blocked requests by domain"
              onClose={() => setShowBlockModal(false)}
            />
          )}
        </>
      )}

      <div className="settings-section-title">App lock &amp; panic button</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        Require a PIN every time Streambert launches — independent of the 18+
        section PIN. Press{" "}
        <strong style={{ color: "var(--text2)" }}>Ctrl+Shift+X</strong> at any
        time to instantly hide and mute the window; press it again to bring it
        back. Unlocking lasts until the app is closed.
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 24,
        }}
      >
        <input
          type="password"
          inputMode="numeric"
          placeholder={hasAppPin ? "New app PIN" : "App lock PIN"}
          value={appPin}
          onChange={(e) => setAppPin(e.target.value)}
          style={{
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text1)",
            padding: "7px 10px",
            fontSize: 13,
            width: 110,
          }}
          title="Require a PIN to open Streambert"
        />
        <button
          className="btn btn-secondary"
          disabled={!appPin.trim()}
          title="Require a PIN to open Streambert (relocks every app launch)"
          onClick={async () => {
            storage.set("appPinHash", await hashPin(appPin.trim()));
            sessionStorage.removeItem("appUnlocked");
            setAppPin("");
            setHasAppPin(true);
          }}
        >
          {hasAppPin ? "Change PIN" : "Set PIN"}
        </button>
        {hasAppPin && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              storage.remove("appPinHash");
              sessionStorage.removeItem("appUnlocked");
              setHasAppPin(false);
            }}
          >
            Remove PIN
          </button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-primary" onClick={save}>
          Save
        </button>
        <button
          className="btn btn-secondary"
          title="Clear cookies, cache and site data for embedded player pages — this also logs you out of sites like Fansly"
          onClick={async () => {
            const r = await window.electron?.clearPlayerSession?.();
            setCleared(r?.ok === true);
          }}
        >
          Clear player session data
        </button>
        <button
          className="btn btn-secondary"
          title="Forget all saved resume points (downloads + adult streams) and the adult recents list"
          onClick={() => {
            if (!confirm("Clear all saved watch positions and recents?"))
              return;
            for (const k of Object.keys(localStorage)) {
              if (
                k.startsWith("streambert_dlTime_") ||
                k.startsWith("streambert_adultResume_")
              )
                localStorage.removeItem(k);
            }
            storage.set("adultRecents", []);
            setResumed(true);
          }}
        >
          Clear resume points
        </button>
        <input
          type="password"
          inputMode="numeric"
          placeholder={hasPin ? "New PIN" : "Adult PIN"}
          value={adultPin}
          onChange={(e) => setAdultPin(e.target.value)}
          style={{
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text1)",
            padding: "7px 10px",
            fontSize: 13,
            width: 110,
          }}
          title="Require a PIN to open the 18+ section"
        />
        <button
          className="btn btn-secondary"
          disabled={!adultPin.trim()}
          title="Require a PIN to open the 18+ section (relocks every app launch)"
          onClick={async () => {
            storage.set("adultPinHash", await hashPin(adultPin.trim()));
            sessionStorage.removeItem("adultUnlocked");
            setAdultPin("");
            setHasPin(true);
          }}
        >
          {hasPin ? "Change PIN" : "Set PIN"}
        </button>
        {hasPin && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              storage.remove("adultPinHash");
              setHasPin(false);
            }}
          >
            Remove PIN
          </button>
        )}
        {resumed && (
          <span style={{ fontSize: 13, color: "#4caf50" }}>✓ Cleared</span>
        )}
        {cleared && (
          <span style={{ fontSize: 13, color: "#4caf50" }}>✓ Cleared</span>
        )}
        {saved && (
          <span style={{ fontSize: 13, color: "#4caf50" }}>✓ Saved</span>
        )}
        {restartNeeded && (
          <span style={{ fontSize: 13, color: "var(--text3)" }}>
            Restart the app for the WebRTC change to apply
          </span>
        )}
      </div>
    </div>
  );
}

const SECTION_NAV = [
  {
    id: "updates",
    label: "Updates & API",
    icon: "↑",
    keywords: [
      "update",
      "version",
      "tmdb",
      "api",
      "token",
      "key",
      "check",
      "startup",
      "auto",
      "app",
      "language",
      "metadata",
      "locale",
      "german",
      "french",
      "spanish",
    ],
  },
  {
    id: "content",
    label: "Age Rating",
    icon: "🔞",
    keywords: [
      "age",
      "rating",
      "parental",
      "content",
      "country",
      "restriction",
      "pg",
      "fsk",
      "adults",
    ],
  },
  {
    id: "adult",
    label: "Adult (18+)",
    icon: "🌶",
    keywords: [
      "adult",
      "18+",
      "nsfw",
      "porn",
      "xxx",
      "gate",
      "confirmation",
      "gay",
      "grid",
      "sort",
      "eporner",
      "sites",
      "creators",
    ],
  },
  {
    id: "playback",
    label: "Playback",
    icon: "▶",
    keywords: [
      "invidious",
      "trailer",
      "youtube",
      "threshold",
      "watched",
      "playback",
      "seconds",
      "mark",
      "auto-watched",
      "intro",
      "skip",
      "aniskip",
      "anime",
      "outro",
      "source",
      "native",
      "dub",
      "volume",
      "speed",
      "muted",
      "sync",
    ],
  },
  {
    id: "subtitles",
    label: "Subtitles",
    icon: "CC",
    keywords: [
      "subtitle",
      "subdl",
      "wyzie",
      "language",
      "caption",
      "srt",
      "download",
      "cc",
    ],
  },
  {
    id: "downloads",
    label: "Downloads",
    icon: "⬇",
    keywords: [
      "download",
      "folder",
      "path",
      "save",
      "video",
      "movies",
      "files",
    ],
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: "🔔",
    keywords: [
      "notification",
      "notify",
      "alert",
      "desktop",
      "episode",
      "download",
      "watchlist",
      "new episode",
      "release",
    ],
  },
  {
    id: "discordRpc",
    label: "Discord Rich Presence",
    icon: "🎮",
    keywords: [
      "discord",
      "rich presence",
      "rpc",
      "status",
      "activity",
      "watching",
      "idling",
      "presence",
    ],
  },
  {
    id: "interface",
    label: "Interface",
    icon: "✦",
    keywords: [
      "home",
      "layout",
      "start page",
      "appearance",
      "accent",
      "colour",
      "color",
      "font",
      "compact",
      "animation",
      "theme",
      "rows",
      "hero",
    ],
  },
  {
    id: "library",
    label: "Library",
    icon: "📚",
    keywords: [
      "library",
      "watchlist",
      "sort",
      "history",
      "privacy",
      "watch history",
      "continue",
    ],
  },
  {
    id: "backup",
    label: "Backup",
    icon: "💾",
    keywords: [
      "backup",
      "restore",
      "export",
      "import",
      "scheduled",
      "json",
      "backup file",
    ],
  },
  {
    id: "network",
    label: "Privacy & Network",
    icon: "🔒",
    keywords: [
      "proxy",
      "vpn",
      "socks5",
      "dns",
      "doh",
      "webrtc",
      "privacy",
      "network",
      "ip",
      "leak",
    ],
  },
  {
    id: "storage",
    label: "Storage & Data",
    icon: "🗄",
    keywords: [
      "storage",
      "cache",
      "clear",
      "reset",
      "delete",
      "data",
      "wipe",
      "progress",
      "factory",
    ],
  },
];

function SettingsTopBar({ sectionRefs, contentRef }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const matchRanges = useRef([]);
  const currentMatchRef = useRef(0);
  const matchCountRef = useRef(0);
  const inputRef = useRef(null);
  const navRef = useRef(null);
  const searchBarRef = useRef(null);
  const debounceTimer = useRef(null);
  const rafHandle = useRef(null);

  const clearHighlights = () => {
    if (SUPPORTS_HIGHLIGHT) {
      CSS.highlights.delete("settings-search");
      CSS.highlights.delete("settings-search-active");
    }
    matchRanges.current = [];
    matchCountRef.current = 0;
    currentMatchRef.current = 0;
    setMatchCount(0);
    setCurrentMatch(0);
  };

  const scrollToRange = (range) => {
    if (!range) return;
    if (rafHandle.current) cancelAnimationFrame(rafHandle.current);
    rafHandle.current = requestAnimationFrame(() => {
      rafHandle.current = null;
      try {
        const el = range.startContainer.parentElement;
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch (_) {}
    });
  };

  const setActiveMatch = (idx) => {
    const range = matchRanges.current[idx];
    if (!range) return;
    if (SUPPORTS_HIGHLIGHT) {
      CSS.highlights.set("settings-search-active", new Highlight(range));
    }
    scrollToRange(range);
    currentMatchRef.current = idx + 1;
    setCurrentMatch(idx + 1);
  };

  const runSearch = (searchQuery) => {
    clearHighlights();
    if (!contentRef?.current || !searchQuery.trim()) return;

    const str = searchQuery.toLowerCase();
    const ranges = [];
    const walker = document.createTreeWalker(
      contentRef.current,
      NodeFilter.SHOW_TEXT,
    );

    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.toLowerCase();
      let idx = 0;
      while ((idx = text.indexOf(str, idx)) !== -1) {
        const range = new Range();
        range.setStart(node, idx);
        range.setEnd(node, idx + searchQuery.length);
        ranges.push(range);
        idx += str.length;
      }
    }

    matchRanges.current = ranges;
    matchCountRef.current = ranges.length;
    setMatchCount(ranges.length);

    if (ranges.length > 0) {
      if (SUPPORTS_HIGHLIGHT) {
        const hl = new Highlight();
        for (const r of ranges) hl.add(r);
        CSS.highlights.set("settings-search", hl);
      }
      setActiveMatch(0);
    }
  };

  const findMatches = (searchQuery) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      runSearch(searchQuery);
    }, 80);
  };

  const goNext = () => {
    const total = matchCountRef.current;
    if (total === 0) return;
    const next = currentMatchRef.current < total ? currentMatchRef.current : 0;
    setActiveMatch(next);
  };

  const goPrev = () => {
    const total = matchCountRef.current;
    if (total === 0) return;
    const prev =
      currentMatchRef.current > 1 ? currentMatchRef.current - 2 : total - 1;
    setActiveMatch(prev);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    clearHighlights();
  };

  // Focus on open
  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 30);
    }
  }, [searchOpen]);

  // Clean up on unmount
  useEffect(
    () => () => {
      clearHighlights();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (rafHandle.current) cancelAnimationFrame(rafHandle.current);
    },
    [],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") {
        closeSearch();
        setNavOpen(false);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "f")) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key === "F3") {
        e.preventDefault();
        if (e.shiftKey) goPrev();
        else goNext();
        return;
      }
      if (searchOpen && e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) goPrev();
        else goNext();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [searchOpen]);

  // Close nav on outside click
  useEffect(() => {
    if (!navOpen) return;
    const handler = (e) => {
      if (navRef.current && !navRef.current.contains(e.target))
        setNavOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [navOpen]);

  // Clear highlights + close search when clicking outside the search bar
  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e) => {
      if (searchBarRef.current && !searchBarRef.current.contains(e.target)) {
        clearHighlights();
        setSearchOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [searchOpen]);

  const scrollTo = (id) => {
    const el = sectionRefs[id]?.current;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setNavOpen(false);
  };

  const handleQueryChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    findMatches(val);
  };

  const noMatch = query.trim().length > 0 && matchCount === 0;
  const hasQuery = query.trim().length > 0;

  const navBtnStyle = {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--text2)",
    display: "flex",
    alignItems: "center",
    padding: "4px 5px",
    borderRadius: 5,
    transition: "background 0.1s",
    flexShrink: 0,
  };

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        background: "var(--bg, #141414)",
        borderBottom: "1px solid var(--border)",
        padding: "0 48px",
        backdropFilter: "blur(12px)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 0",
        }}
      >
        {/* ── Search area ── */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
          {searchOpen ? (
            <div
              ref={searchBarRef}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flex: 1,
                maxWidth: 540,
                background: "var(--surface2)",
                border: `1px solid ${noMatch ? "#ff3860" : "var(--red)"}`,
                borderRadius: 8,
                padding: "5px 8px 5px 12px",
                boxShadow: `0 0 0 3px ${noMatch ? "rgba(255,56,96,0.1)" : "rgba(229,9,20,0.1)"}`,
                transition: "border-color 0.15s, box-shadow 0.15s",
              }}
            >
              {/* Search icon */}
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--text3)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>

              {/* Input */}
              <input
                ref={inputRef}
                value={query}
                onChange={handleQueryChange}
                placeholder="Search on this page…"
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  fontSize: 14,
                  color: noMatch ? "#ff3860" : "var(--text)",
                  fontFamily: "var(--font-body)",
                  minWidth: 0,
                }}
              />

              {/* Match counter */}
              {hasQuery && (
                <span
                  style={{
                    fontSize: 12,
                    color: noMatch ? "#ff3860" : "var(--text3)",
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                    padding: "0 8px",
                    borderLeft: "1px solid var(--border)",
                    borderRight: "1px solid var(--border)",
                    margin: "0 2px",
                    flexShrink: 0,
                  }}
                >
                  {noMatch ? "No results" : `${currentMatch} / ${matchCount}`}
                </span>
              )}

              {/* Prev button */}
              {matchCount > 0 && (
                <button
                  onClick={goPrev}
                  title="Previous match (Shift+Enter)"
                  style={navBtnStyle}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "rgba(255,255,255,0.08)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "none")
                  }
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="18 15 12 9 6 15" />
                  </svg>
                </button>
              )}

              {/* Next button */}
              {matchCount > 0 && (
                <button
                  onClick={goNext}
                  title="Next match (Enter)"
                  style={navBtnStyle}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "rgba(255,255,255,0.08)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "none")
                  }
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              )}

              {/* Divider + Clear */}
              {query && (
                <button
                  onClick={() => {
                    setQuery("");
                    clearHighlights();
                    inputRef.current?.focus();
                  }}
                  title="Clear search"
                  style={{ ...navBtnStyle, color: "var(--text3)" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "rgba(255,255,255,0.08)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "none")
                  }
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}

              {/* Esc button */}
              <button
                onClick={closeSearch}
                title="Close (Esc)"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text3)",
                  fontSize: 11,
                  padding: "3px 7px",
                  borderRadius: 4,
                  fontFamily: "var(--font-body)",
                  flexShrink: 0,
                  letterSpacing: 0.3,
                }}
              >
                Esc
              </button>
            </div>
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "6px 14px",
                fontSize: 13,
                color: "var(--text3)",
                cursor: "pointer",
                transition: "all 0.15s",
                fontFamily: "var(--font-body)",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "var(--surface3)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "var(--surface2)")
              }
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Search settings…
              <span
                style={{
                  fontSize: 10,
                  color: "var(--text3)",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  padding: "1px 6px",
                  fontFamily: "monospace",
                  letterSpacing: 0.5,
                }}
              >
                ⌘K
              </span>
            </button>
          )}
        </div>

        {/* ── Jump to section dropdown ── */}
        <div ref={navRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            onClick={() => setNavOpen((o) => !o)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: navOpen ? "var(--surface3)" : "var(--surface2)",
              border: `1px solid ${navOpen ? "var(--red)" : "var(--border)"}`,
              boxShadow: navOpen ? "0 0 0 3px rgba(229,9,20,0.1)" : "none",
              borderRadius: 8,
              padding: "6px 14px",
              fontSize: 13,
              color: "var(--text)",
              cursor: "pointer",
              transition: "all 0.15s",
              fontFamily: "var(--font-body)",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <circle cx="3" cy="6" r="1" fill="currentColor" />
              <circle cx="3" cy="12" r="1" fill="currentColor" />
              <circle cx="3" cy="18" r="1" fill="currentColor" />
            </svg>
            Jump to Section
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text3)"
              strokeWidth="2.5"
              strokeLinecap="round"
              style={{
                transform: navOpen ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s",
                flexShrink: 0,
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {navOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                zIndex: 200,
                background: "var(--surface3)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
                minWidth: 230,
                padding: 6,
              }}
            >
              {SECTION_NAV.map((s) => (
                <button
                  key={s.id}
                  onMouseDown={() => scrollTo(s.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    borderRadius: 8,
                    padding: "9px 12px",
                    fontSize: 13,
                    color: "var(--text)",
                    cursor: "pointer",
                    transition: "background 0.1s",
                    fontFamily: "var(--font-body)",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "rgba(255,255,255,0.07)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <span
                    style={{
                      width: 22,
                      textAlign: "center",
                      fontSize: 13,
                      flexShrink: 0,
                    }}
                  >
                    {s.icon}
                  </span>
                  <span style={{ flex: 1 }}>{s.label}</span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--text3)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SettingsPage({
  apiKey,
  onChangeApiKey,
  initialSection,
}) {
  const [downloadPath, setDownloadPath] = useState(
    () => storage.get(STORAGE_KEYS.DOWNLOAD_PATH) || "",
  );
  const [watchedThreshold, setWatchedThreshold] = useState(
    () => storage.get(STORAGE_KEYS.WATCHED_THRESHOLD) ?? 20,
  );
  const [introSkipMode, setIntroSkipMode] = useState(
    () => storage.get(STORAGE_KEYS.INTRO_SKIP_MODE) || "off",
  );
  const [autoplayNextEnabled, setAutoplayNextEnabled] = useState(
    () => storage.get(STORAGE_KEYS.AUTOPLAY_NEXT_ENABLED) ?? true,
  );
  const [autoplayNextDuration, setAutoplayNextDuration] = useState(
    () => storage.get(STORAGE_KEYS.AUTOPLAY_NEXT_DURATION) ?? 5,
  );
  const [autoplayNextLayout, setAutoplayNextLayout] = useState(
    () => storage.get(STORAGE_KEYS.AUTOPLAY_NEXT_LAYOUT) || "right",
  );
  const [saved, setSaved] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetHovered, setResetHovered] = useState(false);
  const [showProgressConfirm, setShowProgressConfirm] = useState(false);
  const [showDeleteDlConfirm, setShowDeleteDlConfirm] = useState(false);

  // ── Section refs for navigation ────────────────────────────────────────────
  const secUpdates = useRef(null);
  const secContent = useRef(null);
  const secAdult = useRef(null);
  const secPlayback = useRef(null);
  const secSubtitles = useRef(null);
  const secDownloads = useRef(null);
  const secNotifications = useRef(null);
  const secDiscordRpc = useRef(null);
  const secInterface = useRef(null);
  const secLibrary = useRef(null);
  const secNetwork = useRef(null);
  const secBackup = useRef(null);
  const secStorage = useRef(null);

  const sectionRefs = {
    updates: secUpdates,
    content: secContent,
    adult: secAdult,
    playback: secPlayback,
    subtitles: secSubtitles,
    downloads: secDownloads,
    notifications: secNotifications,
    discordRpc: secDiscordRpc,
    interface: secInterface,
    library: secLibrary,
    network: secNetwork,
    backup: secBackup,
    storage: secStorage,
  };

  // Ref for find-in-page search scope
  const contentRef = useRef(null);

  // Scroll to initial section if provided (e.g. when navigating from a modal)
  useEffect(() => {
    if (!initialSection) return;
    const el = sectionRefs[initialSection]?.current;
    if (!el) return;
    // Small delay so layout is complete before scrolling
    const t = setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => clearTimeout(t);
  }, []);

  // Age Rating
  const [ratingCountry, setRatingCountry] = useState(
    () => storage.get(STORAGE_KEYS.RATING_COUNTRY) || "US",
  );
  const [ageLimit, setAgeLimit] = useState(() => {
    const v = storage.get(STORAGE_KEYS.AGE_LIMIT);
    return v === null || v === undefined ? "" : String(v);
  });
  const [ageSaved, setAgeSaved] = useState(false);
  const [, setSrcStatsVersion] = useState(0); // bump to re-render source stats

  const saveAgeSettings = () => {
    storage.set(STORAGE_KEYS.RATING_COUNTRY, ratingCountry);
    if (ageLimit === "" || ageLimit === null) {
      storage.remove(STORAGE_KEYS.AGE_LIMIT);
    } else {
      storage.set(STORAGE_KEYS.AGE_LIMIT, Number(ageLimit));
    }
    setAgeSaved(true);
    setTimeout(() => setAgeSaved(false), 2000);
  };

  // Invidious
  const [invidiousBase, setInvidiousBase] = useState(
    () => storage.get(STORAGE_KEYS.INVIDIOUS_BASE) || DEFAULT_INVIDIOUS_BASE,
  );
  const [invidiousStatus, setInvidiousStatus] = useState(null); // null | { ok: bool, msg: string }
  const [invidiousChecking, setInvidiousChecking] = useState(false);
  const [invidiousSaved, setInvidiousSaved] = useState(false);

  const checkInvidious = async (baseUrl) => {
    const clean = (baseUrl || "").trim().replace(/\/$/, "");
    if (!clean) {
      setInvidiousStatus({ ok: false, msg: "Please enter a URL first." });
      return;
    }
    setInvidiousChecking(true);
    setInvidiousStatus(null);
    try {
      const url = `${clean}/api/v1/stats`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        setInvidiousStatus({
          ok: true,
          msg: "Instance reachable and responding.",
        });
      } else {
        setInvidiousStatus({
          ok: false,
          msg: `Server responded with status ${res.status}.`,
        });
      }
    } catch (e) {
      setInvidiousStatus({
        ok: false,
        msg: "Could not reach instance. Check the URL or try another.",
      });
    } finally {
      setInvidiousChecking(false);
    }
  };

  const saveInvidiousBase = () => {
    const clean = (invidiousBase || "").trim().replace(/\/$/, "");
    storage.set(STORAGE_KEYS.INVIDIOUS_BASE, clean || DEFAULT_INVIDIOUS_BASE);
    setInvidiousBase(clean || DEFAULT_INVIDIOUS_BASE);
    setInvidiousSaved(true);
    setTimeout(() => setInvidiousSaved(false), 2000);
  };

  // Storage sizes - null = loading, -1 = unavailable, ≥0 = real value
  const [sizes, setSizes] = useState({ cache: null, downloads: null });

  useEffect(() => {
    if (typeof window === "undefined" || !window.electron) {
      setSizes({ cache: -1, downloads: -1 });
      return;
    }
    (async () => {
      try {
        const [cacheRes, downloadsRes] = await Promise.all([
          window.electron.getCacheSize?.() ?? null,
          window.electron.getDownloadsSize?.() ?? null,
        ]);
        setSizes({
          cache: cacheRes?.bytes ?? -1,
          downloads: downloadsRes?.bytes ?? -1,
        });
      } catch {
        setSizes({ cache: -1, downloads: -1 });
      }
    })();
  }, []);

  const pickFolder = async () => {
    if (!isElectron) return;
    const folder = await window.electron.pickFolder();
    if (folder) {
      setDownloadPath(folder);
      storage.set(STORAGE_KEYS.DOWNLOAD_PATH, folder);
      flash();
    }
  };

  const handleSavePath = () => {
    storage.set(STORAGE_KEYS.DOWNLOAD_PATH, downloadPath);
    flash();
  };

  const handleSaveThreshold = () => {
    const val = Math.max(1, Math.min(300, Number(watchedThreshold) || 20));
    setWatchedThreshold(val);
    storage.set(STORAGE_KEYS.WATCHED_THRESHOLD, val);
    flash();
  };

  const flash = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // ── Clean handlers ─────────────────────────────────────────────────────────

  const handleClearCache = async () => {
    await clearAppCaches();
    setSizes((prev) => ({ ...prev, cache: 0 }));
    return { msg: "✓ Cache cleared successfully" };
  };

  const handleClearWatchProgress = async () => {
    storage.remove(STORAGE_KEYS.WATCH_PROGRESS);
    storage.remove(STORAGE_KEYS.HISTORY);
    storage.remove(STORAGE_KEYS.WATCHED);
    if (isElectron) await window.electron.clearWatchData();
    setTimeout(() => window.location.reload(), 800);
    return { msg: "✓ Watch data cleared" };
  };

  const handleDeleteAllDownloads = async () => {
    let msg = "✓ All downloads removed";
    setSizes((prev) => ({ ...prev, downloads: 0 }));
    if (isElectron) {
      const res = await window.electron.deleteAllDownloads();
      if (res?.deleted != null) {
        msg = `✓ Removed ${res.deleted} file${res.deleted !== 1 ? "s" : ""}`;
        if (res.errors > 0) msg += ` (${res.errors} could not be deleted)`;
      }
    } else {
      storage.remove(STORAGE_KEYS.LOCAL_FILES);
    }
    return { msg };
  };

  const handleResetApp = async () => {
    setShowResetConfirm(false);
    if (isElectron) await window.electron.resetApp();
    storage.clearAll();
    // Clear non-prefixed localStorage caches
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("dlDur_")) localStorage.removeItem(key);
    }
    window.location.reload();
  };

  return (
    <>
      {showProgressConfirm && (
        <ConfirmDialog
          title="CLEAR WATCH PROGRESS?"
          description="This will permanently delete all watch history, continue-watching progress, and watched/completed markings for all movies and series."
          confirmLabel="Yes, Clear Everything"
          onConfirm={async () => {
            setShowProgressConfirm(false);
            await handleClearWatchProgress();
            window.__progressConfirmResolve?.({ msg: "✓ Watch data cleared" });
            window.__progressConfirmResolve = null;
          }}
          onCancel={() => {
            setShowProgressConfirm(false);
            window.__progressConfirmResolve?.({ cancelled: true });
            window.__progressConfirmResolve = null;
          }}
        />
      )}
      {showDeleteDlConfirm && (
        <ConfirmDialog
          title="DELETE ALL DOWNLOADS?"
          description="This will permanently delete all video files downloaded through Streambert and remove them from the download list."
          confirmLabel="Yes, Delete All"
          onConfirm={async () => {
            setShowDeleteDlConfirm(false);
            const result = await handleDeleteAllDownloads();
            window.__deleteDlConfirmResolve?.(result);
            window.__deleteDlConfirmResolve = null;
          }}
          onCancel={() => {
            setShowDeleteDlConfirm(false);
            window.__deleteDlConfirmResolve?.({ cancelled: true });
            window.__deleteDlConfirmResolve = null;
          }}
        />
      )}
      {showResetConfirm && (
        <ResetConfirmDialog
          onConfirm={handleResetApp}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}

      {/* ── Sticky search & navigation bar ── */}
      <SettingsTopBar sectionRefs={sectionRefs} contentRef={contentRef} />

      <div
        ref={contentRef}
        className="fade-in"
        style={{ padding: "40px 48px 80px" }}
      >
        {/* Page title */}
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 48,
            letterSpacing: 1,
            marginBottom: 6,
          }}
        >
          SETTINGS
        </div>
        <div style={{ color: "var(--text3)", fontSize: 14, marginBottom: 48 }}>
          App configuration for Streambert
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: GENERAL                                                     */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secUpdates} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title="General"
            subtitle="App version, updates, API credentials and Languages"
          />

          {/* Version & Updates */}
          <VersionSection />

          <Divider />

          {/* TMDB API Token */}
          <div style={{ marginBottom: 40 }}>
            <div className="settings-section-title">TMDB Read Access Token</div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text3)",
                marginBottom: 16,
                lineHeight: 1.6,
              }}
            >
              Used to fetch movie and TV metadata, posters, ratings, and cast
              info from The Movie Database.
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <code
                style={{
                  fontSize: 13,
                  color: "var(--text2)",
                  background: "var(--surface2)",
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                }}
              >
                {apiKey === CINEMETA_KEY
                  ? "Cinemeta (no API key)"
                  : apiKey
                    ? apiKey.slice(0, 8) + "••••••••••••••••"
                    : "(not set)"}
              </code>
              <button className="btn btn-ghost" onClick={onChangeApiKey}>
                Change API Token
              </button>
            </div>
          </div>

          <Divider />

          <TmdbLanguageSection />
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: CONTENT                                                     */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secContent} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title="Content"
            subtitle="Parental controls and content filtering by age rating"
          />

          <div style={{ marginBottom: 40 }}>
            <div className="settings-section-title">
              Age Rating &amp; Parental Controls
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text3)",
                marginBottom: 20,
                lineHeight: 1.6,
              }}
            >
              Set a maximum age rating. Content rated above this age will still
              be visible but{" "}
              <strong style={{ color: "var(--text)" }}>
                you won't be able to play it.
              </strong>{" "}
              Set to <em>No restriction</em> to disable this feature entirely.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--text2)",
                    marginBottom: 8,
                  }}
                >
                  Rating Country
                </div>
                <SettingsSelect
                  value={ratingCountry}
                  onChange={(v) => setRatingCountry(v)}
                  options={RATING_COUNTRIES.map((c) => ({
                    value: c.code,
                    label: c.label,
                  }))}
                />
              </div>

              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--text2)",
                    marginBottom: 8,
                  }}
                >
                  Maximum Allowed Age Rating
                </div>
                <SettingsSelect
                  value={ageLimit}
                  onChange={(v) => setAgeLimit(v)}
                  options={AGE_LIMIT_OPTIONS}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <button className="btn btn-primary" onClick={saveAgeSettings}>
                  Save
                </button>
                {ageSaved && (
                  <span style={{ fontSize: 13, color: "#48c774" }}>
                    ✓ Saved
                  </span>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: 12, color: "var(--text3)" }}>
                  Quick presets:
                </span>
                {[
                  { label: "Off", lim: "" },
                  { label: "Kids (G/PG)", lim: "7" },
                  { label: "Teens (PG-13)", lim: "13" },
                  { label: "Adults (18+)", lim: "18" },
                ].map((p) => (
                  <button
                    key={p.label}
                    className={`btn btn-ghost${ageLimit === p.lim && ratingCountry === "US" ? " active" : ""}`}
                    style={{ padding: "4px 12px", fontSize: 12 }}
                    onClick={() => {
                      setRatingCountry("US");
                      setAgeLimit(p.lim);
                      storage.set(STORAGE_KEYS.RATING_COUNTRY, "US");
                      if (p.lim === "") storage.remove(STORAGE_KEYS.AGE_LIMIT);
                      else storage.set(STORAGE_KEYS.AGE_LIMIT, Number(p.lim));
                      setAgeSaved(true);
                      setTimeout(() => setAgeSaved(false), 2000);
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: ADULT (18+)                                                 */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secAdult} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title="Adult Section (18+)"
            subtitle="Defaults for the 18+ section"
          />
          <AdultDefaultsSection />
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: PLAYBACK                                                    */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secPlayback} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title="Playback"
            subtitle="Trailer source and auto-watched behavior"
          />

          <StreamDefaultsSection />

          <Divider />

          <PlayerDefaultsSection />

          <Divider />

          <WidevineSection />

          <Divider />

          {/* Invidious */}
          <div style={{ marginBottom: 40 }}>
            <div className="settings-section-title">Invidious Instance</div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text3)",
                marginBottom: 16,
                lineHeight: 1.6,
              }}
            >
              Trailers are played via{" "}
              <span style={{ color: "var(--text)", fontWeight: 600 }}>
                Invidious
              </span>
              , a privacy-friendly YouTube frontend. Your configured instance is
              tried first; if it fails, the app automatically falls back through
              a list of known working instances. The default is{" "}
              <code style={{ fontSize: 12 }}>{DEFAULT_INVIDIOUS_BASE}</code>.
              The instance must have its API enabled (
              <code style={{ fontSize: 12 }}>/api/v1/stats</code> reachable).
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <input
                className="apikey-input"
                style={{ flex: 1, minWidth: 260, marginBottom: 0 }}
                placeholder={DEFAULT_INVIDIOUS_BASE}
                value={invidiousBase}
                onChange={(e) => {
                  setInvidiousBase(e.target.value);
                  setInvidiousStatus(null);
                }}
              />
              <button
                className="btn btn-ghost"
                disabled={invidiousChecking}
                onClick={() => checkInvidious(invidiousBase)}
                style={{ opacity: invidiousChecking ? 0.5 : 1 }}
              >
                {invidiousChecking ? "Checking…" : "Check"}
              </button>
              <button className="btn btn-primary" onClick={saveInvidiousBase}>
                Save
              </button>
            </div>

            {invidiousStatus && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 12,
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: invidiousStatus.ok ? "#48c774" : "#ff3860",
                    boxShadow: invidiousStatus.ok
                      ? "0 0 6px rgba(72,199,116,0.6)"
                      : "0 0 6px rgba(255,56,96,0.6)",
                  }}
                />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: invidiousStatus.ok ? "#48c774" : "#ff3860",
                  }}
                >
                  {invidiousStatus.msg}
                </span>
              </div>
            )}

            {invidiousSaved && (
              <div style={{ marginTop: 10, fontSize: 13, color: "#48c774" }}>
                ✓ Saved
              </div>
            )}
          </div>

          <Divider />

          {/* Auto-Watched Threshold */}
          <div style={{ marginBottom: 40 }}>
            <div className="settings-section-title">Auto-Watched Threshold</div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text3)",
                marginBottom: 16,
                lineHeight: 1.6,
              }}
            >
              A movie or episode is automatically marked as{" "}
              <span style={{ color: "#48c774", fontWeight: 600 }}>
                Watched ✓
              </span>{" "}
              when the remaining time drops to this value or below. Set between
              1 and 300 seconds.
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="number"
                  min={1}
                  max={300}
                  className="apikey-input"
                  style={{ width: 90, marginBottom: 0 }}
                  value={watchedThreshold}
                  onChange={(e) => setWatchedThreshold(e.target.value)}
                />
                <span style={{ fontSize: 14, color: "var(--text2)" }}>
                  seconds
                </span>
              </div>
              <button className="btn btn-primary" onClick={handleSaveThreshold}>
                Save
              </button>
            </div>
            {saved && (
              <div style={{ marginTop: 10, fontSize: 13, color: "#48c774" }}>
                ✓ Saved
              </div>
            )}
          </div>

          <Divider />

          {/* Autoplay Next Episode */}
          <div style={{ marginBottom: 40 }}>
            <div className="settings-section-title">Autoplay Next Episode</div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text3)",
                marginBottom: 16,
                lineHeight: 1.6,
              }}
            >
              Configure how the player behaves when an episode finishes.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Enable/Disable Toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Toggle
                  value={autoplayNextEnabled}
                  onChange={(val) => {
                    setAutoplayNextEnabled(val);
                    storage.set(STORAGE_KEYS.AUTOPLAY_NEXT_ENABLED, val);
                    flash();
                  }}
                />
                <div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: "var(--text)",
                    }}
                  >
                    Enable Autoplay Next
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text3)",
                      marginTop: 2,
                    }}
                  >
                    Automatically play the next episode when the current one
                    ends.
                  </div>
                </div>
              </div>

              {autoplayNextEnabled && (
                <>
                  {/* Duration input */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      marginTop: 8,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--text2)",
                      }}
                    >
                      Countdown Duration
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text3)",
                        marginBottom: 4,
                      }}
                    >
                      Number of seconds to display the countdown. Set to 0 to
                      only show the buttons and not autoplay automatically.
                    </div>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 12 }}
                    >
                      <input
                        type="number"
                        min={0}
                        max={60}
                        className="apikey-input"
                        style={{ width: 90, marginBottom: 0 }}
                        value={autoplayNextDuration}
                        onChange={(e) =>
                          setAutoplayNextDuration(e.target.value)
                        }
                        onBlur={() => {
                          const num = Math.max(
                            0,
                            Math.min(
                              60,
                              parseInt(autoplayNextDuration, 10) || 0,
                            ),
                          );
                          setAutoplayNextDuration(num);
                          storage.set(STORAGE_KEYS.AUTOPLAY_NEXT_DURATION, num);
                          flash();
                        }}
                      />
                      <span style={{ fontSize: 14, color: "var(--text2)" }}>
                        seconds
                      </span>
                    </div>
                  </div>

                  {/* Overlay Layout selection */}
                  <div style={{ marginTop: 16 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--text2)",
                        marginBottom: 8,
                      }}
                    >
                      Overlay Position
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text3)",
                        marginBottom: 12,
                      }}
                    >
                      Choose which side of the player the next episode thumbnail
                      and details are shown.
                    </div>
                    <SettingsSelect
                      value={autoplayNextLayout}
                      onChange={(val) => {
                        setAutoplayNextLayout(val);
                        storage.set(STORAGE_KEYS.AUTOPLAY_NEXT_LAYOUT, val);
                        flash();
                      }}
                      options={[
                        { value: "left", label: "Left Side" },
                        { value: "right", label: "Right Side" },
                      ]}
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          <Divider />

          {/* Intro Skip */}
          <div style={{ marginBottom: 40 }}>
            <div className="settings-section-title">Anime Intro Skip</div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text3)",
                marginBottom: 16,
                lineHeight: 1.6,
              }}
            >
              Uses{" "}
              <span style={{ color: "var(--text)", fontWeight: 600 }}>
                AniSkip
              </span>{" "}
              to detect and skip opening/ending segments. Only active for animes
              and when using{" "}
              <span style={{ color: "var(--text)", fontWeight: 600 }}>
                HiAnime
              </span>{" "}
              as source.
            </div>
            <div
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "0 16px",
              }}
            >
              {[
                {
                  value: "off",
                  label: "Off",
                  desc: "Intro skip is disabled.",
                },
                {
                  value: "auto",
                  label: "Auto Skip",
                  desc: "Automatically jumps past the intro/outro when reached.",
                },
                {
                  value: "manual",
                  label: "Manual Skip",
                  desc: 'Shows a "Skip Intro" button at the bottom of the player.',
                },
              ].map(({ value, label, desc }, i, arr) => (
                <div
                  key={value}
                  onClick={() => {
                    setIntroSkipMode(value);
                    storage.set(STORAGE_KEYS.INTRO_SKIP_MODE, value);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 14,
                    padding: "16px 0",
                    borderBottom:
                      i < arr.length - 1 ? "1px solid var(--border)" : "none",
                    cursor: "pointer",
                  }}
                >
                  {/* Radio dot */}
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      border: `2px solid ${introSkipMode === value ? "var(--red)" : "var(--border)"}`,
                      background:
                        introSkipMode === value ? "var(--red)" : "transparent",
                      flexShrink: 0,
                      marginTop: 1,
                      boxShadow:
                        introSkipMode === value
                          ? "0 0 0 3px rgba(229,9,20,0.18)"
                          : "none",
                      transition: "all 0.15s",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {introSkipMode === value && (
                      <div
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "#fff",
                        }}
                      />
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: "var(--text)",
                      }}
                    >
                      {label}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text3)",
                        marginTop: 3,
                        lineHeight: 1.5,
                      }}
                    >
                      {desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Source reliability — learned from actual plays */}
          <div>
            <div className="settings-section-title">Source Reliability</div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text3)",
                marginBottom: 12,
                lineHeight: 1.5,
              }}
            >
              Learned automatically: a source counts as working when a play
              produced a stream, and failed when nothing playable arrived.
              These scores drive failover ordering.
            </div>
            {(() => {
              const stats = getSourceStats();
              const rows = PLAYER_SOURCES.filter((s) => stats[s.id])
                .map((s) => {
                  const st = stats[s.id];
                  const total = (st.ok || 0) + (st.fail || 0);
                  return {
                    s,
                    total,
                    last: st.last || 0,
                    lat: st.lat || 0,
                    pct: total ? Math.round((st.ok / total) * 100) : 0,
                  };
                })
                .sort((a, b) => b.pct - a.pct || b.total - a.total);
              if (!rows.length)
                return (
                  <div style={{ fontSize: 13, color: "var(--text3)" }}>
                    No plays recorded yet — stats build up as you watch.
                  </div>
                );
              return (
                <>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fill, minmax(200px, 1fr))",
                      gap: 8,
                      marginBottom: 12,
                    }}
                  >
                    {rows.map(({ s, total, last, lat, pct }) => (
                      <div
                        key={s.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 6,
                          background: "var(--surface2)",
                          borderRadius: 6,
                          padding: "6px 10px",
                          fontSize: 12,
                        }}
                      >
                        <span
                          style={{ color: "var(--text1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          title={s.label}
                        >
                          {s.label}
                        </span>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            color:
                              pct >= 70
                                ? "#48c774"
                                : pct >= 40
                                  ? "#e8b33e"
                                  : "#ff5d5d",
                          }}
                          title={last ? `Last played ${relAgo(last)}` : ""}
                        >
                          {pct}% · {total}
                          {lat > 0 && (
                            <span
                              style={{ color: "var(--text3)", fontSize: 11 }}
                              title={`Avg time to first stream: ${(lat / 1000).toFixed(1)}s`}
                            >
                              ~{(lat / 1000).toFixed(1)}s
                            </span>
                          )}
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: 11, padding: "0 4px", lineHeight: 1.4 }}
                            title={`Forget learned stats for ${s.label}`}
                            onClick={() => {
                              const stats = { ...getSourceStats() };
                              delete stats[s.id];
                              storage.set(STORAGE_KEYS.SOURCE_STATS, stats);
                              setSrcStatsVersion((v) => v + 1);
                            }}
                          >
                            ✕
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12 }}
                    onClick={() => {
                      storage.remove(STORAGE_KEYS.SOURCE_STATS);
                      setSrcStatsVersion((v) => v + 1);
                    }}
                  >
                    Reset reliability stats
                  </button>
                </>
              );
            })()}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: SUBTITLES                                                   */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secSubtitles} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title="Subtitles"
            subtitle="Subtitle download source, preferred language, and API key"
          />
          <SubtitleSettingsSection />
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: DOWNLOADS                                                   */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secDownloads} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title="Downloads"
            subtitle="Where downloaded video files are saved on disk"
          />

          <div style={{ marginBottom: 40 }}>
            <div className="settings-section-title">Download Folder</div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text3)",
                marginBottom: 16,
                lineHeight: 1.6,
              }}
            >
              Downloaded videos will be saved here. Make sure the folder exists
              and Streambert has write access to it.
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <input
                className="apikey-input"
                style={{ flex: 1, minWidth: 260, marginBottom: 0 }}
                placeholder="/home/you/Movies"
                value={downloadPath}
                onChange={(e) => setDownloadPath(e.target.value)}
              />
              {isElectron && (
                <button className="btn btn-secondary" onClick={pickFolder}>
                  Browse …
                </button>
              )}
              <button className="btn btn-primary" onClick={handleSavePath}>
                Save
              </button>
            </div>
            {saved && (
              <div style={{ marginTop: 10, fontSize: 13, color: "#4caf50" }}>
                ✓ Saved
              </div>
            )}
            {!downloadPath && (
              <div style={{ marginTop: 10, fontSize: 13, color: "var(--red)" }}>
                ⚠ No download folder set - videos cannot be downloaded until you
                set one.
              </div>
            )}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: NOTIFICATIONS                                               */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secNotifications} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title="Notifications"
            subtitle="Desktop alerts for downloads and new episode releases"
          />
          <NotificationsSection />
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: DISCORD RICH PRESENCE                                       */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secDiscordRpc} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title="Discord Rich Presence"
            subtitle="Show what you're watching on your Discord profile"
          />
          <DiscordRpcSection />
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: INTERFACE                                                   */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secInterface} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title="Interface"
            subtitle="Home layout, start page, appearance, and display options"
          />
          <HomeLayoutSection />
          <Divider />
          <StartPageSection />
          <Divider />
          <AppearanceSection />
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: LIBRARY                                                     */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secLibrary} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title="Library"
            subtitle="Watchlist sort order and watch history preferences"
          />
          <LibraryPrivacySection />
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: PRIVACY & NETWORK                                           */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secNetwork} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title="Privacy & Network"
            subtitle="Proxy, encrypted DNS, and IP-leak protection"
          />
          <NetworkSection />
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: BACKUP                                                      */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secBackup} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title="Backup & Restore"
            subtitle="Export your data or restore from a previous backup file"
          />
          <BackupRestoreSection />
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: STORAGE & DATA                                              */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secStorage} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title="Storage & Data"
            subtitle="Clear cache, watch progress, downloads, or reset the entire app"
          />

          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            {/* Install location */}
            <div style={{ padding: "22px 24px" }}>
              <CleanRow
                title="Install Location"
                description="Opens the folder where Streambert is installed."
                buttonLabel="Open Folder"
                onAction={async () => {
                  const p = await window.electron?.getInstallPath?.();
                  if (p) window.electron.openPath(p);
                }}
              />
            </div>

            <div style={{ height: 1, background: "var(--border)" }} />

            {/* Cache */}
            <div style={{ padding: "22px 24px" }}>
              <CleanRow
                title="Clear Cache"
                description="Removes temporary browser cache, shader cache, and service worker data from all internal sessions (main, video player, trailer). Does not affect your personal data or settings."
                buttonLabel="Clear Cache"
                onAction={handleClearCache}
                sizeLabel={formatBytes(sizes.cache)}
              />
            </div>

            <div style={{ height: 1, background: "var(--border)" }} />

            {/* Watch Progress */}
            <div style={{ padding: "22px 24px" }}>
              <CleanRow
                title="Clear Watch Progress"
                description="Resets all watch history, continue-watching progress, and watched / completed markings for movies and series. Also clears internal video player session data."
                buttonLabel="Clear Progress"
                onAction={() =>
                  new Promise((resolve) => {
                    setShowProgressConfirm(true);
                    window.__progressConfirmResolve = resolve;
                  })
                }
                danger
              />
            </div>

            <div style={{ height: 1, background: "var(--border)" }} />

            {/* Search History */}
            <div style={{ padding: "22px 24px" }}>
              <CleanRow
                title="Clear Search History"
                description="Removes the list of recent searches shown when you open the search box."
                buttonLabel="Clear History"
                onAction={async () => {
                  storage.remove("searchHistory");
                  return { msg: "✓ Search history cleared" };
                }}
              />
            </div>

            <div style={{ height: 1, background: "var(--border)" }} />

            {/* Episode-release cache */}
            <div style={{ padding: "22px 24px" }}>
              <CleanRow
                title="Clear New-Episode Cache"
                description="Clears the cached episode-release schedule used for new-episode notifications. It rebuilds itself on the next library check."
                buttonLabel="Clear Cache"
                onAction={async () => {
                  storage.remove("episodeReleaseCache");
                  return { msg: "✓ Episode cache cleared" };
                }}
              />
            </div>

            <div style={{ height: 1, background: "var(--border)" }} />

            {/* Delete Downloads */}
            <div style={{ padding: "22px 24px" }}>
              <CleanRow
                title="Delete All Downloads"
                description="Permanently deletes all video files that were downloaded through Streambert and removes them from the download list. Only files downloaded through the app will be deleted, nothing else in your folder is touched."
                buttonLabel="Delete All"
                onAction={() =>
                  new Promise((resolve) => {
                    setShowDeleteDlConfirm(true);
                    window.__deleteDlConfirmResolve = resolve;
                  })
                }
                sizeLabel={formatBytes(sizes.downloads)}
                danger
              />
            </div>

            <div style={{ height: 1, background: "var(--border)" }} />

            {/* Full Reset */}
            <div
              style={{
                padding: "22px 24px",
                background: "rgba(229,9,20,0.03)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 24,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: "var(--text)",
                      marginBottom: 4,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    Reset App
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: 1,
                        color: "var(--red)",
                        background: "rgba(229,9,20,0.12)",
                        border: "1px solid rgba(229,9,20,0.25)",
                        padding: "2px 7px",
                        borderRadius: 4,
                        textTransform: "uppercase",
                      }}
                    >
                      Irreversible
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--text3)",
                      lineHeight: 1.6,
                    }}
                  >
                    Completely resets Streambert to factory defaults, clears all
                    settings, API Token, saved library, watch history/progress,
                    and all cached data. Your downloaded video files will not be
                    touched.
                  </div>
                </div>
                <div style={{ flexShrink: 0, paddingTop: 2 }}>
                  <button
                    className="btn"
                    onClick={() => setShowResetConfirm(true)}
                    onMouseEnter={() => setResetHovered(true)}
                    onMouseLeave={() => setResetHovered(false)}
                    style={{
                      color: resetHovered ? "#fff" : "var(--red)",
                      background: resetHovered
                        ? "rgba(229,9,20,0.85)"
                        : "rgba(229,9,20,0.08)",
                      border: resetHovered
                        ? "1px solid transparent"
                        : "1px solid rgba(229,9,20,0.3)",
                      transition: "all 0.2s",
                    }}
                  >
                    Reset App
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
