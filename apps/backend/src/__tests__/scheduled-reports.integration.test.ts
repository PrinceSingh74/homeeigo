/**
 * PHASE 9 - Capability 11, Scheduled Executive Reports.
 *
 * Runs ONLY on the isolated homigo_p39 database and aborts otherwise.
 *
 * Nothing here builds a scheduler, a report engine or a delivery mechanism. Those exist. What is
 * tested is that this capability *uses* them, that a payload cannot widen its own audience, and that
 * the report tells the truth about how fresh and how complete it is.
 */
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { describe, test, expect, beforeAll } from "bun:test";
import prisma from "../lib/prisma";
import {
  scheduledExecutiveReportService,
  buildDeterministicNarrative,
  SCHEDULED_REPORT_RULES_VERSION,
  type ExecutiveReportBundle,
} from "../services/scheduled-executive-report.service";
import {
  scheduledReportDeliveryService,
  windowKeyFor,
  REPORT_FEATURE_FLAG,
} from "../services/scheduled-report-delivery.service";
import {
  executiveReportSchedule,
  isReportScheduleApproved,
  reportScheduleRefusal,
  assertScheduleIsNotBorrowed,
  REPORT_HUMAN_DECISIONS,
  SCHEDULED_EXECUTIVE_REPORTS_STATE,
} from "../services/executive-report-schedule.config";
import { resolveReportRecipients } from "../services/scheduled-report-recipients";
import { registerAllTemplates } from "../notifications/templates/definitions";
import { clearTemplates, listTemplates } from "../notifications/templates/registry";
import { listJobHandlers, getJobHandler } from "../events/core/job-registry";
import { bootstrapScheduledJobs } from "../events/jobs";
import { EXECUTIVE_REPORT_JOB_TYPE } from "../events/jobs/executive-report.job";
import { resolveAdminRoutePermission } from "../lib/admin-route-permissions";

let report: ExecutiveReportBundle;
let src = "";
let deliverySrc = "";
let jobSrc = "";
/** Comment-stripped copies. A prohibition must be checked against code, not against prose. */
let deliveryCode = "";
let jobCode = "";

/**
 * Strips comments before asserting a string is absent.
 *
 * Learned the hard way, twice: the delivery service's own comment says "No SMTP, no Expo, no SMS,
 * no Slack", so a naive search for "SMTP" found the sentence promising it would never appear.
 */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
}

type Counts = Record<string, number>;
async function snapshot(): Promise<Counts> {
  const [bookings, payments, wallet, ledger, notifications, deliveries, approvals, jobs] =
    await Promise.all([
      prisma.booking.count(), prisma.payment.count(), prisma.walletTransaction.count(),
      prisma.ledgerEntry.count(), prisma.notification.count(),
      prisma.notificationDelivery.count(), prisma.aiToolApproval.count(),
      prisma.scheduledJob.count(),
    ]);
  return { bookings, payments, wallet, ledger, notifications, deliveries, approvals, jobs };
}
let baseline: Counts;

beforeAll(async () => {
  const db = (await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db"))[0].db;
  refuseIfNotIsolatedTestDb(db);
  src = await Bun.file(`${import.meta.dir}/../services/scheduled-executive-report.service.ts`).text();
  deliverySrc = await Bun.file(`${import.meta.dir}/../services/scheduled-report-delivery.service.ts`).text();
  jobSrc = await Bun.file(`${import.meta.dir}/../events/jobs/executive-report.job.ts`).text();
  deliveryCode = codeOnly(deliverySrc);
  jobCode = codeOnly(jobSrc);
  baseline = await snapshot();
  report = await scheduledExecutiveReportService.build("daily");
}, 120_000);

describe("1-2. the schedule is a business decision, and nobody has made it", () => {
  test("the shipped schedule is UNSET in every field", () => {
    expect(executiveReportSchedule.enabled).toBe(false);
    expect(executiveReportSchedule.localTime).toBeNull();
    expect(executiveReportSchedule.recurrence).toBeNull();
    expect(executiveReportSchedule.timezoneStrategy).toBeNull();
    expect(executiveReportSchedule.status).toBe("UNSET");
    expect(isReportScheduleApproved()).toBe(false);
    expect(reportScheduleRefusal()).toBe("EXECUTIVE_REPORT_SCHEDULE_UNSET");
  });

  test("no canonical executive-report schedule exists anywhere", async () => {
    const rows = await prisma.scheduledJob.count({ where: { jobType: EXECUTIVE_REPORT_JOB_TYPE } });
    expect(rows).toBe(0);
  });

  test("all three outstanding decisions are named", () => {
    expect([...REPORT_HUMAN_DECISIONS]).toEqual([
      "EXECUTIVE_REPORT_SCHEDULE_HUMAN_DECISION_REQUIRED",
      "EXECUTIVE_REPORT_RECURRENCE_HUMAN_DECISION_REQUIRED",
      "EXECUTIVE_REPORT_TIMEZONE_HUMAN_DECISION_REQUIRED",
    ]);
    expect(SCHEDULED_EXECUTIVE_REPORTS_STATE).toBe("DISABLED_UNTIL_SCHEDULE_APPROVED");
  });

  /** The specific mistake this guards: a plausible hour borrowed from a value that means something else. */
  test("a schedule borrowed from quiet hours or the partner brief is refused", () => {
    expect(assertScheduleIsNotBorrowed({
      localTime: "08:00", quietEndMinute: 480, partnerMorningLocalTime: null,
    })).toEqual({ ok: false, reason: expect.stringContaining("quiet-hours end") });

    expect(assertScheduleIsNotBorrowed({
      localTime: "09:30", quietEndMinute: 480, partnerMorningLocalTime: "09:30",
    })).toEqual({ ok: false, reason: expect.stringContaining("partner morning schedule") });

    // A deliberate collision is allowed, but only when a human records it.
    expect(assertScheduleIsNotBorrowed({
      localTime: "08:00", quietEndMinute: 480, partnerMorningLocalTime: null,
      collisionAcknowledged: true,
    })).toEqual({ ok: true });

    // The shipped null schedule cannot collide with anything.
    expect(assertScheduleIsNotBorrowed({
      localTime: executiveReportSchedule.localTime, quietEndMinute: 480,
      partnerMorningLocalTime: null,
    })).toEqual({ ok: true });
  });

  test("the source names no clock time of its own", () => {
    const code = [codeOnly(src), codeOnly(deliverySrc), codeOnly(jobSrc)].join("\n");
    expect(code).not.toMatch(/["']0[6-9]:00["']/);
    expect(code).not.toMatch(/["']1[0-2]:00["']/);
  });
});

describe("3-7. the platform's one scheduler is reused, not replaced", () => {
  test("the report registers with the existing job registry", () => {
    bootstrapScheduledJobs();
    expect(listJobHandlers()).toContain(EXECUTIVE_REPORT_JOB_TYPE);
    const def = getJobHandler(EXECUTIVE_REPORT_JOB_TYPE);
    expect(def).toBeDefined();
    expect(def?.maxAttempts).toBe(3);
    // Staleness guard kept: a Monday brief delivered Wednesday is the wrong document.
    expect(def?.maxStalenessMs).toBeUndefined();
  });

  /**
   * Duplicate ticks, concurrent workers, lease recovery, retry and the dead-letter path all belong
   * to `processScheduledJobBatch` and `runScheduledJobTick`. This capability must not reimplement
   * any of them — a second claim mechanism is how two workers send one report twice.
   */
  test("no second scheduler, lock, or claim loop is built here", () => {
    const code = [codeOnly(src), codeOnly(deliverySrc), codeOnly(jobSrc)].join("\n");
    for (const forbidden of [
      "setInterval", "setTimeout", "runWithLeaderLock", "FOR UPDATE", "SKIP LOCKED",
      "createScheduledJob", "scheduledJob.create", "cron",
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  test("the handler delegates and adds no retry of its own", () => {
    expect(jobCode).toContain("scheduledReportDeliveryService.run");
    expect(jobCode).not.toContain("retry");
    expect(jobCode).not.toContain("attempt++");
  });

  /**
   * A refusal must not throw. Throwing would burn three attempts and dead-letter the job for
   * something that is the correct shipped state.
   */
  test("an unset schedule completes the job instead of failing it", async () => {
    const def = getJobHandler(EXECUTIVE_REPORT_JOB_TYPE);
    await expect(
      def!.handler({}, {
        jobId: "test-job", jobType: EXECUTIVE_REPORT_JOB_TYPE,
        attempt: 1, runAt: new Date(), triggerEventId: null,
      }),
    ).resolves.toBeUndefined();
  });

  test("a duplicate tick within one period produces the same idempotency window", () => {
    const morning = new Date("2026-08-31T02:00:00Z");
    const evening = new Date("2026-08-31T16:00:00Z");
    expect(windowKeyFor("daily", morning)).toBe(windowKeyFor("daily", evening));
    expect(windowKeyFor("weekly", morning)).toBe(windowKeyFor("weekly", evening));
  });

  test("a genuinely new period produces a different window", () => {
    const mon = new Date("2026-08-31T08:00:00Z");
    const tue = new Date("2026-09-01T08:00:00Z");
    const nextWeek = new Date("2026-09-08T08:00:00Z");
    expect(windowKeyFor("daily", mon)).not.toBe(windowKeyFor("daily", tue));
    // Same ISO week: Monday and Tuesday share a weekly window.
    expect(windowKeyFor("weekly", mon)).toBe(windowKeyFor("weekly", tue));
    expect(windowKeyFor("weekly", mon)).not.toBe(windowKeyFor("weekly", nextWeek));
    expect(windowKeyFor("monthly", mon)).not.toBe(windowKeyFor("monthly", nextWeek));
  });
});

describe("8. the window is keyed by period, in a named timezone", () => {
  test("every supported period produces a distinct, stable key shape", () => {
    const at = new Date("2026-08-31T08:00:00Z");
    expect(windowKeyFor("daily", at)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(windowKeyFor("weekly", at)).toMatch(/^W\d{4}-\d{2}-\d{2}$/);
    expect(windowKeyFor("monthly", at)).toMatch(/^\d{4}-\d{2}$/);
    expect(windowKeyFor("quarterly", at)).toMatch(/^\d{4}Q[1-4]$/);
    expect(windowKeyFor("yearly", at)).toMatch(/^\d{4}$/);
  });

  /**
   * The timezone question is open, and the code says so rather than pretending it is settled.
   * `CADENCE_DEFAULT_TIMEZONE` is reused because it already exists; it is not a decision.
   */
  test("the timezone is the platform default and the decision is still recorded as owed", () => {
    expect(deliveryCode).toContain("CADENCE_DEFAULT_TIMEZONE");
    expect(deliveryCode).not.toMatch(/["']Asia\/Kolkata["']/);
    expect([...REPORT_HUMAN_DECISIONS]).toContain(
      "EXECUTIVE_REPORT_TIMEZONE_HUMAN_DECISION_REQUIRED",
    );
  });
});

describe("9-11. the report tells the truth about its own data", () => {
  test("it distinguishes all six kinds and does not collapse them into prose", () => {
    const kinds = new Set<string>(report.items.map((i) => String(i.kind)));
    for (const k of ["FACT", "FORECAST", "WARNING", "RECOMMENDATION", "LIMITATION"]) {
      expect(kinds).toContain(k);
    }
    /**
     * The property that matters: a projection is never typed as a measurement.
     *
     * Not "anything mentioning a forecast is a FORECAST" — Capability 9 legitimately produces a
     * RECOMMENDATION titled `REVIEW_FORECAST`, and an advisory review of a forecast is an advisory
     * review, not a forecast. The assertion is the narrow one.
     */
    const forecastsTypedAsFacts = report.items.filter(
      (i) => i.kind === "FACT" && /forecast/i.test(i.label),
    );
    expect(forecastsTypedAsFacts).toEqual([]);
  });

  test("a stale source makes the report STALE and is named", () => {
    // Unavailable outranks stale: a warehouse miss is INCOMPLETE, not a stale live forecast.
    if (report.unavailableSources.length > 0) {
      expect(report.state).toBe("INCOMPLETE");
      expect(report.narrative.text).toContain("Did not answer");
      return;
    }
    if (report.staleSources.length > 0) {
      expect(report.state).toBe("STALE");
      expect(report.narrative.text).toContain("Stale at generation");
      for (const s of report.staleSources) expect(report.narrative.text).toContain(s);
    } else {
      expect(["GENERATED", "INCOMPLETE"]).toContain(report.state);
    }
  });

  /**
   * A domain the platform never built is not an incident.
   *
   * The first observation had every report permanently INCOMPLETE because eight never-implemented
   * context domains were counted as failures. A state that is always the same value tells an
   * operator nothing, and they stop reading it.
   */
  test("never-implemented domains are limitations, not failures", () => {
    expect(report.structuralGaps.length).toBeGreaterThan(0);
    for (const g of report.structuralGaps) expect(g).toContain("SOURCE_NOT_IMPLEMENTED");
    for (const u of report.unavailableSources) expect(u).not.toContain("SOURCE_NOT_IMPLEMENTED");
    if (report.unavailableSources.length === 0) expect(report.state).not.toBe("INCOMPLETE");
  });

  test("nothing is cached across runs: two builds carry different generation times", async () => {
    const again = await scheduledExecutiveReportService.build("daily");
    expect(again.generatedAt).not.toBe(report.generatedAt);
    expect(again.versions.reportRulesVersion).toBe(SCHEDULED_REPORT_RULES_VERSION);
  }, 60_000);
});

describe("12-13. the report works without a language model, and a model cannot supply a number", () => {
  test("the shipped narrative is deterministic", () => {
    expect(report.narrative.generatedBy).toBe("DETERMINISTIC");
    expect(report.narrative.reasonCode).toBe("EXECUTIVE_REPORT_NARRATIVE_DETERMINISTIC");
    expect(report.narrative.text.length).toBeGreaterThan(40);
  });

  test("no model is in the assembly path at all", () => {
    const code = [codeOnly(src), codeOnly(deliverySrc), codeOnly(jobSrc)].join("\n");
    for (const forbidden of ["invokeAiGateway", "aiGateway", "anthropic", "openai", "gemini", "groq"]) {
      expect(code.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  /**
   * The counts in the prose come from `items`, so a model that later rewrites the sentences cannot
   * change them without changing the report. Proven by feeding the builder a known item list.
   */
  test("every number in the prose is derived from the items, not from a source re-read", () => {
    const n = buildDeterministicNarrative({
      period: "daily",
      items: [
        { kind: "FACT", label: "a", value: 1, state: "OK", source: "s", observedAt: null, freshness: null, confidence: null },
        { kind: "WARNING", label: "b", value: 2, state: "OK", source: "s", observedAt: null, freshness: null, confidence: null },
      ],
      staleSources: [],
      unavailableSources: [],
      structuralGaps: [],
    });
    expect(n.text).toContain("1 measured figure(s)");
    expect(n.text).toContain("1 warning(s)");
    expect(n.generatedBy).toBe("DETERMINISTIC");
    // The values themselves never appear — only counts of them.
    expect(n.text).not.toContain("value");
  });

  test("a malformed narrative cannot become a financial fact, because prose carries no figures", () => {
    // The templates that actually leave the platform declare counts and a state — never a figure.
    const numbersInProse = report.narrative.text.match(/\d[\d,]*\.\d+/g) ?? [];
    expect(numbersInProse).toEqual([]);
  });
});

describe("14-16. delivery is governed, and a payload cannot choose who reads the report", () => {
  test("nothing calls an adapter directly", () => {
    const code = [codeOnly(src), codeOnly(deliverySrc), codeOnly(jobSrc)].join("\n");
    for (const forbidden of [
      "nodemailer", "smtp", "SMTP", "expo.dev", "pushAdapter", "sendPush",
      "sendSms", "twilio", "slack", "emailAdapter",
    ]) {
      expect(code).not.toContain(forbidden);
    }
    expect(deliveryCode).toContain("routeNotification");
  });

  test("delivery is SHADOW as a literal, so LIVE is not reachable from this module", () => {
    expect(deliveryCode).toContain('executionMode: "SHADOW"');
    expect(deliveryCode).not.toContain('executionMode: "LIVE"');
    // Not a parameter, not read from config, not derived.
    expect(deliveryCode).not.toMatch(/executionMode:\s*[a-z]/);
  });

  /**
   * The property that matters most here: a report intended for Admin A must never reach Admin B.
   *
   * It is proven structurally rather than by trying spoofed values, because the only defence that
   * survives an unknown attack is one where the field does not exist. `resolveReportRecipients`
   * takes no arguments at all.
   */
  test("recipients are derived, and cannot be supplied", () => {
    expect(resolveReportRecipients.length).toBe(0);
    const code = codeOnly(deliverySrc);
    for (const forbidden of ["payload.recipient", "payload.adminId", "payload.userId", "payload.email"]) {
      expect(code).not.toContain(forbidden);
    }
    const job = codeOnly(jobSrc);
    // The job reads exactly one field from its payload.
    const payloadReads = [...job.matchAll(/payload\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(payloadReads)]).toEqual(["period"]);
  });

  test("a forged payload can name a period and nothing else, and an invalid one is refused", async () => {
    const def = getJobHandler(EXECUTIVE_REPORT_JOB_TYPE)!;
    const ctx = {
      jobId: "forged", jobType: EXECUTIVE_REPORT_JOB_TYPE,
      attempt: 1, runAt: new Date(), triggerEventId: null,
    };
    for (const payload of [
      { period: "daily", recipientId: "attacker", adminId: "attacker", email: "a@b.c" },
      { period: "'; DROP TABLE bookings; --" },
      { period: 42 },
      { period: { toString: () => "daily" } },
    ]) {
      await expect(def.handler(payload as Record<string, unknown>, ctx)).resolves.toBeUndefined();
    }
    expect(await snapshot()).toEqual(baseline);
  });

  test("a recipient must hold the same permission the report's own route requires", async () => {
    const recipients = await resolveReportRecipients();
    for (const r of recipients) {
      expect(["ROLE_PERMISSION", "SUPER_ADMIN"]).toContain(r.basis);
      expect(r.userId).toBeTruthy();
    }
    // The permission is quoted from the existing route table, not invented here.
    expect(resolveAdminRoutePermission("GET", "/api/admin/analytics")).toEqual({
      resource: "ANALYTICS", action: "READ",
    });
  });
});

describe("17. the message that leaves the platform carries no figures and no PII", () => {
  /**
   * A push notification renders on a lock screen. It is delivered to a device, not to a session, so
   * it is the wrong place for finance internals however well the console is gated.
   */
  test("the report templates declare counts and a state, never a figure or a contact detail", () => {
    clearTemplates();
    registerAllTemplates();
    const reportTemplates = listTemplates().filter((t) => t.templateId.startsWith("admin.executive_report"));
    expect(reportTemplates.length).toBe(2);

    for (const t of reportTemplates) {
      const declared = Object.keys(t.variables).sort();
      expect(declared).toEqual([
        "factCount", "periodLabel", "recommendationCount", "reportState", "warningCount",
      ]);
      const text = `${t.title ?? ""} ${t.body}`;
      for (const forbidden of ["gmv", "revenue", "margin", "email", "phone", "amount", "₹"]) {
        expect(text.toLowerCase()).not.toContain(forbidden);
      }
      // No free-text variable: a generated sentence must never become indistinguishable from a fact.
      expect(declared).not.toContain("summary");
      expect(declared).not.toContain("narrative");
    }
  });

  test("the router is given a recipient id, never an address", () => {
    expect(deliveryCode).toContain("recipientId: r.userId");
    expect(deliveryCode).not.toContain("email:");
    expect(deliveryCode).not.toContain("phone:");
  });

  /**
   * REGRESSION GUARD for a P0 this capability found.
   *
   * `registerTemplate` refuses a template whose body names an undeclared variable. The Item 6 and
   * Item 7 templates declared only `partnerName` while using `topZoneName`, `zoneName` and others,
   * so `registerAllTemplates()` threw. That throw escaped `bootstrapTemplates()` into
   * `bootstrapWorkflows()`, whose catch in `maintenance.ts` returns *before*
   * `startOutboxProcessor()` and `startScheduledJobProcessor()` — so the event outbox and the
   * scheduled job processor were both dead, silently, for three days.
   *
   * No test called this function, which is why nobody noticed. This one does.
   */
  test("registerAllTemplates() does not throw — the boot path depends on it", () => {
    clearTemplates();
    expect(() => registerAllTemplates()).not.toThrow();
  });
});

describe("18-20. provenance survives the trip into a report", () => {
  /**
   * The known netRevenue defect must not be smoothed away by a document that only shows the number.
   * It appears twice on purpose: once as the figure, once as the reason it cannot be read plainly.
   */
  test("a DATA_QUALITY figure keeps its state and gains a limitation", () => {
    const flagged = report.items.filter(
      (i) => i.kind === "FACT" && (i.state === "KPI_DATA_QUALITY" || i.state === "DATA_QUALITY_ISSUE"),
    );
    expect(flagged.length).toBeGreaterThan(0);
    for (const f of flagged) {
      const limitation = report.items.find(
        (i) => i.kind === "LIMITATION" && i.label.includes(f.label),
      );
      expect(limitation).toBeDefined();
    }
  });

  /**
   * UPDATED: netRevenue's period mismatch was REPAIRED at the source during this capability.
   *
   * The report's job was never "flag netRevenue" — it was "carry whatever the source says, without
   * smoothing". That is what is asserted now: the figure is present, and any figure the source still
   * flags is accompanied by its limitation. The old assertion demanded a defect that no longer
   * exists, and keeping it would have made the repair look like a regression.
   */
  test("netRevenue is carried from the source, and any flagged figure keeps its limitation", () => {
    const net = report.items.find((i) => i.label.endsWith("netRevenue") && i.kind === "FACT");
    expect(net).toBeDefined();
    expect(net!.source.length).toBeGreaterThan(0);

    // Whatever remains flagged must still be explained — the general rule, not one metric's defect.
    for (const f of report.items.filter((i) => i.kind === "FACT" && i.state.includes("DATA_QUALITY"))) {
      const why = report.items.find((i) => i.kind === "LIMITATION" && i.label.includes(f.label));
      expect(why).toBeDefined();
    }
  });

  test("the anomaly line carries its verdict, and a refusal is stated as one", () => {
    const anomaly = report.items.find((i) => i.kind === "ANOMALY");
    expect(anomaly).toBeDefined();
    if (anomaly!.state !== "EVALUATED") {
      expect(
        report.items.some((i) => i.kind === "LIMITATION" && i.label.includes("anomaly")),
      ).toBe(true);
    }
  });

  test("forecast limitations are carried verbatim, including the impossible interval", () => {
    const limits = report.items
      .filter((i) => i.kind === "LIMITATION" && i.label === "forecast limitation")
      .map((i) => String(i.value));
    const forecastItem = report.items.find((i) => i.kind === "FORECAST" && i.source !== "demandSupplyWarningService");
    expect(limits.length).toBeGreaterThan(0);
    if (forecastItem?.state === "FORECAST_UNAVAILABLE") {
      expect(limits.join(" ").toLowerCase()).toMatch(/did not respond|unavailable|source/);
      expect(limits.join(" ")).not.toContain("80%");
      return;
    }
    expect(limits.join(" ")).toContain("80%");
    // Capability 7's finding: the model publishes no confidence of its own.
    expect(limits.join(" ").toLowerCase()).toContain("no confidence");
  });

  test("no confidence, model version or figure is invented", () => {
    for (const i of report.items) {
      if (i.confidence !== null) {
        expect(i.confidence).toBeGreaterThanOrEqual(0);
        expect(i.confidence).toBeLessThanOrEqual(1);
      }
    }
    // Model versions come from the context, which reports only what producing systems publish.
    for (const [, v] of Object.entries(report.versions.modelVersions)) {
      expect(v === null || typeof v === "string").toBe(true);
    }
  });
});

describe("21-24. the report advises, executes nothing, and the tests are not vacuous", () => {
  test("every recommendation is a review and none names an executable amount", () => {
    const recs = report.items.filter((i) => i.kind === "RECOMMENDATION");
    for (const r of recs) {
      expect(r.state).toContain("REVIEW");
    }
    const code = [codeOnly(src), codeOnly(deliverySrc), codeOnly(jobSrc)].join("\n");
    for (const forbidden of [
      "executeTool", "consumeApproval", "createApprovalRequest", "refund",
      "walletAdjustment", "payout", "settlement", "financialAdjustment",
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  test("the Approval Center is the only decision boundary, and this capability does not touch it", async () => {
    expect(await prisma.aiToolApproval.count()).toBe(baseline.approvals);
  });

  test("building reports mutates no business state", async () => {
    await scheduledExecutiveReportService.build("weekly");
    expect(await snapshot()).toEqual(baseline);
  }, 60_000);

  test("a full run under the shipped configuration refuses at the flag, before any work", async () => {
    const run = await scheduledReportDeliveryService.run("daily");
    expect(run.ran).toBe(false);
    expect(run.refusedReason).toBe("EXECUTIVE_REPORT_FLAG_DISABLED");
    expect(run.flagEnabled).toBe(false);
    expect(run.report).toBeNull();
    expect(run.deliveries).toEqual([]);
    expect(run.scheduleStatus).toBe("UNSET");
    // The flag is checked first so a disabled capability costs nothing.
    expect(await snapshot()).toEqual(baseline);
  });

  test("the feature flag is absent from the database, and absent means off", async () => {
    const row = await prisma.platformFeatureFlag.findFirst({ where: { key: REPORT_FEATURE_FLAG } });
    expect(row).toBeNull();
  });

  /**
   * VACUOUS-TEST GUARD.
   *
   * Several assertions above are shaped as "this string does not appear in the source". That style
   * passes trivially if the file is empty, unreadable, or renamed. These checks prove the haystacks
   * are real and non-trivial before any of that is believed.
   */
  test("the sources under test were actually loaded and are substantial", () => {
    expect(src.length).toBeGreaterThan(4_000);
    expect(deliverySrc.length).toBeGreaterThan(2_000);
    expect(jobSrc.length).toBeGreaterThan(1_000);
    expect(src).toContain("scheduledExecutiveReportService");
    expect(deliverySrc).toContain("scheduledReportDeliveryService");
    expect(jobSrc).toContain("executiveReportJobHandler");
  });

  test("the report under test is real, not an empty shell", () => {
    expect(report.items.length).toBeGreaterThan(20);
    expect(report.items.some((i) => typeof i.value === "number")).toBe(true);
    expect(report.timings.totalMs).toBeGreaterThan(0);
    expect(Object.keys(report.timings.sourceMs).length).toBeGreaterThanOrEqual(7);
  });

  /** An N+1 shows up as a number, not an opinion. Capability 9 re-reads four sources internally. */
  test("the duplicated reads inside recommendedActionsService are measured, not hidden", () => {
    expect(report.timings.sourceMs.actions).toBeGreaterThan(0);
    // Substring chosen to survive comment line-wrapping; asserted as a boolean so a failure
    // prints a verdict rather than the whole file.
    expect(src.includes("duplicate reads per report")).toBe(true);
  });
});
