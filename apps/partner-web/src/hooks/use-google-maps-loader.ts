"use client";

import { useEffect, useState } from "react";

/**
 * Loads the Google Maps JavaScript API once (singleton promise) using the
 * modern `loading=async` bootstrap + `importLibrary()` pattern required by
 * the latest Maps JS API. Legacy `libraries=` query params are not used.
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
  }
}

const REQUIRED_LIBRARIES = ["maps", "marker", "routes", "geometry"] as const;

let loaderPromise: Promise<void> | null = null;

function mapsReady(): boolean {
  return typeof window.google?.maps?.Map === "function";
}

function waitForImportLibrary(timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const tick = () => {
      if (typeof window.google?.maps?.importLibrary === "function") {
        resolve();
        return;
      }
      if (performance.now() - start > timeoutMs) {
        reject(new Error("maps_import_unavailable"));
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

async function importRequiredLibraries(): Promise<void> {
  const importLibrary = window.google?.maps?.importLibrary;
  if (!importLibrary) {
    throw new Error("maps_import_unavailable");
  }
  await Promise.all(REQUIRED_LIBRARIES.map((lib) => importLibrary(lib)));
  if (!mapsReady()) {
    throw new Error("maps_not_ready");
  }
}

function injectScript(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      delete window.gm_authFailure;
      if (err) {
        loaderPromise = null;
        reject(err);
      } else {
        resolve();
      }
    };

    const timeoutId = window.setTimeout(() => finish(new Error("maps_timeout")), 30_000);
    window.gm_authFailure = () => finish(new Error("maps_auth_failed"));

    const existing = document.getElementById("gmaps-js") as HTMLScriptElement | null;
    if (existing) {
      if (mapsReady()) {
        finish();
        return;
      }
      const onExistingLoad = async () => {
        try {
          await waitForImportLibrary();
          await importRequiredLibraries();
          finish();
        } catch (e) {
          finish(e instanceof Error ? e : new Error("maps_not_ready"));
        }
      };
      if (existing.getAttribute("data-homigo-loaded") === "true") {
        void onExistingLoad();
        return;
      }
      existing.addEventListener(
        "load",
        () => {
          void onExistingLoad();
        },
        { once: true },
      );
      existing.addEventListener(
        "error",
        () => finish(new Error("maps_load_failed")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.id = "gmaps-js";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = async () => {
      script.setAttribute("data-homigo-loaded", "true");
      try {
        if (process.env.NODE_ENV === "development") {
          console.info("[homigo-maps] script loaded, importing libraries…");
        }
        await waitForImportLibrary();
        await importRequiredLibraries();
        if (process.env.NODE_ENV === "development") {
          console.info("[homigo-maps] libraries ready:", REQUIRED_LIBRARIES.join(", "));
        }
        finish();
      } catch (e) {
        console.error("[homigo-maps] library import failed:", e);
        finish(e instanceof Error ? e : new Error("maps_not_ready"));
      }
    };
    script.onerror = () => finish(new Error("maps_load_failed"));
    document.head.appendChild(script);
  });
}

function loadMaps(key: string): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("ssr"));
  if (mapsReady()) return Promise.resolve();
  if (!loaderPromise) loaderPromise = injectScript(key);
  return loaderPromise;
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
      return "Could not download the Maps script. Check network or firewall.";
    case "maps_timeout":
      return "Maps script timed out. Restart the dev server after setting the API key.";
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
    loadMaps(key)
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
