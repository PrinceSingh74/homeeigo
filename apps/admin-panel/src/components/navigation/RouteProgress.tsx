"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { markPendingHref } from "@/lib/nav-pending";

type ProgressState = "idle" | "active" | "done";

/**
 * Instant navigation feedback — a 2px electric-blue bar that starts the moment
 * an internal link is clicked and completes when the new route commits.
 * GPU-only (transform/opacity), no polling, no router patching.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const [state, setState] = useState<ProgressState>("idle");
  const stateRef = useRef<ProgressState>("idle");
  stateRef.current = state;

  // Click on an internal link → show the bar immediately.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || !href.startsWith("/") || href.startsWith("//")) return;
      try {
        const url = new URL(href, window.location.origin);
        if (url.pathname === window.location.pathname) return; // same page — nothing to load
        markPendingHref(url.pathname);
      } catch {
        return;
      }
      setState("active");
    };
    document.addEventListener("click", onClick, { capture: true });
    return () =>
      document.removeEventListener("click", onClick, { capture: true } as EventListenerOptions);
  }, []);

  // Route committed → snap to 100% and fade out.
  useEffect(() => {
    markPendingHref(null);
    if (stateRef.current !== "active") return;
    setState("done");
    const t = setTimeout(() => setState("idle"), 260);
    return () => clearTimeout(t);
  }, [pathname]);

  // Safety: if navigation never commits (aborted / external), hide after 8s.
  useEffect(() => {
    if (state !== "active") return;
    const t = setTimeout(() => setState("idle"), 8000);
    return () => clearTimeout(t);
  }, [state]);

  if (state === "idle") return null;

  return (
    <div
      className="biz-route-progress"
      data-state={state}
      role="progressbar"
      aria-label="Page loading"
      aria-valuetext={state === "done" ? "Loaded" : "Loading"}
    />
  );
}
