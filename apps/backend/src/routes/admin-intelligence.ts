import { Elysia, t } from "elysia";
import { adminRbacPlugin } from "../middleware/admin-rbac";
import { scheduledExecutiveReportService } from "../services/scheduled-executive-report.service";
import { REPORT_FEATURE_FLAG } from "../services/scheduled-report-delivery.service";
import { resolveReportRecipients } from "../services/scheduled-report-recipients";
import { evaluateFlag } from "../services/feature-flag.service";
import {
  executiveReportSchedule,
  isReportScheduleApproved,
  REPORT_HUMAN_DECISIONS,
  SCHEDULED_EXECUTIVE_REPORTS_STATE,
} from "../services/executive-report-schedule.config";
import { EXECUTIVE_REPORT_JOB_TYPE } from "../events/jobs/executive-report.job";
import prisma from "../lib/prisma";
import type { ReportPeriod } from "../services/executive-reporting.service";

/**
 * Phase 9, Capability 12 — the HTTP surface for Phase-9 intelligence.
 *
 * ── Why this file has to exist ─────────────────────────────────────────────────
 *
 * Capabilities 1-11 built ten services with tests and **no route**. They were unreachable from the
 * admin panel, so "integrate the intelligence into Admin" begins by giving it a door. Discovery
 * confirmed it: a search for any of the ten services across `src/routes/` returned nothing.
 *
 * ── One request, not eleven ────────────────────────────────────────────────────
 *
 * There is a single brief endpoint rather than one per capability. `scheduledExecutiveReportService`
 * already composes all nine intelligence sources and builds the executive context **once**, handing
 * it to the KPI explainer instead of letting each card refetch. Nine endpoints would mean nine
 * context builds per page load — the N+1 this capability is required to avoid — and would invite a
 * second intelligence engine on the client to stitch them together.
 *
 * ── Permissions are quoted, not invented ───────────────────────────────────────
 *
 * `ANALYTICS` / `READ` is what the existing route table already assigns to every executive
 * intelligence read: `/finance/intelligence`, `/risk/intelligence`, `/growth/intelligence`,
 * `/analytics`, `/heatmap`, `/ops-map`. A brief that composes those sources must not be reachable by
 * anyone who could not have opened them individually. No new `AdminResource` value is introduced.
 *
 * ── Read-only ──────────────────────────────────────────────────────────────────
 *
 * Both handlers read. Neither creates a `ScheduledJob`, sends a notification, decides an approval, or
 * writes a feature flag. The schedule endpoint reports that the schedule is UNSET; it cannot set one.
 */
export const adminIntelligenceRoutes = new Elysia()
  .use(adminRbacPlugin)

  /**
   * The executive brief.
   *
   * `period` is validated against the periods the report generator actually supports and defaults to
   * `daily`. An unrecognised value is refused by the schema rather than coerced, so a spoofed period
   * cannot quietly change which window an executive is reading.
   */
  .get("/intelligence/executive-brief", async ({ query }) => {
    const period = (query.period ?? "daily") as ReportPeriod;
    const brief = await scheduledExecutiveReportService.build(period);
    return { success: true, data: brief };
  }, {
    query: t.Object({
      period: t.Optional(
        t.Union([
          t.Literal("daily"), t.Literal("weekly"), t.Literal("monthly"),
          t.Literal("quarterly"), t.Literal("yearly"),
        ]),
      ),
    }),
  })

  /**
   * The scheduled-report status.
   *
   * Reports what is true rather than what would be convenient to display: the schedule is UNSET, the
   * flag is off, no job of this type exists, and three business decisions are outstanding. The UI is
   * required to render "SCHEDULE NOT CONFIGURED" from this, and it cannot do that from a shape that
   * only carries a time.
   */
  .get("/intelligence/report-schedule", async () => {
    const [flag, jobs, recipients] = await Promise.all([
      evaluateFlag(REPORT_FEATURE_FLAG),
      prisma.scheduledJob.findMany({
        where: { jobType: EXECUTIVE_REPORT_JOB_TYPE },
        orderBy: { runAt: "desc" },
        take: 5,
        select: { id: true, status: true, runAt: true, completedAt: true, attempts: true, lastError: true },
      }),
      resolveReportRecipients(),
    ]);

    const lastRun = jobs.find((j) => j.completedAt !== null) ?? null;
    const nextRun = jobs.find((j) => j.status === "pending") ?? null;

    return {
      success: true,
      data: {
        capabilityState: SCHEDULED_EXECUTIVE_REPORTS_STATE,
        // Three separate nulls, not one. A UI that shows "not configured" for a missing hour while
        // hiding a missing recurrence would be telling half the truth.
        schedule: {
          status: executiveReportSchedule.status,
          approved: isReportScheduleApproved(),
          localTime: executiveReportSchedule.localTime,
          recurrence: executiveReportSchedule.recurrence,
          timezoneStrategy: executiveReportSchedule.timezoneStrategy,
        },
        featureFlag: { key: REPORT_FEATURE_FLAG, enabled: flag.enabled, reason: flag.reason },
        // Every delivery is a rehearsal until a human approves a schedule and enables the flag.
        deliveryMode: "SHADOW" as const,
        lastRun: lastRun
          ? { at: lastRun.completedAt, status: lastRun.status, attempts: lastRun.attempts }
          : null,
        nextRun: nextRun ? { at: nextRun.runAt } : null,
        recentJobs: jobs,
        recipientCount: recipients.length,
        humanDecisions: [...REPORT_HUMAN_DECISIONS],
      },
    };
  })

  /**
   * Recipients, without contact details.
   *
   * The role and the basis are what an administrator needs to audit who would receive the report;
   * an email address is not, and `resolveReportRecipients` never returns one. Only the user id
   * crosses this boundary, and only because the console links to the admin record.
   */
  .get("/intelligence/report-recipients", async () => {
    const recipients = await resolveReportRecipients();
    return {
      success: true,
      data: recipients.map((r) => ({
        userId: r.userId, adminId: r.adminId, roleName: r.roleName, basis: r.basis,
      })),
    };
  });
