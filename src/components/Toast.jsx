import { useCallback, useEffect, useRef, useState } from "react";

// Tiny non-blocking toast: fixed bottom-center (.app-toast in global.css),
// auto-dismisses after ~3s and fades in/out via CSS animation. Usage:
//   const [toast, showToast] = useToast();
//   showToast("VidSrc was unreliable — switched to VidLink");
//   ... <Toast toast={toast} />
export function useToast(ms = 3000) {
  const [toast, setToast] = useState(null); // { msg, seq }
  const timerRef = useRef(null);
  const seqRef = useRef(0);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const showToast = useCallback(
    (msg) => {
      clearTimeout(timerRef.current);
      seqRef.current += 1;
      setToast({ msg, seq: seqRef.current });
      timerRef.current = setTimeout(() => setToast(null), ms);
    },
    [ms],
  );

  return [toast, showToast];
}

export default function Toast({ toast }) {
  if (!toast) return null;
  // key restarts the CSS animation when a new toast replaces a visible one
  return (
    <div key={toast.seq} className="app-toast">
      {toast.msg}
    </div>
  );
}
