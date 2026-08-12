"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { resolveApiBase } from "@/lib/api-base";
import { rumContext } from "@/lib/telemetry/context";

/**
 * Behavioural customer-experience signals (Phase 4) → /api/ux-signals → Prometheus. These reveal
 * perceived friction that timing metrics miss: rapid re-clicks (impatience), back-button, exit while
 * a navigation is still pending (abandonment), nav success, and scroll frame-rate.
 */
function emit(signal: string, value?: number): void {
  const body = JSON.stringify({ signal, value, ...rumContext() });
  const url = `${resolveApiBase()}/api/ux-signals`;
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    } else {
      void fetch(url, { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true });
    }
  } catch {
    /* best-effort */
  }
}

export function ExperienceSignals() {
  const pathname = usePathname();
  const lastClick = useRef<{ href: string; t: number }>({ href: "", t: 0 });
  const pending = useRef(false);

  // Rapid re-click (same internal link ≥2× within 1s) + mark a navigation pending.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      const href = a?.getAttribute("href");
      if (!href || !href.startsWith("/") || href.startsWith("//")) return;
      const now = performance.now();
      if (lastClick.current.href === href && now - lastClick.current.t < 1000) emit("rapid_reclick");
      lastClick.current = { href, t: now };
      if (href.split(/[?#]/)[0] !== pathname) pending.current = true;
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true } as EventListenerOptions);
  }, [pathname]);

  // Back/forward button.
  useEffect(() => {
    const onPop = () => emit("back_button");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // A pending navigation committed → success.
  useEffect(() => {
    if (pending.current) {
      pending.current = false;
      emit("nav_success");
    }
  }, [pathname]);

  // Left the page while a navigation was still pending → abandonment.
  useEffect(() => {
    const onHide = () => {
      if (pending.current) emit("exit_during_loading");
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  // Scroll frame-rate: while scrolling, count frames per second and report.
  useEffect(() => {
    let active = false, frames = 0, start = 0, raf = 0;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    const loop = (t: number) => {
      if (!start) start = t;
      frames++;
      const dur = t - start;
      if (dur >= 1000) {
        emit("scroll_fps", Math.round((frames * 1000) / dur));
        frames = 0;
        start = t;
      }
      raf = requestAnimationFrame(loop);
    };
    const onScroll = () => {
      if (!active) {
        active = true;
        frames = 0;
        start = 0;
        raf = requestAnimationFrame(loop);
      }
      if (stopTimer) clearTimeout(stopTimer);
      stopTimer = setTimeout(() => {
        active = false;
        cancelAnimationFrame(raf);
      }, 200);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
      if (stopTimer) clearTimeout(stopTimer);
    };
  }, []);

  return null;
}
