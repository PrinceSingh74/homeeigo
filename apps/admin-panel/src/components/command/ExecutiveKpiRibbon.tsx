"use client";

import { memo, useEffect, useRef, useState } from "react";
import {
  Radio,
  IndianRupee,
  ShoppingBag,
  CircleCheck,
  Ban,
  RotateCcw,
  Wifi,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import type { ExecKpis } from "@/services/admin-api";
import { Icon3D, type Icon3DTone } from "@/components/hq/Icon3D";
import { cn } from "@/lib/cn";

type Tone = "good" | "warn" | "bad" | "accent" | "cyan";

const ICON_TONE: Record<Tone, Icon3DTone> = {
  good: "success",
  warn: "warning",
  bad: "danger",
  accent: "success",
  cyan: "cyan",
};

const METER: Record<Tone, string> = {
  good: "biz-meter--success",
  warn: "biz-meter--warning",
  bad: "biz-meter--danger",
  accent: "biz-meter--success",
  cyan: "",
};

function Stat({
  label,
  value,
  tone,
  icon: Icon,
  meter,
}: {
  label: string;
  value: string;
  tone: Tone;
  icon: LucideIcon;
  meter?: number;
}) {
  return (
    <div className={cn("cmd-card cmd-kpi", `cmd-kpi--${tone}`)}>
      <div className="flex items-center justify-between gap-2">
        <span className="cmd-kpi-label">{label}</span>
        <Icon3D icon={Icon} tone={ICON_TONE[tone]} size="sm" />
      </div>
      <span className="cmd-kpi-value" data-stat-value>
        {value}
      </span>
      {meter != null ? (
        <div className={cn("biz-meter cmd-kpi-meter", METER[tone])}>
          <span style={{ width: `${Math.max(4, Math.min(100, meter))}%` }} />
        </div>
      ) : null}
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
    return <div className="cmd-card cmd-kpi-skeleton" aria-hidden />;
  }

  const completionTone: Tone =
    kpis.completionRate >= 70 ? "good" : kpis.completionRate >= 45 ? "warn" : "bad";
  const cancelTone: Tone =
    kpis.cancellationRate <= 20 ? "good" : kpis.cancellationRate <= 40 ? "warn" : "bad";
  const refundTone: Tone =
    kpis.refundRate <= 10 ? "good" : kpis.refundRate <= 30 ? "warn" : "bad";

  return (
    <div className="cmd-kpi-ribbon">
      <div className="cmd-card cmd-kpi-brand">
        <Icon3D icon={Radio} tone="success" size="sm" />
        <div className="min-w-0 leading-tight">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--cmd-ink)" }}>
            <span className={cn("cmd-live-dot", pulse && "scale-125")} />
            Live
          </p>
          <p className="mt-1 truncate text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--cmd-muted)" }}>
            {freshness ? new Date(freshness).toLocaleTimeString() : "synced"}
            {confidence != null ? ` · ${Math.round(confidence * 100)}%` : ""}
          </p>
        </div>
      </div>
      <Stat label="GMV" value={inr(kpis.gmv)} tone="accent" icon={IndianRupee} />
      <Stat label="Orders" value={num(kpis.bookingsToday)} tone="cyan" icon={ShoppingBag} />
      <Stat label="Completion" value={pct(kpis.completionRate)} tone={completionTone} icon={CircleCheck} meter={kpis.completionRate} />
      <Stat label="Cancel" value={pct(kpis.cancellationRate)} tone={cancelTone} icon={Ban} meter={kpis.cancellationRate} />
      <Stat label="Refund" value={pct(kpis.refundRate)} tone={refundTone} icon={RotateCcw} meter={kpis.refundRate} />
      <Stat label="Providers" value={num(kpis.onlineProviders)} tone="good" icon={Wifi} />
      <Stat label="Customers" value={num(kpis.activeCustomers)} tone="accent" icon={Users} />
    </div>
  );
}

export const ExecutiveKpiRibbon = memo(ExecutiveKpiRibbonInner);
