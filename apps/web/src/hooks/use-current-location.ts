"use client";

import { useCallback, useState } from "react";
import { coreApi, type GeoAddress } from "@/services/core/api";

export type CurrentLocationState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "resolving"; accuracy: number }
  | { status: "success"; address: GeoAddress | null; latitude: number; longitude: number; accuracy: number }
  | { status: "error"; reason: "denied" | "unavailable" | "timeout" | "out_of_area" | "failed"; message: string };

const MESSAGES: Record<string, string> = {
  denied: "Location permission denied. Enable it in your browser settings.",
  unavailable: "Unable to detect location.",
  timeout: "Location request timed out. Try again.",
  out_of_area: "We don't serve this area yet.",
  failed: "Could not resolve your location. Enter the address manually.",
};

/**
 * Phase 16.2 — "Use current location": browser GPS → backend reverse-geocode. Never fakes
 * a location; every failure mode (denied / timeout / unavailable) surfaces a clear state.
 */
export function useCurrentLocation() {
  const [state, setState] = useState<CurrentLocationState>({ status: "idle" });

  const detect = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({ status: "error", reason: "unavailable", message: MESSAGES.unavailable });
      return;
    }
    setState({ status: "locating" });

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setState({ status: "resolving", accuracy });
        try {
          const res = await coreApi.geo.reverse(latitude, longitude);
          setState({ status: "success", address: res.address, latitude, longitude, accuracy });
        } catch (e: unknown) {
          const code = (e as { code?: string })?.code;
          if (code === "OUT_OF_AREA") setState({ status: "error", reason: "out_of_area", message: MESSAGES.out_of_area });
          else setState({ status: "error", reason: "failed", message: MESSAGES.failed });
        }
      },
      (err) => {
        const reason = err.code === err.PERMISSION_DENIED ? "denied" : err.code === err.TIMEOUT ? "timeout" : "unavailable";
        setState({ status: "error", reason, message: MESSAGES[reason] });
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  }, []);

  return { state, detect, reset: () => setState({ status: "idle" }) };
}
