import { useState, useEffect } from "react";
import { storage } from "../utils/storage";
import { WarningIcon } from "../components/Icons";

const SITES = [
  { id: "eporner", name: "Eporner", url: "https://www.eporner.com" },
  { id: "xvideos", name: "XVideos", url: "https://www.xvideos.com" },
  { id: "pornhub", name: "Pornhub", url: "https://www.pornhub.com" },
  { id: "redtube", name: "RedTube", url: "https://www.redtube.com" },
  { id: "chaturbate", name: "Chaturbate", url: "https://chaturbate.com" },
];

export default function AdultPage() {
  const [confirmed, setConfirmed] = useState(
    () => storage.get("adultConfirmed") === true,
  );
  const [site, setSite] = useState(SITES[0].id);

  // Same cleanup as the movie/TV player pages: mute + release the tracked
  // player webContents when leaving the section.
  useEffect(() => {
    return () => {
      window.electron?.playerStopped?.();
    };
  }, []);

  if (!confirmed) {
    return (
      <div className="adult-gate fade-in">
        <WarningIcon size={48} />
        <h2>Adult content</h2>
        <p>
          This section embeds third-party adult websites. You must be 18 or
          older (or the age of majority in your jurisdiction) to continue.
        </p>
        <button
          className="btn btn-primary"
          onClick={() => {
            storage.set("adultConfirmed", true);
            setConfirmed(true);
          }}
        >
          I am 18 or older — continue
        </button>
      </div>
    );
  }

  const current = SITES.find((s) => s.id === site) || SITES[0];

  return (
    <div className="adult-page">
      <div className="browse-head adult-head">
        <div className="section-title" style={{ marginBottom: 0 }}>
          <span style={{ color: "var(--red)" }}>18+</span>
        </div>
        <div className="browse-tabs">
          {SITES.map((s) => (
            <button
              key={s.id}
              className={`browse-tab${site === s.id ? " browse-tab--active" : ""}`}
              onClick={() => setSite(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
      <webview
        key={site}
        src={current.url}
        partition="persist:player"
        allowpopups="false"
        sandbox="allow-scripts allow-same-origin allow-forms"
        className="adult-webview"
      />
    </div>
  );
}
