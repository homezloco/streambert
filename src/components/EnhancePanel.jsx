import { useState } from "react";
import { storage } from "../utils/storage";
import { pushVideoEnhance } from "../utils/playerPrefs";

// In-player picture controls — the same playerEnh* prefs as Settings →
// Player defaults, editable mid-watch. Changes push to the main process
// (live for embedded players; the app's own player polls /enhance).
const readNum = (key) => {
  const v = storage.get(key);
  return typeof v === "number" && Number.isFinite(v) ? v : 1;
};

function Slider({ label, value, onChange }) {
  return (
    <div className="enh-panel__row">
      <span className="enh-panel__label">{label}</span>
      <input
        type="range"
        min="50"
        max="200"
        step="5"
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
      <span className="enh-panel__val">{Math.round(value * 100)}%</span>
    </div>
  );
}

export default function EnhancePanel({ style }) {
  const [enabled, setEnabled] = useState(
    () => storage.get("playerEnhEnabled") !== false,
  );
  const [bright, setBright] = useState(() => readNum("playerEnhBrightness"));
  const [contrast, setContrast] = useState(() => readNum("playerEnhContrast"));
  const [saturate, setSaturate] = useState(() =>
    readNum("playerEnhSaturation"),
  );
  const [sharpen, setSharpen] = useState(
    () => storage.get("playerEnhSharpen") === true,
  );

  const setNum = (key, setter) => (v) => {
    setter(v);
    storage.set(key, v);
    pushVideoEnhance();
  };
  const toggleEnabled = () => {
    const next = !enabled;
    setEnabled(next);
    storage.set("playerEnhEnabled", next);
    pushVideoEnhance();
  };
  const toggleSharpen = () => {
    const next = !sharpen;
    setSharpen(next);
    storage.set("playerEnhSharpen", next);
    pushVideoEnhance();
  };
  const reset = () => {
    setBright(1);
    setContrast(1);
    setSaturate(1);
    setSharpen(false);
    storage.remove("playerEnhBrightness");
    storage.remove("playerEnhContrast");
    storage.remove("playerEnhSaturation");
    storage.remove("playerEnhSharpen");
    pushVideoEnhance();
  };

  return (
    <div className="enh-panel" style={style} onClick={(e) => e.stopPropagation()}>
      <div className="enh-panel__head">
        <span>Picture</span>
        <button
          className={
            "enh-panel__toggle" + (enabled ? " enh-panel__toggle--on" : "")
          }
          onClick={toggleEnabled}
        >
          {enabled ? "On" : "Off"}
        </button>
      </div>
      <Slider
        label="Brightness"
        value={bright}
        onChange={setNum("playerEnhBrightness", setBright)}
      />
      <Slider
        label="Contrast"
        value={contrast}
        onChange={setNum("playerEnhContrast", setContrast)}
      />
      <Slider
        label="Colour"
        value={saturate}
        onChange={setNum("playerEnhSaturation", setSaturate)}
      />
      <div className="enh-panel__row">
        <span className="enh-panel__label">Sharpen</span>
        <button
          className={
            "enh-panel__toggle" + (sharpen ? " enh-panel__toggle--on" : "")
          }
          onClick={toggleSharpen}
        >
          {sharpen ? "On" : "Off"}
        </button>
      </div>
      <button className="enh-panel__reset" onClick={reset}>
        Reset
      </button>
    </div>
  );
}
