import { useRef, useState, useEffect } from "react";

// Horizontal scroll row with ‹ › edge buttons that appear only when the
// content actually overflows in that direction.
export default function ScrollRow({ children }) {
  const ref = useRef(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = () => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const step = (dir) =>
    ref.current?.scrollBy({
      left: dir * ref.current.clientWidth * 0.8,
      behavior: "smooth",
    });

  return (
    <div className="scrollrow-wrap">
      {canLeft && (
        <button
          className="scrollrow-btn left"
          aria-label="Scroll left"
          onClick={() => step(-1)}
        >
          ‹
        </button>
      )}
      <div className="scroll-row" ref={ref} onScroll={update}>
        {children}
      </div>
      {canRight && (
        <button
          className="scrollrow-btn right"
          aria-label="Scroll right"
          onClick={() => step(1)}
        >
          ›
        </button>
      )}
    </div>
  );
}
