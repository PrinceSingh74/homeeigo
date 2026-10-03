import { logger } from "../lib/logger";
import { routeNotification } from "../notifications/router";
import { evaluateFlag } from "./feature-flag.service";
import { resolveReportRecipients, type ReportRecipient } from "./scheduled-report-recipients";
import {
  scheduledExecutiveReportService,
  REPORT_REASON,
  type ExecutiveReportBundle,
  type ReportDeliveryState,
} from "./scheduled-executive-report.service";
import {
  executiveReportSchedule,
  reportScheduleRefusal,
  REPORT_HUMAN_DECISIONS,
  SCHEDULED_EXECUTIVE_REPORTS_STATE,
} from "./executive-report-schedule.config";
import type { ReportPeriod } from "./executive-reporting.service";
import { windowDateFor, CADENCE_DEFAULT_TIMEZONE } from "../notifications/governance/timezone";

/**
 * Phase 9, Capability 11 — delivering a scheduled executive report.
 *
 * ── Three gates, in order, and the order matters ───────────────────────────────
 *
 * 1. The **feature flag**, because a disabled capability should cost nothing. `evaluateFlag` is
 *    already fail-closed: a missing row, an unreadable store and an unparseable rollout all return
 *    false, so the shipped state (no row in `platform_feature_flags`) is off.
 * 2. The **schedule**, because an approved flag with no approved time is still not a decision.
 * 3. The **recipients**, derived from the admin role table — never from a payload.
 *
 * A report is built only after all three pass. Building first and gating later would mean a disabled
 * capability still ran nine service reads on every tick.
 *
 * ── Why every delivery is SHADOW ───────────────────────────────────────────────
 *
 * `executionMode: "SHADOW"` is not a placeholder to remove later. Under shadow the router runs the
 * identical decision path — template, recipient, quiet hours, cooldown, cap, channel selection — and
 * replaces only the three places something durable happens: the delivery claim, the cadence
 * reservation, and the provider call. So the evidence is real and the message is not sent.
 *
 * Going LIVE requires a human to approve a schedule and enable a flag. Neither is done here, and
 * `LIVE` is not reachable from this module: the mode is a literal, not a parameter.
 *
 * ── Nothing here touches an adapter ────────────────────────────────────────────
 *
 * No SMTP, no Expo, no SMS, no Slack. This module names a recipient by id and a message by template
 * and hands both to `routeNotification`, which is the only way anything leaves the platform.
 */

export const REPORT_FEATURE_FLAG = "ADMIN_EXECUTIVE_SCHEDULED_REPORTS" as const;

export type ReportDeliveryRecord = {
  recipientUserId: string;
  adminId: string;
  roleName: string;
  basis: ReportRecipient["basis"];
  state: ReportDeliveryState;
  reasonCode: string;
  channel: string | null;
};

export type ScheduledReportRun = {
  ran: boolean;
  /** Why nothing happened, when nothing happened. Null on a run that produced a report. */
  refusedReason: string | null;
  flagEnabled: boolean;
  scheduleStatus: string;
  capabilityState: typeof SCHEDULED_EXECUTIVE_REPORTS_STATE;
  report: ExecutiveReportBundle | null;
  deliveries: ReportDeliveryRecord[];
  humanDecisions: string[];
  generatedAt: string;
};

/** Maps the router's verdict onto the report's own delivery vocabulary. Nothing is reinterpreted. */
function deliveryStateFor(status: string, reasonCode: string | undefined): ReportDeliveryState {
  if (status === "SENT") return "SENT";
  if (status === "FAILED") return "FAILED";
  if (reasonCode === "QUIET_HOURS") return "WOULD_DEFER";
  if (reasonCode === "RECIPIENT_DAILY_CAP" || reasonCode === "WORKFLOW_COOLDOWN") return "WOULD_SUPPRESS";
  if (status === "SKIPPED") return "SKIPPED";
  return "WOULD_SEND";
}

export const scheduledReportDeliveryService = {
  /**
   * Run one scheduled report.
   *
   * Returns a record of what it decided rather than throwing, because "the schedule is unset" is the
   * correct state today and turning it into an error would put a permanent failure in the job
   * table for something nobody has got wrong.
   */
  async run(
    period: ReportPeriod = "daily",
    opts?: { now?: Date; jobId?: string },
  ): Promise<ScheduledReportRun> {
    const now = opts?.now ?? new Date();
    const generatedAt = now.toISOString();
    const base = {
      capabilityState: SCHEDULED_EXECUTIVE_REPORTS_STATE,
      scheduleStatus: executiveReportSchedule.status,
      humanDecisions: [...REPORT_HUMAN_DECISIONS],
      generatedAt,
      report: null,
      deliveries: [] as ReportDeliveryRecord[],
    };

    const flag = await evaluateFlag(REPORT_FEATURE_FLAG);
    if (!flag.enabled) {
      return { ...base, ran: false, refusedReason: REPORT_REASON.FLAG_DISABLED, flagEnabled: false };
    }

    const refusal = reportScheduleRefusal();
    if (refusal) {
      return { ...base, ran: false, refusedReason: refusal, flagEnabled: true };
    }

    const recipients = await resolveReportRecipients();
    if (recipients.length === 0) {
      return { ...base, ran: false, refusedReason: REPORT_REASON.NO_RECIPIENTS, flagEnabled: true };
    }

    const report = await scheduledExecutiveReportService.build(period, { now });
    const deliveries = await this.deliver(report, recipients, { now, jobId: opts?.jobId });

    return {
      ...base,
      ran: true,
      refusedReason: null,
      flagEnabled: true,
      report,
      deliveries,
      humanDecisions: [...new Set([...REPORT_HUMAN_DECISIONS, ...report.humanDecisions])],
    };
  },

  /**
   * Hand one report to the router, once per derived recipient.
   *
   * ── Idempotency identity ───────────────────────────────────────────────────
   *
   * The key is `report:<type>:<period>:<window>:<version>:<recipient>`. Each part earns its place:
   * two administrators are two operations, two periods are two reports, and a rules-version change
   * is a different document about the same window. The window is a date string rather than the
   * generation instant, so a duplicate scheduler tick within the same period is the *same*
   * operation and a genuinely new period is not.
   *
   * It is deliberately not derived from the report's content: two identical-looking briefs on
   * consecutive days are still two briefs, and content-hashing would silently swallow the second.
   */
  async deliver(
    report: ExecutiveReportBundle,
    recipients: ReportRecipient[],
    opts?: { now?: Date; jobId?: string },
  ): Promise<ReportDeliveryRecord[]> {
    const now = opts?.now ?? new Date();
    const window = windowKeyFor(report.period, now);
    const out: ReportDeliveryRecord[] = [];

    const counts = {
      factCount: String(report.items.filter((i) => i.kind === "FACT").length),
      warningCount: String(report.items.filter((i) => i.kind === "WARNING").length),
      recommendationCount: String(report.items.filter((i) => i.kind === "RECOMMENDATION").length),
    };

    for (const r of recipients) {
      const idempotencyKey =
        `report:${report.reportType}:${report.period}:${window}:` +
        `${report.versions.reportRulesVersion}:${r.userId}`;

      try {
        const result = await routeNotification({
          recipientType: "ADMIN",
          recipientId: r.userId,
          notificationType: "admin.executive_report",
          variables: {
            periodLabel: report.period,
            reportState: report.state,
            ...counts,
          },
          idempotencyKey,
          // SHADOW is a literal, not a parameter. Nothing in this file can send.
          executionMode: "SHADOW",
          // Named so the shadow evidence row is attributable to this capability rather than
          // landing in the automation table as "unknown".
          workflowId: "report.executive_brief",
          workflowVersion: 1,
          workflowInstanceId: opts?.jobId ?? `report:${window}`,
          shadowStepId: "deliver",
          subjectType: "REPORT",
          subjectId: `${report.reportType}:${window}`,
        });

        out.push({
          recipientUserId: r.userId,
          adminId: r.adminId,
          roleName: r.roleName,
          basis: r.basis,
          state: deliveryStateFor(result.status, result.reasonCode),
          reasonCode: result.reasonCode ?? "UNKNOWN",
          channel: result.channel ?? null,
        });
      } catch (err) {
        // One recipient's failure must not deprive the others of their report.
        logger.warn("scheduled_report_delivery_failed", {
          recipient: r.userId,
          error: String(err).slice(0, 200),
        });
        out.push({
          recipientUserId: r.userId,
          adminId: r.adminId,
          roleName: r.roleName,
          basis: r.basis,
          state: "FAILED",
          reasonCode: REPORT_REASON.SOURCE_UNAVAILABLE,
          channel: null,
        });
      }
    }
    return out;
  },
};

/**
 * The period window a report belongs to.
 *
 * ── Which clock, and the decision that is missing ──────────────────────────────
 *
 * `CADENCE_DEFAULT_TIMEZONE` is the platform's existing default and is reused here rather than
 * invented. It is **not** a claim that the timezone question is settled: `timezoneStrategy` is UNSET
 * and `EXECUTIVE_REPORT_TIMEZONE_HUMAN_DECISION_REQUIRED` is carried on every run. Once a human
 * chooses `recipient-local`, this key becomes per-recipient and two administrators in different
 * zones will legitimately sit in different windows — which is why the recipient id is already part
 * of the idempotency key and this function is separate from it.
 *
 * A weekly window is keyed by its Monday, so every day of one week produces the same key. A monthly
 * window is keyed by the month. Getting this wrong in the other direction is the expensive failure:
 * a window that changes more often than the period would let one tick send a second report.
 */
export function windowKeyFor(period: ReportPeriod, instant: Date): string {
  const day = windowDateFor(instant, CADENCE_DEFAULT_TIMEZONE); // YYYY-MM-DD
  if (period === "weekly") {
    const d = new Date(`${day}T00:00:00Z`);
    // getUTCDay(): 0 = Sunday. Shift so Monday starts the week.
    const shift = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - shift);
    return `W${d.toISOString().slice(0, 10)}`;
  }
  if (period === "monthly") return day.slice(0, 7);
  if (period === "quarterly") {
    const month = Number(day.slice(5, 7));
    return `${day.slice(0, 4)}Q${Math.floor((month - 1) / 3) + 1}`;
  }
  if (period === "yearly") return day.slice(0, 4);
  return day;
}
