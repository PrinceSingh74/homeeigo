"use client";

import { useEffect } from "react";
import { isChunkLoadError } from "@/lib/error-message";
import { isPageLeaving } from "@/lib/page-lifecycle";

const RELOAD_KEY = "homigo-chunk-reload";

/**
 * Recovers from Next/webpack chunk load failures only (not generic script errors).
 *
 * Not while the page is leaving: a navigation aborts in-flight chunk requests, and reloading in
 * answer to THAT cancelled the navigation the user had just started (see lib/page-lifecycle.ts).
 */
export function ChunkLoadRecovery() {
  useEffect(() => {
    const tryReload = (error: unknown) => {
      if (!isChunkLoadError(error)) return;
      if (isPageLeaving()) return;
      try {
        if (sessionStorage.getItem(RELOAD_KEY)) return;
        sessionStorage.setItem(RELOAD_KEY, "1");
      } catch {
        /* ignore */
      }
      window.location.reload();
    };

    const onError = (event: ErrorEvent) => {
      if (event.error) tryReload(event.error);
      else if (event.message) tryReload(new Error(event.message));
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      tryReload(event.reason);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
