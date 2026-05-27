"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TimelineEvent } from "@/lib/bookings";

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function BookingTimeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="space-y-0">
      {events.map((ev, i) => {
        const last = i === events.length - 1;
        return (
          <li key={ev.id} className="flex gap-4">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full border-2 transition-colors duration-500",
                  ev.done
                    ? "border-success bg-success text-white"
                    : "border-line bg-surface",
                )}
              >
                {ev.done && <Check size={12} strokeWidth={3} />}
              </span>
              {!last && (
                <span
                  className={cn(
                    "my-1 min-h-7 w-0.5 flex-1 rounded-full transition-colors duration-700",
                    ev.done ? "bg-success" : "bg-line",
                  )}
                />
              )}
            </div>
            <div className={cn("pb-6", last && "pb-0")}>
              <p
                className={cn(
                  "text-sm font-semibold transition-colors",
                  ev.done ? "text-content" : "text-muted",
                )}
              >
                {ev.label}
              </p>
              {ev.at ? (
                <p className="mt-0.5 text-xs text-muted">{formatTime(ev.at)}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
