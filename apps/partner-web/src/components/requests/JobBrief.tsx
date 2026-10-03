import { Clock, Layers, ListChecks } from "lucide-react";
import type { PartnerJobBrief } from "@/types/partner";

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
export function JobBrief({ job, compact = false }: { job: PartnerJobBrief | undefined; compact?: boolean }) {
  if (!job) return null;
  const selection = [
    job.variant,
    job.unit ? `${job.quantity} ${job.unit}` : job.quantity > 1 ? `× ${job.quantity}` : null,
    job.audience ? `for ${job.audience}` : null,
  ].filter(Boolean);
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
