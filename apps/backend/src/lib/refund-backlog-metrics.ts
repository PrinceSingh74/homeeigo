/**
 * Standing refund backlog — the population a human has to work through, not the rate of new events.
 *
 * `refund_indeterminate_total` already existed, but it is a COUNTER: it answers "how many became
 * indeterminate" and never "how many are still sitting there". On 2026-09-21 there were 53
 * INDETERMINATE refunds aged 16–35 days and 250 FAILED at max retry — 303 actionable rows — and no
 * series anywhere expressed that standing figure, so no alert could be written against it.
 *
 * INDETERMINATE is the status that most needs a person. It means the gateway was called and never
 * gave a definite answer, so the customer may or may not have been paid; the refund orchestrator
 * treats it as terminal for automation precisely to avoid a double refund. Nothing will move it
 * except a human reconciling against the provider.
 *
 * Ages are measured in whole days from `created_at` so an alert can key on "older than N days"
 * without inventing a threshold in PromQL.
 */
import { analyticsWhere } from "./analytics-scope";
import { registerScrapeSampler, setGauge } from "./metrics";

/** Beyond this, an unresolved refund is a backlog item rather than work in progress. */
const STALE_AFTER_DAYS = 2;

export function initRefundBacklogMetricsAtZero(): void {
  // Seeded so a dashboard shows a healthy zero rather than NO-DATA before the first scrape. An
  // absent series and "nothing is stuck" look identical on a panel, and only one is good news.
  for (const status of ["INDETERMINATE", "FAILED", "PROCESSING", "REQUESTED", "UNDER_REVIEW", "APPROVED"]) {
    setGauge("homigo_refund_backlog", 0, { status });
    setGauge("homigo_refund_backlog_nonbusiness", 0, { status });
  }
  setGauge("homigo_refund_backlog_actionable", 0);
  setGauge("homigo_refund_indeterminate_open", 0);
  setGauge("homigo_refund_indeterminate_oldest_days", 0);
}

export function registerRefundBacklogSamplers(): void {
  registerScrapeSampler(async () => {
    try {
      const { default: prisma } = await import("./prisma");

      /**
       * Scoped to the business population, which changes what these alerts mean.
       *
       * Measured on 2026-09-21 against the live database: **97.1%** of `refund_requests` are
       * certification or test artifacts — including **all 250** FAILED rows and **all 53**
       * INDETERMINATE ones. The three alerts added in the previous pass were verified as
       * "non-vacuous, every one fires on the current state", and they did fire. They were pointing
       * operators at certification rows.
       *
       * An alert that pages a human to investigate a test fixture is worse than an alert that never
       * fires, because it fires, gets investigated, gets found to be nothing, and teaches everyone
       * that this alert means nothing. The backlog that matters is the backlog a person can act on.
       *
       * The non-business rows are still published, under their own series, because "97% of the
       * refund table is test data" is itself worth watching — it just is not a refund incident.
       */
      const grouped = await prisma.refundRequest.groupBy({
        by: ["status"],
        where: analyticsWhere(),
        _count: { _all: true },
      });
      const groupedNonBusiness = await prisma.refundRequest.groupBy({
        by: ["status"],
        where: analyticsWhere("NON_BUSINESS"),
        _count: { _all: true },
      });

      let actionable = 0;
      for (const row of grouped) {
        const status = String(row.status);
        const n = row._count._all;
        setGauge("homigo_refund_backlog", n, { status });
        // Mirrors RefundWorkflowService.ACTIONABLE_STATUSES — the set the admin queue draws from.
        if (["REQUESTED", "UNDER_REVIEW", "APPROVED", "PROCESSING", "FAILED", "INDETERMINATE"].includes(status)) {
          actionable += n;
        }
      }
      setGauge("homigo_refund_backlog_actionable", actionable);
      for (const row of groupedNonBusiness) {
        setGauge("homigo_refund_backlog_nonbusiness", row._count._all, { status: String(row.status) });
      }

      /**
       * INDETERMINATE gets its own series and an age. The count alone understates it: 53 rows that
       * appeared this morning is an incident in progress, and 53 rows that have been there a month
       * is money nobody has accounted for.
       */
      const indeterminate = await prisma.refundRequest.findMany({
        where: { status: "INDETERMINATE", ...analyticsWhere() },
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 1000,
      });
      setGauge("homigo_refund_indeterminate_open", indeterminate.length);

      const oldest = indeterminate[0]?.createdAt;
      const oldestDays = oldest ? Math.floor((Date.now() - oldest.getTime()) / 86_400_000) : 0;
      setGauge("homigo_refund_indeterminate_oldest_days", oldestDays);

      const staleCutoff = new Date(Date.now() - STALE_AFTER_DAYS * 86_400_000);
      setGauge(
        "homigo_refund_indeterminate_stale",
        indeterminate.filter((r) => r.createdAt < staleCutoff).length,
      );
    } catch {
      /* DB unavailable — leave the previous values rather than reporting a false zero. */
    }
  });
}
