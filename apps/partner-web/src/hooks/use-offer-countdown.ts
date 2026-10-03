"use client";

import { useEffect, useState } from "react";

export type OfferCountdown = {
  /** Whole seconds left. Clamped at 0 — never negative, so callers cannot render "-3s". */
  secondsLeft: number;
  /** 1 at dispatch, 0 at the deadline. Drives the ring and the urgency band. */
  fraction: number;
  /** Past the deadline. The card stops offering an action the server would refuse. */
  expired: boolean;
  urgency: "calm" | "warning" | "critical";
};

/**
 * The offer window, counted down on the client.
 *
 * ── Why the client counts, and the server still decides ─────────────────────
 *
 * The backend returns the window's two absolute instants and nothing else. This hook derives the
 * remaining time from the wall clock rather than decrementing a number, so a backgrounded tab, a
 * throttled timer or a sleeping laptop resumes at the RIGHT value instead of however far the
 * interval happened to get. A decrementing counter is wrong by exactly the time the tab was asleep,
 * which on a five-minute window is the difference between "2 minutes left" and an offer that closed
 * while the partner was reading something else.
 *
 * It is a display, never an authority. Reaching zero here disables the button; it does not mark
 * anything expired anywhere. The server re-checks the window inside the accept transaction, so a
 * clock that is behind cannot manufacture an acceptance, and a clock that is ahead only costs the
 * partner the tail of an offer rather than handing them a job that is gone.
 *
 * ── The skew clamp ──────────────────────────────────────────────────────────
 *
 * A device whose clock is wrong by more than the window would otherwise show every offer as already
 * expired, which looks exactly like the bug this whole change is fixing. When the deadline is
 * further away than the window is long, the elapsed fraction is measured from `dispatchedAt`
 * instead, so the ring stays honest about progress even if the absolute numbers cannot be trusted.
 */
export function useOfferCountdown(
  offer: { dispatchedAt: string; expiresAt: string } | null,
  /** Below this share of the window remaining, the card escalates. */
  thresholds: { warning: number; critical: number } = { warning: 0.5, critical: 0.2 },
): OfferCountdown | null {
  const [now, setNow] = useState(() => Date.now());

  const expiresMs = offer ? Date.parse(offer.expiresAt) : Number.NaN;
  const dispatchedMs = offer ? Date.parse(offer.dispatchedAt) : Number.NaN;
  const usable = Number.isFinite(expiresMs) && Number.isFinite(dispatchedMs);

  useEffect(() => {
    if (!usable) return;
    // One second is the finest granularity the card shows; anything faster is battery for nothing.
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    // Re-read immediately on wake — the interval may not have fired while the tab was hidden.
    const onVisible = () => setNow(Date.now());
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [usable, expiresMs]);

  if (!offer || !usable) return null;

  const windowMs = Math.max(1000, expiresMs - dispatchedMs);
  const remainingMs = expiresMs - now;
  const secondsLeft = Math.max(0, Math.ceil(remainingMs / 1000));

  const elapsedFraction = (now - dispatchedMs) / windowMs;
  const fraction = Math.min(1, Math.max(0, 1 - elapsedFraction));

  return {
    secondsLeft,
    fraction,
    expired: remainingMs <= 0,
    urgency:
      fraction <= thresholds.critical ? "critical" : fraction <= thresholds.warning ? "warning" : "calm",
  };
}

/** `4:05`, or `0:09` — a shape people read as time rather than as a number of seconds. */
export function formatCountdown(secondsLeft: number): string {
  const safe = Math.max(0, Math.floor(secondsLeft));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
