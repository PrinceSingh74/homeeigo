import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { computeOfferCountdown, type OfferCountdown, type OfferWindow } from "@/lib/offer";
import { serverNow } from "@/lib/server-clock";

/**
 * Live countdown for one offer, derived from the server-time estimate every second (not a
 * decrementing counter — a backgrounded app resumes at the right value).
 */
export function useOfferCountdown(offer: OfferWindow | null | undefined): OfferCountdown | null {
  const [now, setNow] = useState(() => serverNow());
  const expiresAt = offer?.expiresAt ?? null;

  useEffect(() => {
    if (!expiresAt) return;
    setNow(serverNow());
    const id = setInterval(() => setNow(serverNow()), 1000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") setNow(serverNow());
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [expiresAt]);

  return computeOfferCountdown(offer, now);
}

/** Server-time "now" that re-renders every second while `enabled` (for filtering offer lists). */
export function useServerNowTick(enabled: boolean): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}
