import { useEffect, useRef, useState } from "react";

// Floating ↑ button shown once the main scroller is well below the top.
// Lives inside .main so it works on every page.
export default function BackToTop() {
  const [show, setShow] = useState(false);
  const scrollerRef = useRef(null);

  useEffect(() => {
    const el = document.querySelector(".main");
    scrollerRef.current = el;
    if (!el) return;
    const onScroll = () => setShow(el.scrollTop > 800);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  if (!show) return null;
  return (
    <button
      className="back-to-top"
      title="Back to top"
      aria-label="Back to top"
      onClick={() => scrollerRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
    >
      ↑
    </button>
  );
}
