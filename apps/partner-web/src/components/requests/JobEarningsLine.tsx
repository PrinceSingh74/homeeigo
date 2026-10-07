"use client";

import { IndianRupee, Loader2 } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { formatDate } from "@/lib/format";
import { earningAmountText, jobEarningsView } from "@/lib/job-earnings";
import type { PartnerJobEarning } from "@/types/partner";

/**
 * What this job paid, in the server's lines (gross, commission, a bonus or adjustment, net). Shown
 * only once the job is completed; before that it says so, and nothing is estimated here.
 */
export function JobEarningsLine({
  status,
  query,
}: {
  status: string;
  query: { data: PartnerJobEarning | null | undefined; isLoading: boolean; isError: boolean };
}) {
  const view = jobEarningsView(status, query);
  if (view.state === "hidden") return null;
  return (
    <PartnerCard hover={false}>
      <div data-testid="job-earnings" data-state={view.state} className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-partner-text">
          <IndianRupee className="h-4 w-4 text-partner-primary" aria-hidden="true" />
          Your earning for this job
        </p>
        {view.state === "loading" ? (
          <p role="status" className="flex items-center gap-2 text-sm text-partner-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
          </p>
        ) : view.state === "lines" ? (
          <>
            <dl className="divide-y divide-partner-line text-sm">
              {view.lines.map((line) => (
                <div key={line.key} className={`flex items-center justify-between gap-3 py-2 ${line.kind === "total" ? "font-semibold text-partner-text" : "text-partner-text-secondary"}`}>
                  <dt>{line.label}</dt>
                  <dd className="tabular-nums" data-testid={`job-earnings-${line.key}`}>
                    {earningAmountText(line)}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-partner-muted">
              {view.settlementLabel} · {formatDate(view.earnedAt)} · Invoice {view.invoiceNumber}
            </p>
          </>
        ) : (
          <p role={view.state === "error" ? "alert" : "status"} className="text-sm text-partner-muted">
            {view.message}
          </p>
        )}
      </div>
    </PartnerCard>
  );
}
