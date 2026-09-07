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

const REQUIRED_LIBRARIES = ["maps", "marker", "geometry"] as const;
const SCRIPT_ID = "gmaps-js";
const SCRIPT_TIMEOUT_MS = 20_000;
const LIBRARY_TIMEOUT_MS = 20_000;

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
    REQUIRED_LIBRARIES.map((lib) => withTimeout(importLibrary(lib), LIBRARY_TIMEOUT_MS, `maps_lib_${lib}`)),
  );
  if (results[0]?.status === "rejected" || !mapsReady()) {
    throw new Error("maps_not_ready");
  }
}

function ensureScript(key: string): void {
  if (hasImportLibrary()) return;
  const existing = scriptEl();
  if (existing) {
    if (existing.src.includes("callback=") || existing.getAttribute("data-homigo-loaded") === "true") {
      return;
    }
    existing.remove();
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
  script.onerror = () => script.setAttribute("data-homigo-error", "1");
  document.head.appendChild(script);
}

async function injectScript(key: string): Promise<void> {
  let authFailed = false;
  const previousAuth = window.gm_authFailure;
  window.gm_authFailure = () => {
    authFailed = true;
  };

  try {
    if (mapsReady()) return;
    ensureScript(key);
    await waitUntil(
      () => hasImportLibrary() || authFailed || scriptFailed(),
      SCRIPT_TIMEOUT_MS,
      "maps_timeout",
    );
    if (authFailed) throw new Error("maps_auth_failed");
    if (scriptFailed()) throw new Error("maps_load_failed");
    await importRequiredLibraries();
  } finally {
    if (previousAuth) window.gm_authFailure = previousAuth;
    else delete window.gm_authFailure;
  }
}

function loadMaps(key: string): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("ssr"));
  if (mapsReady()) return Promise.resolve();
  if (!loaderPromise) {
    loaderPromise = injectScript(key).catch((err) => {
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
    if (code !== "maps_timeout" && code !== "maps_import_unavailable") {
      throw err;
    }
    await new Promise((r) => window.setTimeout(r, 400));
    if (mapsReady()) return;
    await loadMaps(key);
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
      : "http://localhost:3003";
  switch (code) {
    case "maps_auth_failed":
      return `API key rejected. Enable Maps JavaScript API in Google Cloud, then add referrer ${host}/* under API key HTTP restrictions.`;
    case "maps_load_failed":
      return "Could not download the Maps script. Check network, firewall, or an ad blocker.";
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
