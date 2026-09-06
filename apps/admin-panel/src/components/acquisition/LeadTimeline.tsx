"use client";

import { cn } from "@/lib/cn";
import { relTime } from "@/lib/lead-crm-utils";
import type { PartnerLeadDetail } from "@/services/admin-api";

const TYPE_ICONS: Record<string, string> = {
  CALL: "📞",
  MESSAGE: "💬",
  STATUS_CHANGE: "↔",
  ASSIGNMENT: "👤",
  FOLLOW_UP: "📅",
  NOTE: "📝",
  DUPLICATE_CHECK: "⚠",
  APPLICATION_LINKED: "📋",
  SYSTEM: "•",
};

export function LeadTimeline({
  activities,
  className,
  limit,
}: {
  activities: PartnerLeadDetail["activities"];
  className?: string;
  limit?: number;
}) {
  const items = limit ? activities.slice(0, limit) : activities;

  if (!items.length) {
    return (
      <p className={cn("text-sm text-[var(--color-biz-muted)]", className)}>
        No activity yet. Contact or assign this lead to start the timeline.
      </p>
    );
  }

  return (
    <ol className={cn("relative space-y-0", className)}>
      {items.map((a, i) => (
        <li key={a.id} className="relative flex gap-3 pb-4 last:pb-0">
          {i < items.length - 1 ? (
            <span
              className="absolute left-[11px] top-6 bottom-0 w-px bg-[var(--color-biz-line)]"
              aria-hidden
            />
          ) : null}
          <span
            className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)] text-[10px]"
            aria-hidden
          >
            {TYPE_ICONS[a.type] ?? "•"}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-sm font-medium leading-snug">{a.title}</p>
            <p className="mt-0.5 text-[11px] text-[var(--color-biz-faint)]">
              {new Date(a.createdAt).toLocaleString("en-IN", {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "numeric",
                minute: "2-digit",
              })}
              {a.actorId ? ` · ${a.actorId.slice(0, 8)}` : ""}
            </p>
            {a.description ? (
              <p className="mt-1.5 rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)]/50 px-2.5 py-2 text-xs text-[var(--color-biz-muted)]">
                {a.description}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function LeadTimelineCompact({ lastAt }: { lastAt?: string | null }) {
  return <span className="text-[11px] text-[var(--color-biz-muted)]">{relTime(lastAt)}</span>;
}
