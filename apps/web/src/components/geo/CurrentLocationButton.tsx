"use client";

import { useEffect } from "react";
import { LocateFixed, Loader2, AlertCircle } from "lucide-react";
import { useCurrentLocation } from "@/hooks/use-current-location";
import type { GeoAddress } from "@/services/core/api";

/**
 * Phase 16.2 — "Use current location": browser GPS → backend reverse-geocode. Surfaces
 * permission-denied / timeout / unavailable / out-of-area with a retry; never fakes a fix.
 */
export function CurrentLocationButton({
  onResolved,
  className,
}: {
  onResolved: (r: { address: GeoAddress | null; latitude: number; longitude: number; accuracy: number }) => void;
  className?: string;
}) {
  const { state, detect, reset } = useCurrentLocation();

  useEffect(() => {
    if (state.status === "success") {
      onResolved({ address: state.address, latitude: state.latitude, longitude: state.longitude, accuracy: state.accuracy });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  const busy = state.status === "locating" || state.status === "resolving";

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => detect()}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 py-2.5 text-sm font-medium text-primary transition hover:bg-primary/10 disabled:opacity-60"
      >
        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <LocateFixed size={16} aria-hidden />}
        {state.status === "locating" ? "Detecting…" : state.status === "resolving" ? "Resolving address…" : "Use current location"}
      </button>

      {state.status === "success" && (
        <p className="mt-1.5 px-1 text-xs text-gray-500">
          Located {state.accuracy ? `(±${Math.round(state.accuracy)} m)` : ""} ·{" "}
          <span className="text-gray-700">{state.address?.formattedAddress ?? "address pinned"}</span>
        </p>
      )}

      {state.status === "error" && (
        <div className="mt-1.5 flex items-start gap-1.5 px-1 text-xs text-red-600">
          <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {state.message}{" "}
            <button type="button" onClick={() => { reset(); detect(); }} className="font-medium underline">
              Retry
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
