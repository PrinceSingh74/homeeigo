import { Clock, Layers, ListChecks } from "lucide-react";
import { jobSelectionRows } from "@/lib/job-selection";
import type { PartnerBooking, PartnerJobBrief } from "@/types/partner";

function minutes(n: number): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/**
 * What the customer booked, from the booking's immutable selection snapshot (backend
 * partnerJobBrief). Only execution facts — no prices, no catalogue configuration.
 */
export function JobBrief({
  job,
  compact = false,
  booking,
}: {
  job: PartnerJobBrief | undefined;
  compact?: boolean;
  /** With the booking, the full selection summary (service, option, quantity, add-ons, slot) is listed row by row. */
  booking?: Pick<PartnerBooking, "service" | "scheduledDate" | "job">;
}) {
  // One reader of the frozen selection for both layouts (lib/job-selection).
  const rows = jobSelectionRows(booking ?? { scheduledDate: "", job });
  if (booking && !compact) {
    if (!rows.length) return null;
    return (
      <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]" data-testid="job-brief">
        {rows.map((r) => (
          <div key={r.key} className="contents">
            <dt className="text-partner-muted">{r.label}</dt>
            <dd className="font-medium text-partner-text" data-testid={`job-brief-${r.key}`}>
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  if (!job) return null;
  const selection = rows
    .filter((r) => r.key === "option" || r.key === "quantity" || r.key === "audience")
    .map((r) => (r.key === "audience" ? `for ${r.value}` : r.value));
  const d = job.duration;
  const hasBreakdown = Boolean(d && (d.preparationMinutes > 0 || d.cleanupMinutes > 0 || d.addonMinutes > 0));
  if (!selection.length && !job.addons.length && !job.durationMinutes) return null;
  return (
    <div className={compact ? "mt-2 space-y-1 text-xs" : "space-y-2 text-sm"} data-testid="job-brief">
      {selection.length > 0 && (
        <p className="flex items-center gap-1.5 font-medium text-partner-text">
          <Layers className="h-3.5 w-3.5 text-partner-primary" />
          {selection.join(" · ")}
        </p>
      )}
      {job.addons.length > 0 && (
        <p className="flex items-center gap-1.5 text-partner-text-secondary">
          <ListChecks className="h-3.5 w-3.5 text-partner-primary" />
          {job.addons.map((a) => (a.quantity > 1 ? `${a.name} × ${a.quantity}` : a.name)).join(" · ")}
        </p>
      )}
      {job.durationMinutes ? (
        <p className="flex items-center gap-1.5 text-partner-muted">
          <Clock className="h-3.5 w-3.5" />
          Expected {minutes(job.durationMinutes)}
          {!compact && hasBreakdown && d
            ? ` (prep ${minutes(d.preparationMinutes)} · service ${minutes(d.serviceMinutes)}${
                d.addonMinutes ? ` · add-ons ${minutes(d.addonMinutes)}` : ""
              } · clean-up ${minutes(d.cleanupMinutes)})`
            : ""}
        </p>
      ) : null}
    </div>
  );
}
