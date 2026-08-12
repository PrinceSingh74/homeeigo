"use client";

import { memo, useMemo } from "react";
import { AlertTriangle, Zap, Activity } from "lucide-react";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import type { FraudData, SurgeZone } from "@/services/admin-api";

type Event = { ts: number; kind: "fraud" | "surge"; text: string };

function buildEvents(fraud?: FraudData, surge?: SurgeZone[]): Event[] {
  const events: Event[] = [];
  for (const e of fraud?.events ?? []) {
    events.push({
      ts: Date.parse(e.ts.replace(" ", "T") + "Z") || Date.now(),
      kind: "fraud",
      text: `Fake-GPS · ${Math.round(e.implied_kmh)} km/h teleport (${e.jump_meters.toFixed(0)}m)`,
    });
  }
  for (const z of (surge ?? []).filter((s) => s.predictedSurge >= 1.5).slice(0, 5)) {
    events.push({
      ts: Date.now(),
      kind: "surge",
      text: `Surge ×${z.predictedSurge} active in ${z.name}`,
    });
  }
  events.sort((a, b) => b.ts - a.ts);
  return events;
}

function OperationalTimelineInner({ fraud, surge }: { fraud?: FraudData; surge?: SurgeZone[] }) {
  useRenderProbe("OperationalTimeline");
  useMountProbe("OperationalTimeline");
  const events = useMemo(() => buildEvents(fraud, surge), [fraud, surge]);

  return (
    <div className="flex h-full items-center gap-3 overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-2 backdrop-blur-xl">
      <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        <Activity size={13} className="text-sky-400" /> Live Ops
      </span>
      {events.length === 0 ? (
        <span className="text-xs text-slate-500">No operational events in the current window.</span>
      ) : (
        events.slice(0, 20).map((e, i) => (
          <div
            key={i}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-slate-800/60 px-3 py-1 text-[11px]"
          >
            {e.kind === "fraud" ? (
              <AlertTriangle size={11} className="text-red-400" />
            ) : (
              <Zap size={11} className="text-amber-400" />
            )}
            <span className="text-slate-200">{e.text}</span>
            <span className="text-slate-500">
              {new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

export const OperationalTimeline = memo(OperationalTimelineInner);
