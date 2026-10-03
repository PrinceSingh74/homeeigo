import { logger } from "../../lib/logger";
import { scheduledReportDeliveryService } from "../../services/scheduled-report-delivery.service";
import type { ReportPeriod } from "../../services/executive-reporting.service";
import type { ScheduledJobContext } from "../core/job-registry";

export const EXECUTIVE_REPORT_JOB_TYPE = "report.executive_brief";

/** Periods the report generator actually supports. Anything else is refused, not coerced. */
const ALLOWED_PERIODS: ReadonlySet<string> = new Set([
  "daily", "weekly", "monthly", "quarterly", "yearly",
]);

/**
 * Phase 9, Capability 11 — the scheduled executive report job.
 *
 * ── What the payload may and may not say ───────────────────────────────────────
 *
 * A payload may name a **period**, and nothing else. It cannot name a recipient, an admin id, an
 * organisation, a channel, or an address: those are derived inside
 * `scheduledReportDeliveryService`, from the admin role table. A `ScheduledJob` row is exactly the
 * kind of record that gets hand-edited during an incident, so the blast radius of a forged payload
 * is deliberately one enum.
 *
 * An unrecognised period is refused rather than defaulted. Silently falling back to "daily" would
 * mean a corrupted payload still produced a plausible-looking report.
 *
 * ── Why this handler is thin ───────────────────────────────────────────────────
 *
 * Duplicate ticks, concurrent workers, lease recovery, retry with backoff and the dead-letter path
 * are all `processScheduledJobBatch`'s job, and the leader lock is `runScheduledJobTick`'s. This
 * handler adds none of that. It is registered with the one scheduler the platform has, and the one
 * thing it owns is refusing a payload it should not trust.
 *
 * ── Why it does not throw on a refusal ─────────────────────────────────────────
 *
 * The schedule is UNSET and the feature flag is off; both are the correct shipped state. Throwing
 * would retry three times and then dead-letter the job — a permanent red mark for something nobody
 * has got wrong. The refusal is logged with its reason and the job completes.
 */
export async function executiveReportJobHandler(
  payload: Record<string, unknown>,
  ctx: ScheduledJobContext,
): Promise<void> {
  const raw = payload.period;
  const period = typeof raw === "string" && ALLOWED_PERIODS.has(raw) ? (raw as ReportPeriod) : null;

  if (raw !== undefined && period === null) {
    logger.warn("executive_report_job_rejected_period", { jobId: ctx.jobId, period: String(raw).slice(0, 40) });
    return;
  }

  const run = await scheduledReportDeliveryService.run(period ?? "daily", {
    now: new Date(),
    jobId: ctx.jobId,
  });

  if (!run.ran) {
    logger.info("executive_report_job_refused", {
      jobId: ctx.jobId,
      reason: run.refusedReason,
      scheduleStatus: run.scheduleStatus,
      flagEnabled: run.flagEnabled,
    });
    return;
  }

  logger.info("executive_report_job_completed", {
    jobId: ctx.jobId,
    period,
    reportState: run.report?.state,
    items: run.report?.items.length ?? 0,
    recipients: run.deliveries.length,
    // Every delivery is a rehearsal; the counts say which verdict each one drew.
    outcomes: run.deliveries.reduce<Record<string, number>>((acc, d) => {
      acc[d.state] = (acc[d.state] ?? 0) + 1;
      return acc;
    }, {}),
  });
}
