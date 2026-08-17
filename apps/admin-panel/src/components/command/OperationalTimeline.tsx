"use client";

import { memo, useMemo } from "react";
import { AlertTriangle, Zap, Activity } from "lucide-react";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import type { FraudData, SurgeZone } from "@/services/admin-api";
import { Icon3D } from "@/components/hq/Icon3D";

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
    <div className="cmd-card cmd-timeline">
      <span className="flex shrink-0 items-center gap-2 pr-1 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--cmd-muted)" }}>
        <Icon3D icon={Activity} tone="cyan" size="sm" /> Live Ops
      </span>
      {events.length === 0 ? (
        <span className="text-xs" style={{ color: "var(--cmd-muted)" }}>No operational events in the current window.</span>
      ) : (
        events.slice(0, 20).map((e, i) => (
          <div key={i} className={`cmd-event-chip cmd-event-chip--${e.kind}`}>
            {e.kind === "fraud" ? (
              <AlertTriangle size={11} className="text-[var(--color-biz-danger)]" />
            ) : (
              <Zap size={11} className="text-[var(--color-biz-warning)]" />
            )}
            <span>{e.text}</span>
            <span className="text-[var(--color-biz-faint)]">
              {new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

export const OperationalTimeline = memo(OperationalTimelineInner);
