"use client";

import { m as motion } from "framer-motion";
import { Search, UserCheck, Bike, MapPin, Wrench, CheckCircle2 } from "lucide-react";

/**
 * Six-stage service journey, premium glass styling. Maps backend booking/tracking
 * statuses → the canonical customer-facing stages:
 *   Searching → Assigned → En Route → Arrived → Started → Completed
 */
export type JourneyStage = "SEARCHING" | "ASSIGNED" | "EN_ROUTE" | "ARRIVED" | "STARTED" | "COMPLETED";

const STAGES: { key: JourneyStage; label: string; sub: string; Icon: typeof Search }[] = [
  { key: "SEARCHING", label: "Searching", sub: "Finding your pro", Icon: Search },
  { key: "ASSIGNED", label: "Assigned", sub: "Pro confirmed", Icon: UserCheck },
  { key: "EN_ROUTE", label: "En Route", sub: "On the way", Icon: Bike },
  { key: "ARRIVED", label: "Arrived", sub: "At your door", Icon: MapPin },
  { key: "STARTED", label: "Started", sub: "Service running", Icon: Wrench },
  { key: "COMPLETED", label: "Completed", sub: "All done", Icon: CheckCircle2 },
];

/** Normalise any backend booking/tracking status to a journey stage. */
export function toJourneyStage(status: string | null | undefined): JourneyStage {
  const s = (status ?? "").toUpperCase();
  if (["COMPLETED", "DONE"].includes(s)) return "COMPLETED";
  if (["IN_PROGRESS", "STARTED", "SERVICE_STARTED"].includes(s)) return "STARTED";
  if (["ARRIVED", "REACHED"].includes(s)) return "ARRIVED";
  if (["EN_ROUTE", "ON_THE_WAY", "ONTHEWAY"].includes(s)) return "EN_ROUTE";
  if (["ASSIGNED", "ACCEPTED", "CONFIRMED", "NOT_STARTED"].includes(s)) return "ASSIGNED";
  return "SEARCHING";
}

export function BookingJourney({ status, className = "" }: { status: string | null | undefined; className?: string }) {
  const stage = toJourneyStage(status);
  const currentIdx = STAGES.findIndex((s) => s.key === stage);
  const progressPct = STAGES.length > 1 ? (currentIdx / (STAGES.length - 1)) * 100 : 0;

  return (
    <div className={`rounded-2xl border border-white/10 bg-slate-900/60 p-4 backdrop-blur-xl ${className}`}>
      <div className="relative">
        {/* connector track */}
        <div className="absolute left-5 right-5 top-5 h-0.5 -translate-y-1/2 bg-white/10" />
        <motion.div
          className="absolute left-5 top-5 h-0.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-sky-400 to-blue-500"
          initial={false}
          animate={{ width: `calc(${progressPct}% - ${progressPct > 0 ? 0 : 0}px)` }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
          style={{ maxWidth: "calc(100% - 2.5rem)" }}
        />
        <ol className="relative flex justify-between">
          {STAGES.map((s, i) => {
            const done = i < currentIdx;
            const active = i === currentIdx;
            const Icon = s.Icon;
            return (
              <li key={s.key} className="flex w-0 flex-1 flex-col items-center gap-1.5 text-center">
                <motion.span
                  initial={false}
                  animate={{ scale: active ? 1.12 : 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 18 }}
                  className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
                    done
                      ? "border-emerald-400/60 bg-emerald-500 text-white"
                      : active
                        ? "border-sky-300/70 bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-lg shadow-sky-500/30"
                        : "border-white/15 bg-slate-800 text-slate-400"
                  }`}
                >
                  {active ? (
                    <motion.span
                      className="absolute inset-0 rounded-full bg-sky-400/40"
                      animate={{ scale: [1, 1.6], opacity: [0.5, 0] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                    />
                  ) : null}
                  <Icon size={17} className="relative" />
                </motion.span>
                <span className={`text-[11px] font-semibold leading-tight ${active ? "text-white" : done ? "text-slate-300" : "text-slate-500"}`}>
                  {s.label}
                </span>
                <span className={`hidden text-[10px] leading-tight sm:block ${active ? "text-sky-300" : "text-slate-600"}`}>{s.sub}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
