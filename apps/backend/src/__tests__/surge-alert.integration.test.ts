/**
 * PARTNER INTELLIGENCE — Item 7, Surge Automation.
 *
 * Runs ONLY on the isolated `homigo_p39` database and aborts otherwise.
 *
 * ── The two claims under test ──────────────────────────────────────────────────
 *
 * That the reader is faithful: it carries the source's numbers, provenance and anomalies without
 * repairing, smoothing or re-deriving any of them. The zero-supply discontinuity and the 2.5 clamp
 * are the source's behaviour, and tests here assert they survive intact rather than asserting they
 * are correct — correcting them is a business decision this capability is not allowed to make.
 *
 * That it cannot act: no threshold exists, so no zone can be classified alert-worthy, and no code
 * path turns a demand signal into a claim about pay. The last property matters most — three things
 * in this platform are called surge and only one reaches money, and this is not that one.
 */
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "../lib/prisma";
import {
  surgeAlertService,
  SURGE_ALERT_RULES_VERSION,
  SURGE_ANOMALY,
  SURGE_DECISION,
  SURGE_STALE_AFTER_SEC,
  SURGE_SOURCE_CLAMPS,
} from "../services/surge-alert.service";
import {
  surgeAlertPolicy,
  isSurgeAlertPolicyApproved,
  surgePolicyRefusal,
  SURGE_ALERT_STATE,
  SURGE_POLICY_REFUSAL,
  SURGE_HUMAN_DECISIONS,
} from "../services/surge-alert-policy.config";
import { governanceConfig } from "../notifications/governance/policy";
import { clearWorkflows, getWorkflow } from "../automation/registry/workflow-registry";
import {
  registerSurgeAlertWorkflow,
  SURGE_ALERT_WORKFLOW,
} from "../automation/registry/definitions/surge-alert-workflow";
import { isContainedWorkflow } from "../notifications/governance/containment";
import { channelOrderFor, typeChannelPolicy } from "../notifications/governance/channel-policy";
import { isFeatureEnabled } from "../services/feature-flag.service";
import { cacheService } from "../services/cache.service";

let serviceSource = "";
let policySource = "";
let templateSource = "";
let workflowSource = "";
let zoneA = "";
let zoneB = "";
let surgeTriggerPublishers: string[] = [];

/**
 * Source with comments removed, for assertions about what the code *does*.
 *
 * Three forbidden-substring tests failed against correct code because these files explain their own
 * boundaries in prose: the surge service names `weatherService` while saying it is the money path it
 * must not touch, and the workflow names `provider.surge_eligible` while saying it deliberately did
 * not create one. A raw substring search cannot tell a warning from a dependency. Stripping comments
 * first makes the assertion mean what it was always meant to mean, without weakening it — the code
 * itself is still searched in full.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(String.fromCharCode(10))
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join(String.fromCharCode(10));
}

type Counts = Record<string, number>;
async function snapshot(): Promise<Counts> {
  const [bookings, assignments, payments, wallet, notifications, deliveries, instances, jobs, outbox, geofences] =
    await Promise.all([
      prisma.booking.count(),
      prisma.assignmentJob.count(),
      prisma.payment.count(),
      prisma.walletTransaction.count(),
      prisma.notification.count(),
      prisma.notificationDelivery.count(),
      prisma.workflowInstance.count(),
      prisma.scheduledJob.count(),
      prisma.eventOutbox.count(),
      prisma.geofence.count(),
    ]);
  return { bookings, assignments, payments, wallet, notifications, deliveries, instances, jobs, outbox, geofences };
}

/** Surge evaluation is read-only; notifications may still increase from async assignment/dispatch fallout of earlier tests in the combined serial suite. */
async function surgeSideEffectSnapshot(): Promise<Omit<Counts, "notifications">> {
  const s = await snapshot();
  const { notifications: _notifications, ...rest } = s;
  return rest;
}

beforeAll(async () => {
  const db = (await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db"))[0].db;
  refuseIfNotIsolatedTestDb(db);

  const dir = import.meta.dir;
  serviceSource = await Bun.file(`${dir}/../services/surge-alert.service.ts`).text();
  policySource = await Bun.file(`${dir}/../services/surge-alert-policy.config.ts`).text();
  templateSource = await Bun.file(`${dir}/../notifications/templates/definitions.ts`).text();
  workflowSource = await Bun.file(`${dir}/../automation/registry/definitions/surge-alert-workflow.ts`).text();

  /**
   * Computed once: the tree-wide scan takes ~15 s, far past a 5 s case timeout. Item 6 hit the same
   * harness defect and was fixed the same way.
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
  for await (const f of glob.scan({ cwd: `${dir}/..`, absolute: true })) {
    const txt = await Bun.file(f).text();
    if (txt.includes("PARTNER_ZONE_SURGE_DETECTED")) found.push(f.split(String.fromCharCode(92)).join("/"));
  }
  /**
   * A file *publishes* the trigger only if it both names the event type and calls an emit function.
   *
   * The original filter was a mention-scan with an exclusion list, and it broke the moment a
   * declaration file appeared: `partner-event-catalog.ts` maps the canonical name `demand.spike` to
   * this runtime type with `producerStatus: "POLICY_PENDING"` and an explicit note not to invent a
   * producer — a declaration that there is no producer, flagged as a producer.
   *
   * Requiring an emit call makes the test stronger rather than weaker: a genuine publisher anywhere
   * in the tree is still caught, including in a file no exclusion list anticipated, while naming the
   * event in a registry, a catalog or a type union is correctly not a publication.
   */
  const EMITTERS = ["emitInTransaction", "emitStandalone", "emitPartnerEvent", "publishEvent"];
  const publishers: string[] = [];
  for (const f of found) {
    if (f.includes("__tests__")) continue;
    const txt = await Bun.file(f).text();
    if (EMITTERS.some((e) => txt.includes(e))) publishers.push(f);
  }
  surgeTriggerPublishers = publishers;

  /**
   * Two zones deliberately sharing one display name.
   *
   * This reproduces the real condition measured in `homigo_db` — two active geofences both called
   * "Delhi Connaught Place" — so the identity tests exercise the collision rather than assuming it
   * cannot happen.
   */
  const stamp = Date.now();
  const a = await prisma.geofence.create({
    data: {
      name: `Twin Zone ${stamp}`, city: "Testville", centerLat: 28.61, centerLng: 77.21,
      radiusMeters: 3000, isActive: true, surgeMultiplier: 1.2,
    },
  });
  const b = await prisma.geofence.create({
    data: {
      name: `Twin Zone ${stamp}`, city: "Testville", centerLat: 28.72, centerLng: 77.35,
      radiusMeters: 3000, isActive: true, surgeMultiplier: 1.0,
    },
  });
  zoneA = a.id;
  zoneB = b.id;

  /**
   * Drop the source's cached reading so this suite sees the zones it just created.
   *
   * `surgePrediction()` caches for 120 s. Run alongside other suites in one process, that cache can
   * already hold a reading taken before these fixtures existed — which made the duplicate-name test
   * fail against correct code when the full regression ran, and pass when the file ran alone. A test
   * whose result depends on which other files ran first is not testing what it claims to.
   *
   * Invalidating the key is the honest fix: it forces a real recomputation against the real zones,
   * rather than relaxing the assertion until a stale reading could satisfy it.
   */
  await cacheService.invalidate("geo-intel:surge-prediction");
}, 120_000);

// ── Policy boundary ───────────────────────────────────────────────────────────

describe("surge alert policy is UNSET and fails closed", () => {
  test("every decision field is null", () => {
    expect(surgeAlertPolicy.enabled).toBe(false);
    expect(surgeAlertPolicy.threshold).toBeNull();
    expect(surgeAlertPolicy.hysteresis).toBeNull();
    expect(surgeAlertPolicy.cooldownSeconds).toBeNull();
    expect(surgeAlertPolicy.status).toBe("UNSET");
    expect(SURGE_ALERT_STATE).toBe("DISABLED_UNTIL_POLICY_APPROVED");
  });

  test("the automation cannot activate", () => {
    expect(isSurgeAlertPolicyApproved()).toBe(false);
    expect(surgePolicyRefusal()).toBe(SURGE_POLICY_REFUSAL);
  });

  test("a partial policy never approves", () => {
    const base = { enabled: true, status: "APPROVED" as const };
    expect(isSurgeAlertPolicyApproved({ ...base, threshold: 1.5, hysteresis: null, cooldownSeconds: 900 })).toBe(false);
    expect(isSurgeAlertPolicyApproved({ ...base, threshold: null, hysteresis: 0.2, cooldownSeconds: 900 })).toBe(false);
    expect(isSurgeAlertPolicyApproved({ ...base, threshold: 1.5, hysteresis: 0.2, cooldownSeconds: null })).toBe(false);
    expect(isSurgeAlertPolicyApproved({ enabled: false, status: "APPROVED", threshold: 1.5, hysteresis: 0.2, cooldownSeconds: 900 })).toBe(false);
    expect(isSurgeAlertPolicyApproved({ enabled: true, status: "UNSET", threshold: 1.5, hysteresis: 0.2, cooldownSeconds: 900 })).toBe(false);
    // Complete and approved is the only combination that passes.
    expect(isSurgeAlertPolicyApproved({ ...base, threshold: 1.5, hysteresis: 0.2, cooldownSeconds: 900 })).toBe(true);
  });

  test("the policy cannot be set from the environment", () => {
    expect(policySource).not.toContain("process.env");
  });

  /**
   * Notification cooldown is not surge hysteresis.
   *
   * Reusing the 24-hour recipient cooldown as a signal-stability rule would silently answer a
   * question nobody asked, so the policy must not quote it.
   */
  test("hysteresis is not borrowed from the notification cooldown", () => {
    expect(governanceConfig.defaultCooldownMs).toBe(24 * 60 * 60 * 1000);
    expect(codeOnly(policySource)).not.toContain("defaultCooldownMs");
    expect(codeOnly(policySource)).not.toContain("governanceConfig");
  });

  test("the outstanding human decisions are named", () => {
    expect([...SURGE_HUMAN_DECISIONS]).toEqual([
      "SURGE_ALERT_THRESHOLD_REQUIRED",
      "SURGE_HYSTERESIS_POLICY_REQUIRED",
      "SURGE_ALERT_COOLDOWN_REQUIRED",
      "SURGE_TRIGGER_EVENT_SEMANTICS_REQUIRED",
    ]);
  });
});

// ── Signal reading: faithful to the source ────────────────────────────────────

describe("the reader is faithful to the authoritative source", () => {
  test("reads a real signal with provenance", async () => {
    const sig = await surgeAlertService.readSignal();
    expect(["OK", "STALE", "UNAVAILABLE"]).toContain(sig.state);
    expect(sig.rulesVersion).toBe(SURGE_ALERT_RULES_VERSION);
    if (sig.state !== "UNAVAILABLE") {
      // Non-vacuous: the isolated DB has zones, so a usable read must actually return some.
      expect(sig.zones.length).toBeGreaterThan(0);
      expect(sig.source).toBeTruthy();
      expect(sig.observedAt).toBeTruthy();
    }
  });

  test("every zone carries identity, inputs and provenance", async () => {
    const sig = await surgeAlertService.readSignal();
    for (const z of sig.zones) {
      expect(z.zoneId.length).toBeGreaterThan(0);
      expect(typeof z.surge).toBe("number");
      expect(typeof z.supply).toBe("number");
      expect(typeof z.activeBookings).toBe("number");
      expect(Number.isFinite(z.pressure)).toBe(true);
      expect(Array.isArray(z.anomalies)).toBe(true);
    }
  });

  test("the reader does not recompute or repair the source formula", () => {
    // It may name the clamps to detect saturation; it must never apply them to produce a value.
    const code = codeOnly(serviceSource);
    expect(code).not.toMatch(/predictedSurge\s*=/);
    expect(code).not.toContain("weatherService");
    expect(code).not.toContain("buildZoneSnapshot");
    // Non-vacuous: the one call it must make is present in the code, not merely described.
    expect(code).toContain("geoIntelligenceService.surgePrediction");
  });

  test("zero-supply anomaly is recorded, not corrected", async () => {
    const sig = await surgeAlertService.readSignal();
    for (const z of sig.zones) {
      if (z.supply === 0 && z.activeBookings > 0) {
        expect(z.anomalies).toContain(SURGE_ANOMALY.ZERO_SUPPLY_SIGNAL_ANOMALY);
        // The source's own hardcoded branch survives: pressure is 2, not Infinity, not activeBookings.
        expect(z.pressure).toBe(2);
      }
    }
    expect(SURGE_ANOMALY.ZERO_SUPPLY_SIGNAL_ANOMALY).toBe("ZERO_SUPPLY_SIGNAL_ANOMALY");
  });

  test("saturation is flagged rather than presented as a measurement", async () => {
    const sig = await surgeAlertService.readSignal();
    expect(SURGE_SOURCE_CLAMPS.demandSurge).toBe(2.5);
    expect(SURGE_SOURCE_CLAMPS.saturationPressure).toBe(4.75);
    for (const z of sig.zones) {
      if (z.pressure >= SURGE_SOURCE_CLAMPS.saturationPressure || z.surge >= SURGE_SOURCE_CLAMPS.surge) {
        expect(z.anomalies).toContain(SURGE_ANOMALY.SIGNAL_SATURATED);
      }
    }
  });

  test("staleness is bounded by the source's own cache window", async () => {
    expect(SURGE_STALE_AFTER_SEC).toBe(240);
    const sig = await surgeAlertService.readSignal();
    if (sig.state === "OK") {
      expect(sig.ageSeconds).not.toBeNull();
      expect(sig.ageSeconds!).toBeLessThanOrEqual(SURGE_STALE_AFTER_SEC);
    }
  });

  test("an artificially aged reading is classified STALE, not current", async () => {
    const future = new Date(Date.now() + (SURGE_STALE_AFTER_SEC + 60) * 1000);
    const sig = await surgeAlertService.readSignal({ now: future });
    expect(sig.state).toBe("STALE");
    expect(sig.reasonCode).toBe("SURGE_SIGNAL_STALE");
  });
});

// ── Zone identity ─────────────────────────────────────────────────────────────

describe("zoneId is the identity and zoneName is only a label", () => {
  test("two zones sharing a name stay distinct and are both flagged", async () => {
    const sig = await surgeAlertService.readSignal();
    const twins = sig.zones.filter((z) => z.zoneId === zoneA || z.zoneId === zoneB);
    // Non-vacuous: the fixture created both, so the reader must surface both.
    expect(twins.length).toBe(2);
    expect(twins[0]!.zoneName).toBe(twins[1]!.zoneName);
    expect(twins[0]!.zoneId).not.toBe(twins[1]!.zoneId);
    for (const t of twins) expect(t.anomalies).toContain(SURGE_ANOMALY.DUPLICATE_ZONE_NAME);
  });

  test("identity keys on zoneId, never zoneName", () => {
    const a = surgeAlertService.alertIdentity("p1", zoneA, SURGE_DECISION.ALERT_WORTHY, 1);
    const b = surgeAlertService.alertIdentity("p1", zoneB, SURGE_DECISION.ALERT_WORTHY, 1);
    expect(a).not.toBe(b);
    expect(a).toContain(zoneA);
    expect(a).not.toContain("Twin Zone");
  });

  test("identity is stable for the same partner, zone, decision and version", () => {
    const a = surgeAlertService.alertIdentity("p1", zoneA, SURGE_DECISION.ALERT_WORTHY, 1);
    expect(surgeAlertService.alertIdentity("p1", zoneA, SURGE_DECISION.ALERT_WORTHY, 1)).toBe(a);
    expect(surgeAlertService.alertIdentity("p2", zoneA, SURGE_DECISION.ALERT_WORTHY, 1)).not.toBe(a);
    expect(surgeAlertService.alertIdentity("p1", zoneA, SURGE_DECISION.BELOW_THRESHOLD, 1)).not.toBe(a);
    expect(surgeAlertService.alertIdentity("p1", zoneA, SURGE_DECISION.ALERT_WORTHY, 2)).not.toBe(a);
  });

  test("the service never groups or dedupes by name", () => {
    expect(serviceSource).not.toMatch(/new Map<string, [^>]*>\(\)[\s\S]{0,80}zoneName/);
    expect(serviceSource).toContain("Never an identity, never an idempotency key");
  });
});

// ── Decisions under the unset policy ──────────────────────────────────────────

describe("no zone can be alert-worthy while the policy is unset", () => {
  test("every zone returns WOULD_NOT_EVALUATE with the refusal reason", async () => {
    const { decisions, refusal } = await surgeAlertService.evaluate();
    expect(refusal).toBe(SURGE_POLICY_REFUSAL);
    // Non-vacuous: there must be zones to decide about.
    expect(decisions.length).toBeGreaterThan(0);
    for (const d of decisions) {
      expect(d.decision).toBe(SURGE_DECISION.WOULD_NOT_EVALUATE);
      expect(d.reasonCode).toBe(SURGE_POLICY_REFUSAL);
      expect(d.policy.threshold).toBeNull();
    }
    expect(decisions.some((d) => d.decision === SURGE_DECISION.ALERT_WORTHY)).toBe(false);
  });

  test("undecided is distinguished from calm", async () => {
    const { decisions } = await surgeAlertService.evaluate();
    // A zone below an imagined threshold would be BELOW_THRESHOLD; with no policy nothing may be.
    expect(decisions.some((d) => d.decision === SURGE_DECISION.BELOW_THRESHOLD)).toBe(false);
  });

  test("an approved policy does classify — proving the unset case is not vacuous", async () => {
    const approved = { enabled: true, status: "APPROVED" as const, threshold: 1.0, hysteresis: 0.2, cooldownSeconds: 900 };
    const { decisions } = await surgeAlertService.evaluate({ policy: approved });
    expect(decisions.length).toBeGreaterThan(0);
    const classified = decisions.filter(
      (d) => d.decision === SURGE_DECISION.ALERT_WORTHY || d.decision === SURGE_DECISION.BELOW_THRESHOLD,
    );
    // Threshold 1.0 selects every zone, so the evaluator must produce real classifications here.
    expect(classified.length).toBeGreaterThan(0);
    for (const d of classified) expect(d.policy.threshold).toBe(1.0);
  });

  test("a stale signal is never evaluated even under an approved policy", async () => {
    const approved = { enabled: true, status: "APPROVED" as const, threshold: 1.0, hysteresis: 0.2, cooldownSeconds: 900 };
    const future = new Date(Date.now() + (SURGE_STALE_AFTER_SEC + 60) * 1000);
    const { decisions } = await surgeAlertService.evaluate({ policy: approved, now: future });
    expect(decisions.length).toBeGreaterThan(0);
    for (const d of decisions) {
      expect(d.decision).toBe(SURGE_DECISION.SIGNAL_UNUSABLE);
      expect(d.signalState).toBe("STALE");
    }
  });

  test("every decision carries reproducible evidence", async () => {
    const { decisions } = await surgeAlertService.evaluate();
    for (const d of decisions) {
      expect(d.zoneId.length).toBeGreaterThan(0);
      expect(d.rulesVersion).toBe(SURGE_ALERT_RULES_VERSION);
      expect(d.reading).not.toBeNull();
      expect(d.reasonCode.length).toBeGreaterThan(0);
      expect(d.policy.status).toBe("UNSET");
    }
  });
});

// ── Workflow ──────────────────────────────────────────────────────────────────

describe("workflow is registered and inert", () => {
  test("registers SHADOW/DRAFT/LOW against the surge trigger", () => {
    clearWorkflows();
    registerSurgeAlertWorkflow();
    const wf = getWorkflow(SURGE_ALERT_WORKFLOW, 1)!;
    expect(wf.executionMode).toBe("SHADOW");
    expect(wf.certificationStatus).toBe("DRAFT");
    expect(wf.riskClass).toBe("LOW");
    expect(wf.trigger).toBe("homigo.partner.zone_surge.detected");
    expect(wf.steps.map((s) => s.type)).toEqual(["CONDITION", "NOTIFICATION", "STOP"]);
  });

  test("reuses the Item-6 eligibility condition rather than defining a second", () => {
    clearWorkflows();
    registerSurgeAlertWorkflow();
    const wf = getWorkflow(SURGE_ALERT_WORKFLOW, 1)!;
    const cond = wf.steps.find((s) => s.type === "CONDITION");
    expect(cond).toMatchObject({ conditionId: "provider.morning_eligible" });
    expect(codeOnly(workflowSource)).not.toContain("provider.surge_eligible");
  });

  test("contains no ACTION step, so it cannot reach pricing, payout or availability", () => {
    clearWorkflows();
    registerSurgeAlertWorkflow();
    const wf = getWorkflow(SURGE_ALERT_WORKFLOW, 1)!;
    expect(wf.steps.some((s) => s.type === "ACTION")).toBe(false);
  });

  test("is contained", () => {
    expect(isContainedWorkflow(SURGE_ALERT_WORKFLOW)).toBe(true);
  });

  test("nothing publishes the surge trigger event", () => {
    expect(surgeTriggerPublishers).toEqual([]);
  });
});

// ── The money boundary ────────────────────────────────────────────────────────

describe("the alert never claims pay", () => {
  test("the surge template promises no earnings", () => {
    const block = templateSource.slice(
      templateSource.indexOf("partner.surge_alert.push.en"),
      templateSource.indexOf("partner.morning_intelligence.in_app.en"),
    );
    expect(block.length).toBeGreaterThan(100);
    for (const forbidden of ["earn", "₹", "payout", "bonus", "x pay", "rate goes"]) {
      expect(block.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    expect(block).toContain("not a change to your pay rate");
  });

  test("the surge multiplier is not passed to the template", () => {
    clearWorkflows();
    registerSurgeAlertWorkflow();
    const wf = getWorkflow(SURGE_ALERT_WORKFLOW, 1)!;
    const notify = wf.steps.find((s) => s.type === "NOTIFICATION") as { variables?: string[] };
    // `partnerName` is required by every partner template (templates/definitions.ts) and resolves
    // from the provider subject; it carries no pricing information.
    expect(notify.variables).toEqual(["partnerName", "zoneName", "demandEvidence", "observedAt"]);
    expect(notify.variables).not.toContain("surge");
    expect(notify.variables).not.toContain("multiplier");
  });

  test("the service never touches the money-path surge or pricing", () => {
    /**
     * Matched as imports and calls, not as words.
     *
     * The first version searched the raw source for "dynamicPricingService" and failed against
     * correct code: the file names it in a comment explaining that it is deliberately NOT used. A
     * substring search cannot tell an explanation from a dependency — the import list can.
     */
    const imports = serviceSource.split(String.fromCharCode(10)).filter((l) => l.trimStart().startsWith("import"));
    const importBlock = imports.join(String.fromCharCode(10));
    for (const forbidden of ["booking-pricing", "dynamic-pricing", "weather.service"]) {
      expect(importBlock).not.toContain(forbidden);
    }
    for (const forbidden of ["bookingPricingService.", "dynamicPricingService.", "chargeableBase ="]) {
      expect(serviceSource).not.toContain(forbidden);
    }
    // Non-vacuous: the one dependency it SHOULD have is present.
    expect(importBlock).toContain("geo-intelligence.service");
  });

  test("no LLM is anywhere in the surge decision path", () => {
    for (const forbidden of ["aiGateway", "generateText", "openai", "gemini", "groq", "anthropic"]) {
      expect(codeOnly(serviceSource).toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

// ── Governance & security ─────────────────────────────────────────────────────

describe("governance and isolation", () => {
  test("channel policy is PUSH then IN_APP, no email", () => {
    expect(channelOrderFor("partner.surge_alert", ["PUSH", "IN_APP", "EMAIL"])).toEqual(["PUSH", "IN_APP"]);
    expect(typeChannelPolicy("partner.surge_alert")).not.toContain("EMAIL");
  });

  test("the service never calls an adapter or the router", () => {
    for (const forbidden of ["pushAdapter", "routeNotification", "emailAdapter", "smsAdapter"]) {
      expect(codeOnly(serviceSource)).not.toContain(forbidden);
    }
    expect(serviceSource).not.toMatch(/\bexpo-server-sdk\b|\bnew Expo\b|\bExpoPush/);
  });

  test("feature flag is absent and therefore off", async () => {
    expect(await isFeatureEnabled("PARTNER_SURGE_ALERTS", "any-provider")).toBe(false);
  });

  test("the signal is zone-scoped and carries no partner-private data", async () => {
    const sig = await surgeAlertService.readSignal();
    const serialized = JSON.stringify(sig);
    for (const leak of ["phoneNumber", "email", "password", "aadhar", "panNumber", "userId"]) {
      expect(serialized).not.toContain(leak);
    }
  });

  test("evaluate takes no actor, role or admin parameter to spoof", () => {
    for (const forbidden of ["actorId", "isAdmin", "allUsers", "role:", "req.user"]) {
      expect(codeOnly(serviceSource)).not.toContain(forbidden);
    }
  });

  test("a spoofed zone id cannot fabricate an identity collision", () => {
    const injected = surgeAlertService.alertIdentity("p1", `${zoneA}' OR '1'='1`, SURGE_DECISION.ALERT_WORTHY, 1);
    const real = surgeAlertService.alertIdentity("p1", zoneA, SURGE_DECISION.ALERT_WORTHY, 1);
    expect(injected).not.toBe(real);
  });
});

// ── Concurrency & side effects ────────────────────────────────────────────────

describe("concurrency and zero side effects", () => {
  test("concurrent evaluations agree and mutate nothing", async () => {
    const before = await surgeSideEffectSnapshot();
    const runs = await Promise.all(Array.from({ length: 6 }, () => surgeAlertService.evaluate()));
    const after = await surgeSideEffectSnapshot();
    expect(after).toEqual(before);

    const shapes = runs.map((r) =>
      r.decisions.map((d) => `${d.zoneId}:${d.decision}`).sort().join("|"),
    );
    expect(new Set(shapes).size).toBe(1);
  });

  test("repeated evaluation yields one identity per partner+zone+decision", async () => {
    const { decisions } = await surgeAlertService.evaluate();
    const ids = decisions.map((d) => surgeAlertService.alertIdentity("p1", d.zoneId, d.decision, 1));
    expect(new Set(ids).size).toBe(ids.length);

    const again = await surgeAlertService.evaluate();
    const ids2 = again.decisions.map((d) => surgeAlertService.alertIdentity("p1", d.zoneId, d.decision, 1));
    expect(new Set(ids2)).toEqual(new Set(ids));
  });

  test("no workflow instance, scheduled job or outbox row is created", async () => {
    const before = await surgeSideEffectSnapshot();
    await surgeAlertService.evaluate();
    await surgeAlertService.readSignal();
    const after = await surgeSideEffectSnapshot();
    expect(after.instances).toBe(before.instances);
    expect(after.jobs).toBe(before.jobs);
    expect(after.outbox).toBe(before.outbox);
    expect(after.deliveries).toBe(before.deliveries);
  });

  test("no financial, booking or availability mutation", async () => {
    const before = await snapshot();
    await surgeAlertService.evaluate();
    const after = await snapshot();
    expect(after.payments).toBe(before.payments);
    expect(after.wallet).toBe(before.wallet);
    expect(after.bookings).toBe(before.bookings);
    expect(after.assignments).toBe(before.assignments);
    expect(after.geofences).toBe(before.geofences);
  });
});

/**
 * The two fixture zones are platform geometry, and nothing else removed them: every run of this
 * suite left another pair behind in the shared test database. 28 had accumulated, which broke
 * `zone-recommendation.integration.test.ts` — it adopts whatever active geofences already exist and
 * attributes each job to the NEAREST zone centre, so duplicates at identical coordinates stole the
 * jobs from the zone it was asserting about. A suite that seeds shared geometry has to clean it up.
 */
afterAll(async () => {
  if (!zoneA && !zoneB) return;
  await prisma.geofence.deleteMany({ where: { id: { in: [zoneA, zoneB].filter(Boolean) } } });
}, 30_000);
