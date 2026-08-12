"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import type { ExecKpis } from "@/services/admin-api";

type Tone = "good" | "warn" | "bad" | "neutral";
const toneCls: Record<Tone, string> = {
  good: "text-emerald-400",
  warn: "text-amber-400",
  bad: "text-red-400",
  neutral: "text-sky-300",
};

function Stat({ label, value, tone, fmt }: { label: string; value: number; tone: Tone; fmt: (n: number) => string }) {
  return (
    <div className="flex min-w-[7.5rem] flex-col px-3.5 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <span className={`mt-0.5 font-mono text-lg font-bold tabular-nums ${toneCls[tone]}`}>{fmt(value)}</span>
    </div>
  );
}

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const pct = (n: number) => `${n.toFixed(1)}%`;
const num = (n: number) => Math.round(n).toLocaleString("en-IN");

function kpiFingerprint(kpis: ExecKpis): string {
  return [
    kpis.gmv,
    kpis.bookingsToday,
    kpis.completionRate,
    kpis.cancellationRate,
    kpis.refundRate,
    kpis.onlineProviders,
    kpis.activeCustomers,
  ].join(":");
}

function ExecutiveKpiRibbonInner({
  kpis,
  freshness,
  confidence,
}: {
  kpis: ExecKpis | null;
  freshness?: string;
  confidence?: number;
}) {
  useRenderProbe("ExecutiveKpiRibbon");
  useMountProbe("ExecutiveKpiRibbon");
  const [pulse, setPulse] = useState(false);
  const prevFp = useRef<string | null>(null);

  useEffect(() => {
    if (!kpis) return;
    const fp = kpiFingerprint(kpis);
    if (prevFp.current !== null && prevFp.current !== fp) {
      setPulse(true);
      const t = window.setTimeout(() => setPulse(false), 2000);
      prevFp.current = fp;
      return () => window.clearTimeout(t);
    }
    prevFp.current = fp;
  }, [kpis]);

  if (!kpis) {
    return <div className="flex h-14 items-center px-4 text-sm text-slate-500">Loading executive KPIs…</div>;
  }

  const completionTone: Tone = kpis.completionRate >= 70 ? "good" : kpis.completionRate >= 45 ? "warn" : "bad";
  const cancelTone: Tone = kpis.cancellationRate <= 20 ? "good" : kpis.cancellationRate <= 40 ? "warn" : "bad";
  const refundTone: Tone = kpis.refundRate <= 10 ? "good" : kpis.refundRate <= 30 ? "warn" : "bad";

  return (
    <div className="flex items-stretch gap-px overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/70 backdrop-blur-xl">
      <div className="flex items-center gap-2 px-4">
        <span className="relative flex h-2.5 w-2.5">
          <span
            className={`relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 transition-transform duration-300 ${pulse ? "scale-125 ring-2 ring-emerald-400/40" : ""}`}
          />
        </span>
        <div className="leading-tight">
          <p className="text-xs font-bold text-[var(--color-biz-text)]">COMMAND</p>
          <p className="text-[9px] text-slate-500">
            {freshness ? new Date(freshness).toLocaleTimeString() : "live"}
            {confidence != null ? ` · ${Math.round(confidence * 100)}%` : ""}
          </p>
        </div>
      </div>
      <Stat label="GMV" value={kpis.gmv} tone="neutral" fmt={inr} />
      <Stat label="Orders Today" value={kpis.bookingsToday} tone="neutral" fmt={num} />
      <Stat label="Completion" value={kpis.completionRate} tone={completionTone} fmt={pct} />
      <Stat label="Cancellation" value={kpis.cancellationRate} tone={cancelTone} fmt={pct} />
      <Stat label="Refund" value={kpis.refundRate} tone={refundTone} fmt={pct} />
      <Stat label="Online Providers" value={kpis.onlineProviders} tone="good" fmt={num} />
      <Stat label="Active Customers" value={kpis.activeCustomers} tone="neutral" fmt={num} />
    </div>
  );
}

export const ExecutiveKpiRibbon = memo(ExecutiveKpiRibbonInner);
