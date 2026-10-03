"use client";

import { useEffect, useState } from "react";
import { formatCountdown, type OfferCountdown } from "@/hooks/use-offer-countdown";

const TONE: Record<OfferCountdown["urgency"], { stroke: string; text: string }> = {
  calm: { stroke: "var(--color-partner-success)", text: "text-partner-success" },
  warning: { stroke: "var(--color-partner-warning)", text: "text-partner-warning" },
  critical: { stroke: "var(--color-partner-danger)", text: "text-partner-danger" },
};

/** Honours the OS setting rather than assuming everyone wants the pulse. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * The offer deadline, as a ring that drains.
 *
 * The number alone is precise and easy to ignore; the ring is what makes a partner glance and know
 * without reading. Colour escalates with the same thresholds the card uses, so the ring, the border
 * and the button never disagree about how urgent this is.
 *
 * The time is also announced politely for screen readers — every 30 seconds while there is room, then
 * every 10 in the last minute. Announcing every tick would make the page unusable.
 */
export function OfferCountdownRing({
  countdown,
  size = 56,
}: {
  countdown: OfferCountdown;
  size?: number;
}) {
  const reduced = usePrefersReducedMotion();
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const tone = TONE[countdown.urgency];

  const { secondsLeft } = countdown;
  const announce =
    secondsLeft <= 60 ? secondsLeft % 10 === 0 : secondsLeft % 30 === 0;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-partner-line)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone.stroke}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - countdown.fraction)}
          style={{ transition: reduced ? "none" : "stroke-dashoffset 1s linear, stroke 300ms ease" }}
        />
      </svg>
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center ${tone.text} ${
          countdown.urgency === "critical" && !reduced ? "animate-pulse" : ""
        }`}
      >
        <span className="font-display text-[13px] font-bold leading-none tabular-nums">
          {formatCountdown(secondsLeft)}
        </span>
        <span className="mt-0.5 text-[8px] font-semibold uppercase tracking-wide opacity-70">
          left
        </span>
      </div>
      <span className="sr-only" aria-live="polite">
        {announce ? `${formatCountdown(secondsLeft)} left to respond` : ""}
      </span>
    </div>
  );
}
