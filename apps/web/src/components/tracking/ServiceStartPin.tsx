"use client";

import { useEffect, useState } from "react";
import { m as motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, Clock3, ShieldCheck, Sparkles } from "lucide-react";
import { useStartPinQuery } from "@/hooks/use-core-data";
import { cn } from "@/lib/utils";

/**
 * The customer's service-start PIN (Urban-Company style).
 *
 * The partner cannot begin work until the customer reads this PIN back to them
 * in person — it is dispatched the moment the partner taps "Start job". This
 * card polls quietly and lights up the instant a PIN goes live.
 *
 * Variants:
 *  - full   → bookings detail modal (explains all three states)
 *  - compact→ home Live-Tracking card (renders only when a PIN is live)
 */
export function ServiceStartPin({
  bookingId,
  proName,
  variant = "full",
  showWaiting = false,
  className,
}: {
  bookingId: string;
  proName?: string | null;
  variant?: "full" | "compact";
  /** Compact only: also render the "protection on" waiting card (e.g. once the partner has arrived). */
  showWaiting?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion() ?? false;
  const query = useStartPinQuery(bookingId);
  const data = query.data;

  /* Live countdown to PIN expiry. */
  const [now, setNow] = useState(() => Date.now());
  const expiresMs = data?.expiresAt ? new Date(data.expiresAt).getTime() : null;
  useEffect(() => {
    if (data?.state !== "active" || !expiresMs) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [data?.state, expiresMs]);

  if (!data) return null;

  const secondsLeft = expiresMs ? Math.max(0, Math.floor((expiresMs - now) / 1000)) : null;
  const countdown =
    secondsLeft != null
      ? `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`
      : null;
  const isActive = data.state === "active" && Boolean(data.pin) && (secondsLeft ?? 1) > 0;
  const partnerLabel = proName?.trim() || "your professional";

  // The compact home card earns its space only when there is something to act
  // on — unless the caller wants the waiting card too (partner at the door).
  if (variant === "compact" && !isActive && data.state !== "verified" && !showWaiting) return null;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        // `shrink-0` is load-bearing: inside height-capped flex columns (home
        // live-tracking panel) an `overflow-hidden` flex child has min-height 0
        // and gets crushed to 0px — the PIN would silently disappear.
        "relative shrink-0 overflow-hidden rounded-2xl ring-1",
        isActive
          ? "bg-gradient-to-br from-emerald-500/[0.08] via-teal-500/[0.05] to-transparent ring-emerald-500/25"
          : data.state === "verified"
            ? "bg-emerald-500/[0.06] ring-emerald-500/20"
            : "bg-surface/60 ring-line",
        className,
      )}
    >
      {/* soft ambient glow while a PIN is live */}
      {isActive && (
        <span
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-10 size-36 rounded-full bg-emerald-400/15 blur-2xl"
        />
      )}

      {data.state === "verified" ? (
        <div className={cn("flex items-center gap-3", variant === "compact" ? "p-3" : "p-4")}>
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600">
            <CheckCircle2 size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-content">PIN verified</p>
            <p className="text-xs text-muted">
              {partnerLabel.charAt(0).toUpperCase() + partnerLabel.slice(1)} has started your
              service.
            </p>
          </div>
        </div>
      ) : isActive ? (
        <div className={cn(variant === "compact" ? "p-3.5" : "p-4 sm:p-5")}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/30">
                <ShieldCheck size={18} />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">
                  Service start PIN
                </p>
                <p className="text-xs font-medium text-muted">
                  Share in person with {partnerLabel}
                </p>
              </div>
            </div>
            {countdown && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold tabular-nums text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300">
                <Clock3 size={11} />
                {countdown}
              </span>
            )}
          </div>

          <div className="mt-3.5 flex justify-center gap-1.5 sm:gap-2">
            {(data.pin ?? "").split("").map((digit, i) => (
              <motion.span
                key={`${i}-${digit}`}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduce ? 0 : 0.05 * i, duration: 0.25 }}
                className={cn(
                  "grid place-items-center rounded-xl bg-white font-display font-bold text-emerald-700 shadow-sm ring-1 ring-emerald-500/25 dark:bg-white/10 dark:text-emerald-300",
                  variant === "compact"
                    ? "h-10 w-8 text-lg"
                    : "h-12 w-10 text-xl sm:h-14 sm:w-11 sm:text-2xl",
                )}
              >
                {digit}
              </motion.span>
            ))}
          </div>

          <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted">
            <Sparkles size={12} className="mt-0.5 shrink-0 text-emerald-600" />
            Only share this PIN face-to-face at your door. HOMEEIGO staff will never call or
            message asking for it.
          </p>
        </div>
      ) : (
        /* waiting — PIN not requested yet (full variant only) */
        <div className="flex items-center gap-3 p-4">
          <span className="relative grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600">
            {!reduce && (
              <span className="absolute size-2 animate-ping rounded-full bg-emerald-500/60" />
            )}
            <ShieldCheck size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-content">Start PIN protection is on</p>
            <p className="text-xs leading-relaxed text-muted">
              When {partnerLabel} is ready to begin, a 6-digit PIN will appear here — share it
              with them in person to start the service.
            </p>
          </div>
        </div>
      )}
    </motion.div>
  );
}
