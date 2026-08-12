"use client";

import { memo } from "react";
import { cn } from "@/lib/cn";
import type { ExecutiveViewMode } from "./ExecutiveKpiGrid";

const MODES: { id: ExecutiveViewMode; label: string }[] = [
  { id: "default", label: "Live" },
  { id: "board", label: "Board" },
  { id: "investor", label: "Investor" },
  { id: "weekly", label: "Weekly" },
];

export const ViewModeSwitcher = memo(function ViewModeSwitcher({
  mode,
  onChange,
}: {
  mode: ExecutiveViewMode;
  onChange: (mode: ExecutiveViewMode) => void;
}) {
  return (
    <div className="biz-segment" role="tablist" aria-label="Executive view mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={mode === m.id}
          onClick={() => onChange(m.id)}
          className={cn("biz-segment-btn", mode === m.id && "is-active")}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
});
