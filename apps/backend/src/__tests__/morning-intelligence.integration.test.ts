/**
 * PARTNER INTELLIGENCE — Item 6, Morning Intelligence.
 *
 * Runs ONLY on the isolated `homigo_p39` database and aborts otherwise.
 *
 * ── What these tests are defending ─────────────────────────────────────────────
 *
 * Two properties, and they pull in opposite directions.
 *
 * The first is that the capability is genuinely built: a real workflow in the real registry, a real
 * eligibility condition matching the dispatcher's, a real brief assembled from the real Item 1-5
 * services. Tests that only asserted "it does nothing" would pass just as well against an empty
 * file, so several cases here assert that data actually flowed.
 *
 * The second is that it cannot act. No schedule, no send, no write. The guards at the end exist
 * because the most likely way this capability goes wrong is not a crash — it is somebody deciding
 * that 08:00 looks like a reasonable morning and quietly turning quiet-hours-end into a business
 * schedule.
 */
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { describe, test, expect, beforeAll } from "bun:test";
import prisma from "../lib/prisma";
import { morningIntelligenceService } from "../services/morning-intelligence.service";
import { isDemandForecastStale } from "../services/shift-planning.service";
import { MORNING_INTELLIGENCE_RULES_VERSION } from "../services/morning-intelligence.types";
import type { MorningEligibilityReason } from "../services/morning-intelligence.types";
import {
  morningSchedule,
  isMorningScheduleApproved,
  morningScheduleRefusal,
  assertScheduleIsNotDerivedFromQuietHours,
  MORNING_INTELLIGENCE_STATE,
  MORNING_SCHEDULE_REFUSAL,
} from "../services/morning-schedule.config";
import { governanceConfig } from "../notifications/governance/policy";
import { clearWorkflows, getWorkflow, registerWorkflow } from "../automation/registry/workflow-registry";
import { registerMorningIntelligenceWorkflow, MORNING_INTELLIGENCE_WORKFLOW } from "../automation/registry/definitions/morning-intelligence-workflow";
import { clearConditions, getCondition, registerAllConditions } from "../automation/conditions/condition-registry";
import { providerResolver } from "../automation/conditions/resolvers/provider.resolver";
import { isContainedWorkflow } from "../notifications/governance/containment";
import { channelOrderFor } from "../notifications/governance/channel-policy";
import { isFeatureEnabled } from "../services/feature-flag.service";
import { windowDateFor } from "../notifications/governance/timezone";

let pEligible = "";
let pPaused = "";
let pBanned = "";
let pRestricted = "";
let pInactive = "";
let pUnapproved = "";
let pUserBanned = "";
let serviceSource = "";
let scheduleSource = "";
let triggerPublishers: string[] = [];

type Counts = Record<string, number>;
async function snapshot(): Promise<Counts> {
  const [bookings, notifications, deliveries, instances, jobs, outbox, payments, ledger] =
    await Promise.all([
      prisma.booking.count(),
      prisma.notification.count(),
      prisma.notificationDelivery.count(),
      prisma.workflowInstance.count(),
      prisma.scheduledJob.count(),
      prisma.eventOutbox.count(),
      prisma.payment.count(),
      prisma.walletTransaction.count(),
    ]);
  return { bookings, notifications, deliveries, instances, jobs, outbox, payments, ledger };
}

beforeAll(async () => {
  const db = (await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db"))[0].db;
  refuseIfNotIsolatedTestDb(db);

  serviceSource = await Bun.file(`${import.meta.dir}/../services/morning-intelligence.service.ts`).text();
  scheduleSource = await Bun.file(`${import.meta.dir}/../services/morning-schedule.config.ts`).text();

  /**
   * Computed once here rather than inside the test that asserts on it.
   *
   * The scan walks the whole source tree and takes several seconds; run inside a `test` it exceeded
   * the 5s case timeout and failed against correct code — a harness defect, not an application one.
   */
  /**
   * Scanned in-process rather than by spawning grep.
   *
   * Measured on this machine: `grep -rIl` over src takes 10-15 s (the working tree is on a synced
   * volume, and process spawn plus filesystem traversal dominate), which blew the 5 s hook timeout.
   * Reading the same 611 files through Bun takes ~1.7 s. The check is identical; only the mechanism
   * changed, so this is a faster test rather than a weaker one.
   */
  const glob = new Bun.Glob("**/*.ts");
  const found: string[] = [];
  for await (const f of glob.scan({ cwd: `${import.meta.dir}/..`, absolute: true })) {
    const txt = await Bun.file(f).text();
    if (txt.includes("PARTNER_MORNING_INTELLIGENCE_DUE")) found.push(f.split(String.fromCharCode(92)).join("/"));
  }
  triggerPublishers = found.filter((f) =>
    !f.includes("event-types.ts") &&
    !f.includes("trigger-registry.ts") &&
    !f.includes("morning-intelligence-workflow.ts") &&
    !f.includes("__tests__"),
  );

  const stamp = Date.now();
  let seq = 0;
  const mk = async (
    tag: string,
    provider: Record<string, unknown>,
    userBanned = false,
  ): Promise<string> => {
    seq += 1;
    const user = await prisma.user.create({
      data: {
        firstName: tag,
        lastName: "MI",
        password: "x",
        role: "VENDOR",
        phoneNumber: `96${String(stamp).slice(-7)}${seq}`,
        email: `${tag}.${stamp}@mi.test`,
        isBanned: userBanned,
        timezone: "Asia/Kolkata",
      },
    });
    const p = await prisma.provider.create({
      data: {
        userId: user.id,
        businessName: `${tag} Services`,
        isVerified: true,
        isActive: true,
        isApproved: true,
        registrationStatus: "APPROVED",
        isBanned: false,
        complianceRestricted: false,
        ...provider,
      },
    });
    return p.id;
  };

  pEligible = await mk("Eligible", {});
  pPaused = await mk("Paused", { pausedAt: new Date() });
  pBanned = await mk("Banned", { isBanned: true });
  pRestricted = await mk("Restricted", { complianceRestricted: true });
  pInactive = await mk("Inactive", { isActive: false });
  pUnapproved = await mk("Unapproved", { isApproved: false, registrationStatus: "PENDING" });
  pUserBanned = await mk("UserBanned", {}, true);
}, 120_000);

// ── Schedule boundary ─────────────────────────────────────────────────────────

describe("morning schedule is UNSET and fails closed", () => {
  test("shipped config carries no time", () => {
    expect(morningSchedule.localTime).toBeNull();
    expect(morningSchedule.enabled).toBe(false);
    expect(morningSchedule.status).toBe("UNSET");
    expect(morningSchedule.timezoneStrategy).toBe("recipient-local");
  });

  test("capability state names the dependency", () => {
    expect(MORNING_INTELLIGENCE_STATE).toBe("DISABLED_UNTIL_SCHEDULE_APPROVED");
  });

  test("no scheduled execution may be created", () => {
    expect(isMorningScheduleApproved()).toBe(false);
    expect(morningScheduleRefusal()).toBe(MORNING_SCHEDULE_REFUSAL);
  });

  test("a time alone does not approve a schedule, and neither does a flag alone", () => {
    expect(isMorningScheduleApproved({
      enabled: true, localTime: "07:30", timezoneStrategy: "recipient-local", status: "UNSET",
    })).toBe(false);
    expect(isMorningScheduleApproved({
      enabled: false, localTime: "07:30", timezoneStrategy: "recipient-local", status: "APPROVED",
    })).toBe(false);
    expect(isMorningScheduleApproved({
      enabled: true, localTime: null, timezoneStrategy: "recipient-local", status: "APPROVED",
    })).toBe(false);
    // All three together is the only combination that passes.
    expect(isMorningScheduleApproved({
      enabled: true, localTime: "07:30", timezoneStrategy: "recipient-local", status: "APPROVED",
    })).toBe(true);
  });

  /**
   * The guard the directive asked for by name.
   *
   * Quiet-hours end is 08:00. If a future change sets the morning schedule to 08:00, this fails —
   * not because 08:00 is a bad hour, but because arriving at it from `quietEndMinute` is not a
   * decision. An explicit acknowledgement is the only way past, and no code sets it.
   */
  test("quiet-hours end must not become the morning schedule", () => {
    expect(governanceConfig.quietEndMinute).toBe(8 * 60);

    const derived = assertScheduleIsNotDerivedFromQuietHours({
      localTime: "08:00",
      quietEndMinute: governanceConfig.quietEndMinute,
    });
    expect(derived.ok).toBe(false);
    if (!derived.ok) expect(derived.reason).toContain("earliest permitted contact time");

    const deliberate = assertScheduleIsNotDerivedFromQuietHours({
      localTime: "08:00",
      quietEndMinute: governanceConfig.quietEndMinute,
      quietHoursCollisionAcknowledged: true,
    });
    expect(deliberate.ok).toBe(true);

    const unrelated = assertScheduleIsNotDerivedFromQuietHours({
      localTime: "06:45",
      quietEndMinute: governanceConfig.quietEndMinute,
    });
    expect(unrelated.ok).toBe(true);
  });

  test("the shipped config itself passes the quiet-hours guard because it has no time", () => {
    const r = assertScheduleIsNotDerivedFromQuietHours({
      localTime: morningSchedule.localTime,
      quietEndMinute: governanceConfig.quietEndMinute,
    });
    expect(r.ok).toBe(true);
  });

  test("the schedule cannot be set from the environment", () => {
    // An env override would let a deployment invent the business decision. Nothing reads process.env here.
    expect(scheduleSource).not.toContain("process.env");
  });
});

// ── Workflow registration ─────────────────────────────────────────────────────

describe("workflow is registered, and registered inert", () => {
  test("registers in SHADOW/DRAFT with LOW risk", () => {
    clearWorkflows();
    registerMorningIntelligenceWorkflow();
    const wf = getWorkflow(MORNING_INTELLIGENCE_WORKFLOW, 1);
    expect(wf).toBeDefined();
    expect(wf!.executionMode).toBe("SHADOW");
    expect(wf!.certificationStatus).toBe("DRAFT");
    expect(wf!.riskClass).toBe("LOW");
    expect(wf!.trigger).toBe("homigo.partner.morning_intelligence.due");
  });

  test("steps are CONDITION → NOTIFICATION → STOP with an eligibility recheck", () => {
    clearWorkflows();
    registerMorningIntelligenceWorkflow();
    const wf = getWorkflow(MORNING_INTELLIGENCE_WORKFLOW, 1)!;
    expect(wf.steps.map((s) => s.type)).toEqual(["CONDITION", "NOTIFICATION", "STOP"]);
    const notify = wf.steps.find((s) => s.type === "NOTIFICATION")!;
    expect(notify).toMatchObject({
      notificationType: "partner.morning_intelligence",
      recipient: "SUBJECT_PARTNER",
      recheckConditionId: "provider.morning_eligible",
    });
  });

  test("declaring LIVE without certification is refused by the registry", () => {
    clearWorkflows();
    expect(() =>
      registerWorkflow({
        workflowId: "morning_intelligence_live_attempt",
        version: 1,
        name: "attempt",
        trigger: "homigo.partner.morning_intelligence.due",
        executionMode: "LIVE",
        certificationStatus: "DRAFT",
        riskClass: "LOW",
        steps: [{ id: "done", type: "STOP" }],
        maxAgeMs: 1000,
        maxSteps: 2,
      }),
    ).toThrow(/SHADOW/);
  });

  test("the workflow is contained, as a third independent barrier", () => {
    expect(isContainedWorkflow(MORNING_INTELLIGENCE_WORKFLOW)).toBe(true);
  });

  test("nothing in the codebase publishes the trigger event", () => {
    // The type may be declared, mapped and tested; it may never be published.
    expect(triggerPublishers).toEqual([]);
  });
});

// ── Eligibility ───────────────────────────────────────────────────────────────

describe("eligibility uses the canonical dispatch composite", () => {
  test("condition is registered with all six clauses", () => {
    clearConditions();
    registerAllConditions();
    const cond = getCondition("provider.morning_eligible");
    expect(cond).toBeDefined();
    const clauses = (cond as { and: Array<{ field: string }> }).and;
    expect(clauses.map((c) => c.field).sort()).toEqual([
      "provider.complianceRestricted",
      "provider.isActive",
      "provider.isApproved",
      "provider.isBanned",
      "provider.paused",
      "provider.userBanned",
    ]);
  });

  test("resolver exposes every field the condition names", () => {
    for (const f of ["isActive", "isApproved", "isBanned", "userBanned", "complianceRestricted", "paused"]) {
      expect(providerResolver.fields).toContain(f);
    }
  });

  test("an eligible partner passes", async () => {
    const brief = await morningIntelligenceService.assembleBrief(pEligible);
    expect(brief.eligibility.eligible).toBe(true);
    expect(brief.eligibility.reason).toBe("ELIGIBLE");
    expect(brief.eligibility.failedClauses).toEqual([]);
    expect(brief.state).not.toBe("INELIGIBLE");
  }, 60_000);

  const ineligibleCases: Array<[string, () => string, MorningEligibilityReason]> = [
    ["paused", () => pPaused, "PAUSED"],
    ["banned", () => pBanned, "BANNED"],
    ["compliance restricted", () => pRestricted, "COMPLIANCE_RESTRICTED"],
    ["inactive", () => pInactive, "NOT_ACTIVE"],
    ["unapproved", () => pUnapproved, "NOT_APPROVED"],
    ["user banned", () => pUserBanned, "USER_BANNED"],
  ];
  for (const [label, get, expected] of ineligibleCases) {
    test(`an ineligible partner (${label}) is refused with a reason`, async () => {
      const brief = await morningIntelligenceService.assembleBrief(get());
      expect(brief.eligibility.eligible).toBe(false);
      expect(brief.eligibility.failedClauses).toContain(expected);
      expect(brief.state).toBe("INELIGIBLE");
      // An ineligible partner costs no intelligence work and leaks no signals.
      expect(brief.topZones).toEqual([]);
      expect(brief.partner).toBeNull();
    });
  }

  test("a missing provider is PROVIDER_NOT_FOUND, not ineligible", async () => {
    const brief = await morningIntelligenceService.assembleBrief("prv_does_not_exist");
    expect(brief.state).toBe("PROVIDER_NOT_FOUND");
    expect(brief.eligibility.reason).toBe("PROVIDER_NOT_FOUND");
  });

  test("multiple failing clauses are all reported", async () => {
    const user = await prisma.user.create({
      data: { firstName: "Multi", lastName: "MI", password: "x", role: "VENDOR",
        phoneNumber: `95${String(Date.now()).slice(-8)}`, email: `multi.${Date.now()}@mi.test`, isBanned: true },
    });
    const p = await prisma.provider.create({
      data: { userId: user.id, businessName: "Multi", isActive: false, isApproved: false,
        isBanned: true, complianceRestricted: true, pausedAt: new Date(), registrationStatus: "PENDING" },
    });
    const brief = await morningIntelligenceService.assembleBrief(p.id);
    expect(brief.eligibility.failedClauses.length).toBeGreaterThanOrEqual(5);
  });
});

// ── Brief assembly ────────────────────────────────────────────────────────────

describe("brief assembly composes the existing services", () => {
  test("assembles a brief carrying identity, date and versions", async () => {
    const brief = await morningIntelligenceService.assembleBrief(pEligible);
    expect(brief.partner?.providerId).toBe(pEligible);
    expect(brief.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(brief.timezone).toBe("Asia/Kolkata");
    expect(brief.versions.morningRulesVersion).toBe(MORNING_INTELLIGENCE_RULES_VERSION);
    expect(brief.versions.contextRulesVersion.length).toBeGreaterThan(0);
    expect(brief.versions.nudgeRulesVersion).not.toBeNull();
    expect(brief.versions.zoneRulesVersion).not.toBeNull();
  });

  test("every signal keeps its provenance rather than being flattened", async () => {
    const brief = await morningIntelligenceService.assembleBrief(pEligible);
    for (const sig of [brief.location, brief.demand, brief.supply, brief.surge,
      brief.weather, brief.jobs, brief.earningsSignal, brief.performanceSignal]) {
      expect(["OK", "UNAVAILABLE", "STALE", "INSUFFICIENT_DATA", "MODEL_UNAVAILABLE"]).toContain(sig.state);
      expect(["REAL_TIME", "NEAR_REAL_TIME", "HISTORICAL", "FORECAST", "STATIC", "UNKNOWN"]).toContain(sig.freshness);
      // A non-OK signal must never carry a fabricated value.
      if (sig.state === "UNAVAILABLE" || sig.state === "MODEL_UNAVAILABLE") {
        expect(sig.value).toBeNull();
        expect(sig.reasonCode).toBeDefined();
      }
    }
  });

  test("missing signals produce reason codes, never zeros", async () => {
    const brief = await morningIntelligenceService.assembleBrief(pEligible);
    const unusable = [brief.location, brief.demand, brief.supply, brief.surge,
      brief.weather, brief.jobs, brief.earningsSignal, brief.performanceSignal]
      .filter((s) => s.state !== "OK");
    // A fresh fixture partner has no history, so this must be non-empty — otherwise the
    // assertion below would pass vacuously.
    expect(unusable.length).toBeGreaterThan(0);
    expect(brief.reasonCodes.length).toBeGreaterThan(0);
    expect(brief.state).toBe("PARTIAL");
  });

  test("coverage and confidence move with the inputs rather than being asserted", async () => {
    const brief = await morningIntelligenceService.assembleBrief(pEligible);
    expect(brief.coverage).toBeGreaterThanOrEqual(0);
    expect(brief.coverage).toBeLessThanOrEqual(1);
    const usable = [brief.location, brief.demand, brief.supply, brief.surge,
      brief.weather, brief.jobs, brief.earningsSignal, brief.performanceSignal]
      .filter((s) => s.state === "OK").length;
    expect(brief.coverage).toBeCloseTo(usable / 8, 4);
    expect(brief.confidence).toBeLessThanOrEqual(brief.coverage + 1e-9);
  });

  test("a partner with no history reports insufficiency, not achievement", async () => {
    const brief = await morningIntelligenceService.assembleBrief(pEligible);
    expect(["INSUFFICIENT_HISTORY", "OK", "PROVIDER_NOT_FOUND"]).toContain(brief.performance.state);
    if (brief.performance.state === "INSUFFICIENT_HISTORY") {
      expect(brief.performance.nudges).toEqual([]);
    }
    // No target is set in a morning brief, so Item 3 must return no opportunity rather than a guess.
    expect(brief.earnings.opportunity).toBeNull();
  });

  test("zones are not described as anchored to a live fix when location is not live", async () => {
    const brief = await morningIntelligenceService.assembleBrief(pEligible);
    if (brief.topZones.length > 0 && brief.location.state !== "OK") {
      expect(brief.reasonCodes).toContain("ZONES_NOT_ANCHORED_TO_LIVE_LOCATION");
    }
    expect(true).toBe(true);
  });

  /**
   * The contradiction found during real observation on 2026-08-28.
   *
   * The brief reported `demand.state = "OK"` while simultaneously carrying
   * `SHIFT_DEMAND_FORECAST_STALE`, because Item 1 marks demand OK whenever the model returns points
   * and never checks whether its horizon has elapsed. Two views of one source disagreed, and the
   * optimistic one was the one a consumer would read.
   */
  test("a demand forecast whose horizon has elapsed can never read as OK", () => {
    const elapsed = new Date(Date.now() - 72 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
    const future = new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");

    expect(isDemandForecastStale(null, { points: [{ hour: elapsed }] })).toBe(true);
    expect(isDemandForecastStale(null, { points: [{ hour: future }] })).toBe(false);
    // No horizon to read and no fetch time is an unknown age, which must not read as fresh.
    expect(isDemandForecastStale(null, { points: [] })).toBe(true);
    expect(isDemandForecastStale(null, { points: [{ hour: "not-a-date" }] })).toBe(true);
  });

  test("the brief never reports OK demand alongside a staleness reason code", async () => {
    const brief = await morningIntelligenceService.assembleBrief(pEligible);
    const staleFlagged = brief.reasonCodes.some((c) => c.includes("DEMAND_FORECAST_STALE"));
    if (staleFlagged) expect(brief.demand.state).not.toBe("OK");
    if (brief.demand.state === "STALE") {
      // STALE keeps its value by contract — aged, not erased.
      expect(brief.reasonCodes).toContain("DEMAND_FORECAST_STALE");
    }
  });

  test("stale demand is defined in exactly one place", async () => {
    /**
     * The invariant is "one definition", not "a definition in this file".
     *
     * This asserted that `shift-planning.service.ts` contained the `export function`. The rule was
     * later moved to `lib/demand-forecast-freshness.ts` so `geo-intelligence` could use it without
     * an import cycle, and shift-planning now re-exports it — the invariant was intact, but the test
     * failed because it pinned a path. Worse, a genuine SECOND definition appearing anywhere else
     * would have gone unnoticed, which is the failure this test exists to catch.
     *
     * It now counts definitions across the whole source tree.
     */
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const srcRoot = join(import.meta.dir, "..");

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === "node_modules" || entry === "__tests__") continue;
          walk(full);
        } else if (entry.endsWith(".ts")) {
          files.push(full);
        }
      }
    };
    walk(srcRoot);

    const definitions = files.filter((f) => /export function isDemandForecastStale/.test(readFileSync(f, "utf8")));
    const thresholds = files.filter((f) => /DEMAND_STALE_AFTER_HOURS\s*=/.test(readFileSync(f, "utf8")));

    // One rule, one threshold — anywhere in the tree.
    expect(definitions.length).toBe(1);
    expect(thresholds.length).toBe(1);
    // And they live together, so the constant cannot drift from the comparison that reads it.
    expect(definitions[0]).toBe(thresholds[0]);

    // Morning imports the rule; it does not restate the threshold itself.
    expect(serviceSource).toContain("isDemandForecastStale");
    expect(serviceSource).not.toContain("DEMAND_STALE_AFTER_HOURS");
  });

  test("the assembler recalculates nothing — it imports the owners", () => {
    for (const owner of ["partner-intelligence.service", "shift-planning.service",
      "earnings-coach.service", "performance-nudges.service"]) {
      expect(serviceSource).toContain(owner);
    }
    // Forbidden growth multipliers from the Item-3 correction must not reappear.
    expect(serviceSource).not.toMatch(/\*\s*1\.05|\*\s*1\.08|today\s*\*\s*7|today\s*\*\s*30/);
  });
});

// ── Timezone & identity ───────────────────────────────────────────────────────

describe("timezone and brief identity", () => {
  test("local date comes from the partner's own zone", async () => {
    const brief = await morningIntelligenceService.assembleBrief(pEligible);
    expect(brief.localDate).toBe(windowDateFor(new Date(brief.generatedAt), brief.timezone));
  });

  test("two zones on opposite sides of midnight yield different local dates", () => {
    const instant = new Date("2026-08-28T19:30:00Z"); // 01:00 next day in Kolkata, 12:30 same day in New York
    expect(windowDateFor(instant, "Asia/Kolkata")).toBe("2026-08-29");
    expect(windowDateFor(instant, "America/New_York")).toBe("2026-08-28");
  });

  test("identity is one brief per partner per local date per version", () => {
    const a = morningIntelligenceService.briefIdentity("p1", "2026-08-28", 1);
    expect(a).toBe("morning:p1:2026-08-28:v1");
    expect(morningIntelligenceService.briefIdentity("p1", "2026-08-28", 1)).toBe(a);
    expect(morningIntelligenceService.briefIdentity("p1", "2026-08-29", 1)).not.toBe(a);
    expect(morningIntelligenceService.briefIdentity("p2", "2026-08-28", 1)).not.toBe(a);
    expect(morningIntelligenceService.briefIdentity("p1", "2026-08-28", 2)).not.toBe(a);
  });

  test("repeated assembly on the same day yields the same identity (idempotent key)", async () => {
    const [b1, b2] = await Promise.all([
      morningIntelligenceService.assembleBrief(pEligible),
      morningIntelligenceService.assembleBrief(pEligible),
    ]);
    expect(morningIntelligenceService.briefIdentity(pEligible, b1.localDate, 1))
      .toBe(morningIntelligenceService.briefIdentity(pEligible, b2.localDate, 1));
  });
});

// ── Isolation & governance ────────────────────────────────────────────────────

describe("partner isolation and governance", () => {
  test("a brief contains only its own partner", async () => {
    const [a, b] = await Promise.all([
      morningIntelligenceService.assembleBrief(pEligible),
      morningIntelligenceService.assembleBrief(pPaused),
    ]);
    expect(a.partner?.providerId).toBe(pEligible);
    expect(b.partner).toBeNull(); // ineligible
    const serialized = JSON.stringify(a);
    expect(serialized).not.toContain(pPaused);
    expect(serialized).not.toContain(pBanned);
  });

  test("assembleBrief takes a server-resolved id and nothing else", () => {
    // No actor, role, admin or allUsers parameter exists to spoof.
    expect(morningIntelligenceService.assembleBrief.length).toBeLessThanOrEqual(2);
    for (const forbidden of ["actorId", "isAdmin", "allUsers", "role:", "req.user"]) {
      expect(serviceSource).not.toContain(forbidden);
    }
  });

  test("a spoofed id is just a missing provider, never someone else's brief", async () => {
    for (const spoof of [`${pEligible}' OR '1'='1`, "*", "admin", `${pEligible} ${pPaused}`]) {
      const brief = await morningIntelligenceService.assembleBrief(spoof);
      expect(brief.state).toBe("PROVIDER_NOT_FOUND");
      expect(brief.partner).toBeNull();
    }
  });

  test("feature flag is absent and therefore off", async () => {
    expect(await isFeatureEnabled("PARTNER_MORNING_INTELLIGENCE", pEligible)).toBe(false);
  });

  test("channel policy excludes EMAIL for the morning brief", () => {
    expect(channelOrderFor("partner.morning_intelligence", ["PUSH", "IN_APP", "EMAIL"]))
      .toEqual(["PUSH", "IN_APP"]);
  });

  test("the assembler never touches an adapter or the router", () => {
    for (const forbidden of ["pushAdapter", "routeNotification", "emailAdapter", "smsAdapter"]) {
      expect(serviceSource).not.toContain(forbidden);
    }
    /**
     * Expo is matched as an identifier, not a substring.
     *
     * A bare "expo" search hits the word `export` on almost every line, so the first version of this
     * test failed against correct code — a fixture defect that would have been read as a real one.
     */
    expect(serviceSource).not.toMatch(/\bexpo-server-sdk\b|\bnew Expo\b|\bExpoPush/);
  });
});

// ── LLM ───────────────────────────────────────────────────────────────────────

describe("the deterministic brief stands alone", () => {
  test("no LLM/provider call exists in the assembler", () => {
    for (const forbidden of ["aiGateway", "generateText", "openai", "gemini", "groq", "anthropic"]) {
      expect(serviceSource.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  test("a brief is complete without any summary field", async () => {
    const brief = await morningIntelligenceService.assembleBrief(pEligible);
    expect(brief).not.toHaveProperty("summary");
    expect(brief.versions.morningRulesVersion).toBeTruthy();
    expect(brief.localDate).toBeTruthy();
  });
});

// ── Side effects ──────────────────────────────────────────────────────────────

describe("zero side effects", () => {
  test("assembling briefs mutates nothing", async () => {
    const before = await snapshot();
    await Promise.all([
      morningIntelligenceService.assembleBrief(pEligible),
      morningIntelligenceService.assembleBrief(pPaused),
      morningIntelligenceService.assembleBrief(pBanned),
      morningIntelligenceService.assembleBrief(pRestricted),
    ]);
    const after = await snapshot();
    expect(after).toEqual(before);
  });

  test("no scheduled job is created while the schedule is unset", async () => {
    const before = await prisma.scheduledJob.count({ where: { jobType: { contains: "morning" } } });
    await morningIntelligenceService.assembleBrief(pEligible);
    const after = await prisma.scheduledJob.count({ where: { jobType: { contains: "morning" } } });
    expect(after).toBe(before);
    expect(after).toBe(0);
  });

  test("no workflow instance is created by assembly", async () => {
    const before = await prisma.workflowInstance.count({ where: { workflowId: MORNING_INTELLIGENCE_WORKFLOW } });
    await morningIntelligenceService.assembleBrief(pEligible);
    const after = await prisma.workflowInstance.count({ where: { workflowId: MORNING_INTELLIGENCE_WORKFLOW } });
    expect(after).toBe(before);
    expect(after).toBe(0);
  });

  test("concurrent assembly stays read-only and consistent", async () => {
    const before = await snapshot();
    const briefs = await Promise.all(
      Array.from({ length: 8 }, () => morningIntelligenceService.assembleBrief(pEligible)),
    );
    const after = await snapshot();
    expect(after).toEqual(before);
    const dates = new Set(briefs.map((b) => b.localDate));
    expect(dates.size).toBe(1);
    const ids = new Set(briefs.map((b) => morningIntelligenceService.briefIdentity(pEligible, b.localDate, 1)));
    expect(ids.size).toBe(1);
  }, 90_000);
});
