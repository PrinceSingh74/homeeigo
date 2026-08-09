"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Instant navigation feedback. A top progress bar that STARTS synchronously inside the
 * click event — before Next.js fetches/commits the route's RSC payload — so the partner
 * always sees a response within one frame (<16–50 ms), even when the commit takes longer.
 * Trickles toward 90% while loading, then completes the instant the pathname changes.
 * Pure CSS/inline styles, no deps, never blocks navigation.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  const raf = useRef<number | null>(null);
  const prevPath = useRef(pathname);

  const stop = useCallback(() => {
    if (raf.current != null) cancelAnimationFrame(raf.current);
    raf.current = null;
  }, []);

  const start = useCallback(() => {
    stop();
    setVisible(true);
    setWidth(10);
    let w = 10;
    const trickle = () => {
      w += (90 - w) * 0.018;
      setWidth(w);
      if (w < 89) raf.current = requestAnimationFrame(trickle);
    };
    raf.current = requestAnimationFrame(trickle);
  }, [stop]);

  const complete = useCallback(() => {
    stop();
    setWidth(100);
    window.setTimeout(() => {
      setVisible(false);
      setWidth(0);
    }, 200);
  }, [stop]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href || !href.startsWith("/") || href.startsWith("//")) return;
      if (a.target === "_blank") return;
      if (href === pathname || href.split("?")[0] === pathname) return;
      start();
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true } as EventListenerOptions);
  }, [pathname, start]);

  useEffect(() => {
    if (prevPath.current !== pathname) {
      prevPath.current = pathname;
      if (visible) complete();
    }
  }, [pathname, visible, complete]);

  useEffect(() => stop, [stop]);

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        insetInline: 0,
        top: 0,
        height: 3,
        zIndex: 2147483647,
        pointerEvents: "none",
        opacity: visible ? 1 : 0,
        transition: "opacity 150ms ease",
      }}
    >
      <div
        data-testid="route-progress-bar"
        style={{
          height: "100%",
          width: `${width}%`,
          background: "linear-gradient(90deg, #2563eb, #38bdf8)",
          boxShadow: "0 0 10px rgba(37,99,235,0.6), 0 0 4px rgba(56,189,248,0.5)",
          transition: "width 140ms ease-out",
          willChange: "width",
        }}
      />
    </div>
  );
}
