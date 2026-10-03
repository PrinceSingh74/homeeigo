"use client";

import { useEffect, useState } from "react";

/**
 * Loads the Google Maps JavaScript API once (singleton promise).
 *
 * Uses `loading=async` + a `callback` so we do not depend on the script
 * `load` event — Google documents that event as unreliable with async
 * bootstrap, and it is often already missed after HMR / React Strict Mode
 * remounts (that used to surface as `maps_timeout`).
 */
declare global {
  interface Window {
    google?: {
      maps?: {
        Map?: new (...args: unknown[]) => unknown;
        importLibrary?: (name: string) => Promise<unknown>;
      };
    };
    gm_authFailure?: () => void;
    __homigoMapsReady?: () => void;
  }
}

/** Core libraries only. `routes` is a separate billed API and is unused — DirectionsService lives in `maps`. */
const REQUIRED_LIBRARIES = ["maps", "marker", "geometry"] as const;
const SCRIPT_ID = "gmaps-js";
/** An object rather than constants only so the unit tests can shrink the waits. Nothing in the app writes to it. */
const TIMING = { scriptMs: 20_000, libraryMs: 20_000, retryDelayMs: 400 };

let loaderPromise: Promise<void> | null = null;

function mapsReady(): boolean {
  return typeof window.google?.maps?.Map === "function";
}

function hasImportLibrary(): boolean {
  return typeof window.google?.maps?.importLibrary === "function";
}

function scriptEl(): HTMLScriptElement | null {
  return document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
}

function scriptFailed(): boolean {
  return scriptEl()?.getAttribute("data-homigo-error") === "1";
}

/**
 * How long after the bootstrap has run we still believe the API may arrive.
 *
 * The bootstrap is only a stub that fetches `main.js`; `importLibrary` appears when THAT has run.
 * Measured in Chromium against the real API: `onload` at 3127 ms with `importLibrary` still
 * undefined, the callback 200 ms later. So "the script has loaded" is never, on its own, evidence
 * of failure — only "it loaded this long ago and there is still no API" is.
 */
const STALE_TAG_MS = 10_000;

/** When the bootstrap finished running (epoch ms), or null while it is still in flight. */
function scriptSettledAt(): number | null {
  const raw = scriptEl()?.getAttribute("data-homigo-settled-at");
  if (!raw) return null;
  const at = Number(raw);
  return Number.isFinite(at) ? at : null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = window.setTimeout(() => reject(new Error(code)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(id);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(id);
        reject(err);
      },
    );
  });
}

function waitUntil(predicate: () => boolean, timeoutMs: number, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (predicate()) {
      resolve();
      return;
    }
    const start = performance.now();
    const id = window.setInterval(() => {
      if (predicate()) {
        window.clearInterval(id);
        resolve();
        return;
      }
      if (performance.now() - start > timeoutMs) {
        window.clearInterval(id);
        reject(new Error(code));
      }
    }, 50);
  });
}

async function importRequiredLibraries(): Promise<void> {
  const importLibrary = window.google?.maps?.importLibrary;
  if (!importLibrary) {
    throw new Error("maps_import_unavailable");
  }
  const results = await Promise.allSettled(
    REQUIRED_LIBRARIES.map((lib) => withTimeout(importLibrary(lib), TIMING.libraryMs, `maps_lib_${lib}`)),
  );
  if (results[0]?.status === "rejected" || !mapsReady()) {
    throw new Error("maps_not_ready");
  }
}

function ensureScript(key: string, forceFresh: boolean): void {
  if (hasImportLibrary()) return;
  const existing = scriptEl();
  if (existing) {
    /**
     * Keep a tag that is still working; replace one that cannot succeed.
     *
     * The old condition kept ANY tag whose src contained `callback=` — which is every tag this
     * loader creates — so a dead script could never be replaced and the retry below waited a
     * second full timeout on the same tag.
     */
    const settledAt = scriptSettledAt();
    const dead =
      scriptFailed() ||
      // Its callback already fired, yet there is no API on the page.
      existing.getAttribute("data-homigo-loaded") === "true" ||
      (settledAt !== null && Date.now() - settledAt > STALE_TAG_MS);
    // A tag from the old load-event loader never installed a callback and cannot report readiness.
    const foreign = !existing.src.includes("callback=");
    if (!forceFresh && !dead && !foreign) return;
    existing.remove();
    // A bootstrap that ran without the API leaves a partial `google.maps` behind. Clearing it lets
    // the fresh bootstrap start clean instead of reporting the API as included twice.
    // Typed loosely on purpose: where `@types/google.maps` is installed, `maps` is a required
    // namespace and `delete` on it does not compile.
    const g = window.google as { maps?: unknown } | undefined;
    if (g?.maps && !hasImportLibrary()) delete g.maps;
  }

  window.__homigoMapsReady = () => {
    delete window.__homigoMapsReady;
    scriptEl()?.setAttribute("data-homigo-loaded", "true");
  };

  const params = new URLSearchParams({
    key,
    v: "weekly",
    loading: "async",
    callback: "__homigoMapsReady",
  });
  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
  script.async = true;
  script.defer = true;
  script.onerror = () => {
    script.setAttribute("data-homigo-error", "1");
    script.setAttribute("data-homigo-settled-at", String(Date.now()));
  };
  // Bookkeeping only. `onload` means the bootstrap RAN, not that the API is usable, so it never
  // ends the wait — it is what lets a later timeout be named correctly.
  script.onload = () => script.setAttribute("data-homigo-settled-at", String(Date.now()));
  document.head.appendChild(script);
}

async function injectScript(key: string, forceFresh: boolean): Promise<void> {
  let authFailed = false;
  const previousAuth = window.gm_authFailure;
  window.gm_authFailure = () => {
    authFailed = true;
  };

  try {
    if (mapsReady()) return;
    ensureScript(key, forceFresh);
    try {
      await waitUntil(
        () => hasImportLibrary() || authFailed || scriptFailed(),
        TIMING.scriptMs,
        "maps_timeout",
      );
    } catch (err) {
      // The script arrived and ran; what never arrived is the API. That is not a network timeout,
      // and calling it one sends whoever reads the console to check an ad blocker when the cause
      // is the key: quota, rate limiting (HTTP 429) or billing.
      if (scriptSettledAt() !== null && !scriptFailed() && !authFailed) {
        throw new Error("maps_init_failed");
      }
      throw err;
    }
    if (authFailed) throw new Error("maps_auth_failed");
    if (scriptFailed()) throw new Error("maps_load_failed");
    await importRequiredLibraries();
  } finally {
    if (previousAuth) window.gm_authFailure = previousAuth;
    else delete window.gm_authFailure;
  }
}

function loadMaps(key: string, forceFresh = false): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("ssr"));
  if (mapsReady()) return Promise.resolve();
  if (!loaderPromise) {
    loaderPromise = injectScript(key, forceFresh).catch((err) => {
      loaderPromise = null;
      throw err;
    });
  }
  return loaderPromise;
}

async function loadMapsResilient(key: string): Promise<void> {
  try {
    await loadMaps(key);
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    if (code !== "maps_timeout" && code !== "maps_import_unavailable" && code !== "maps_init_failed") {
      throw err;
    }
    await new Promise((r) => window.setTimeout(r, TIMING.retryDelayMs));
    if (mapsReady()) return;
    // A fresh tag is what makes this a second attempt rather than a second wait.
    await loadMaps(key, true);
  }
}

export type GoogleMapsLoaderState = {
  loaded: boolean;
  error: string | null;
  configured: boolean;
};

export function mapsLoadErrorHint(code: string | null): string {
  const host =
    typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.host}`
      : "http://localhost:3002";
  switch (code) {
    case "maps_auth_failed":
      return `API key rejected. Enable Maps JavaScript API + Routes API in Google Cloud, then add referrer ${host}/* under API key HTTP restrictions.`;
    case "maps_load_failed":
      return "Could not download the Maps script. Check network, firewall, or an ad blocker.";
    case "maps_init_failed":
      return "Maps downloaded but never started. This is usually the API key, not the network: quota used up, rate limited (HTTP 429), or billing not enabled. Check this key in Google Cloud.";
    case "maps_timeout":
      return "Maps took too long to become ready. Check network, ad blockers, and that Maps JavaScript API is enabled for this key.";
    case "maps_import_unavailable":
      return "Maps bootstrap loaded but importLibrary() is missing. Hard refresh (Ctrl+Shift+R).";
    case "maps_not_ready":
      return "Maps libraries loaded but Map constructor is unavailable. Hard refresh (Ctrl+Shift+R).";
    default:
      return "Failed to load Google Maps.";
  }
}

export function useGoogleMapsLoader(): GoogleMapsLoaderState {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const [loaded, setLoaded] = useState(() => typeof window !== "undefined" && mapsReady());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!key) return;
    if (mapsReady()) {
      setLoaded(true);
      setError(null);
      return;
    }
    let alive = true;
    loadMapsResilient(key)
      .then(() => {
        if (!alive) return;
        setError(null);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const code = err instanceof Error ? err.message : "maps_unknown";
        console.error("[homigo-maps] loader error:", code);
        setError(code);
        setLoaded(false);
      });
    return () => {
      alive = false;
    };
  }, [key]);

  return { loaded, error, configured: Boolean(key) };
}

/** Test seam — `tests/google-maps-loader.test.ts`. Application code never imports this. */
export const __mapsLoaderTestHooks = {
  load: loadMapsResilient,
  timing: TIMING,
  reset(): void {
    loaderPromise = null;
  },
};
