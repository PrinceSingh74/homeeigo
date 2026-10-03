/**
 * PHASE 12 — ML governance: registry lifecycle, shadow mode, readiness, RBAC, fail-safe.
 *
 * Runs ONLY on an isolated test database and aborts otherwise.
 *
 * The assertions that matter here are the refusals. Anyone can show a model being promoted; what has
 * to be proved is that it cannot be promoted without a person, that a version cannot be created
 * already in production, that a settled outcome cannot be rewritten, that the database — not the
 * application — stops a second production version, and that a leaky label is detected by counting
 * rather than by someone noticing.
 */
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import prisma from "../lib/prisma";
import { mlRegistryService, deterministicArtifactHash } from "../services/ml-registry.service";
import { mlShadowService } from "../services/ml-shadow.service";
import { mlReadinessService, READINESS } from "../services/ml-readiness.service";
import { resolveAdminRoutePermission } from "../lib/admin-route-permissions";

const RUN = `p12-${Date.now().toString(36)}`;
const MODEL = `test_model_${RUN}`;
let actorId = "";

type Counts = Record<string, number>;
async function snapshot(): Promise<Counts> {
  const [bookings, payments, ledger, wallet] = await Promise.all([
    prisma.booking.count(), prisma.payment.count(),
    prisma.ledgerEntry.count(), prisma.walletTransaction.count(),
  ]);
  return { bookings, payments, ledger, wallet };
}
let baseline: Counts;

beforeAll(async () => {
  const db = (await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db"))[0].db;
  refuseIfNotIsolatedTestDb(db);
  actorId = (await prisma.user.create({
    data: {
      firstName: "P12Admin", lastName: "ML", password: "x", role: "ADMIN",
      phoneNumber: "96" + String(Date.now()).slice(-8), email: `p12.${RUN}@ml.test`,
    },
  })).id;
  baseline = await snapshot();
}, 120_000);

afterAll(async () => {
  await prisma.mlShadowPrediction.deleteMany({ where: { modelName: { startsWith: "test_model_" } } });
  await prisma.mlModelVersion.deleteMany({ where: { modelName: { startsWith: "test_model_" } } });
  await prisma.user.deleteMany({ where: { id: actorId } });
}, 60_000);

/** A registered candidate with real-shaped provenance. TEST_FIXTURE_ONLY. */
async function candidate(name = MODEL, metrics: Record<string, number> | null = { mae: 1.5, rmse: 3.1 }) {
  const r = await mlRegistryService.register({
    modelName: name,
    datasetVersion: `ds-${RUN}`,
    featureVersion: "demand.daily.v1",
    codeVersion: "test.v1",
    artifactRef: "rule:TEST_FIXTURE_ONLY",
    artifactHash: deterministicArtifactHash({ fixture: RUN }),
    metrics: metrics ?? undefined,
    actorId,
  });
  if (!r.ok) throw new Error(`fixture registration failed: ${r.detail}`);
  return r.data;
}

/* ══════════════════ registry: the refusals are the product ══════════════════ */

describe("a model cannot reach production without a person", () => {
  test("a version cannot be created in PRODUCTION or APPROVED", async () => {
    for (const stage of ["PRODUCTION", "APPROVED"] as const) {
      const r = await mlRegistryService.register({
        modelName: MODEL, datasetVersion: "d", featureVersion: "f", codeVersion: "c",
        artifactRef: "a", actorId, stage: stage as never,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("ILLEGAL_ENTRY_STAGE");
    }
  });

  test("promotion is refused while the version is only a candidate", async () => {
    const v = await candidate();
    const r = await mlRegistryService.promote({ id: v.id, actorId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_APPROVED");
  });

  test("PRODUCTION is not reachable through the generic transition", async () => {
    const v = await candidate();
    const r = await mlRegistryService.transition({ id: v.id, to: "PRODUCTION", actorId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("USE_PROMOTE");
  });

  test("APPROVED is not reachable through the generic transition either", async () => {
    const v = await candidate();
    const r = await mlRegistryService.transition({ id: v.id, to: "APPROVED", actorId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("USE_APPROVE");
  });

  test("approval requires a note, and a token one is not a note", async () => {
    const v = await candidate();
    const r = await mlRegistryService.approve({ id: v.id, actorId, note: "fine" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("APPROVAL_NOTE_REQUIRED");
  });

  /**
   * A model nobody measured cannot be approved.
   *
   * This is the case a metrics-threshold gate would never catch, because there is no metric to
   * threshold: the version simply has none, and approving it would put an unmeasured model in front
   * of dispatch on somebody's say-so.
   */
  test("a version with no metrics cannot be approved", async () => {
    const v = await candidate(`${MODEL}_nometrics`, null);
    const r = await mlRegistryService.approve({
      id: v.id, actorId, note: "Looks reasonable to me, ship it please.",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NO_EVIDENCE");
  });

  test("provenance is mandatory, field by field", async () => {
    for (const missing of ["datasetVersion", "featureVersion", "codeVersion", "artifactRef"]) {
      const input = {
        datasetVersion: "d", featureVersion: "f", codeVersion: "c", artifactRef: "a",
        [missing]: "",
      } as unknown as {
        datasetVersion: string; featureVersion: string; codeVersion: string; artifactRef: string;
      };
      const r = await mlRegistryService.register({ modelName: MODEL, actorId, ...input });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("MISSING_PROVENANCE");
    }
  });
});

describe("promotion, supersession and rollback", () => {
  const M = `${MODEL}_lifecycle`;

  test("approve then promote, and the version numbers are assigned not chosen", async () => {
    const v1 = await candidate(M);
    expect(v1.version).toBe(1);
    const a = await mlRegistryService.approve({ id: v1.id, actorId, note: "Holdout beat every baseline; approved for serving." });
    expect(a.ok).toBe(true);
    const p = await mlRegistryService.promote({ id: v1.id, actorId });
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.data.superseded).toBeNull();
  });

  test("the database refuses a second production version, not the application", async () => {
    let rejected = false;
    try {
      await prisma.$executeRawUnsafe(
        "INSERT INTO ml_model_versions (id, model_name, version, stage, dataset_version, feature_version, code_version, artifact_ref, created_by, updated_at)" +
        " VALUES ($1, $2, 998, 'PRODUCTION', 'd', 'f', 'c', 'a', $3, NOW())",
        `dup-${RUN}`, M, actorId,
      );
    } catch { rejected = true; }
    expect(rejected).toBe(true);
    const live = await prisma.mlModelVersion.count({ where: { modelName: M, stage: "PRODUCTION" } });
    expect(live).toBe(1);
  });

  test("promoting a second version supersedes the first and records the rollback target", async () => {
    const v2 = await candidate(M);
    expect(v2.version).toBe(2);
    await mlRegistryService.approve({ id: v2.id, actorId, note: "Second version approved for the supersession path." });
    const p = await mlRegistryService.promote({ id: v2.id, actorId });
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.data.superseded).toBe(1);

    const row = await prisma.mlModelVersion.findUnique({ where: { id: v2.id }, select: { supersededVersionId: true } });
    expect(row?.supersededVersionId).toBeTruthy();
  });

  /**
   * Rollback follows the recorded predecessor, not "version minus one".
   *
   * Versions get rejected and retired, so the previous *number* is often not the previous
   * *production* model. Guessing would restore something that never served.
   */
  test("rollback restores the recorded predecessor", async () => {
    const r = await mlRegistryService.rollback({ modelName: M, actorId, reason: "Rollback drill for the governed lifecycle." });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.data.from).toBe(2); expect(r.data.to).toBe(1); }
    const live = await mlRegistryService.production(M);
    expect(live?.version).toBe(1);
  });

  test("rollback requires a stated reason", async () => {
    const r = await mlRegistryService.rollback({ modelName: M, actorId, reason: "bad" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("ROLLBACK_REASON_REQUIRED");
  });

  test("rolling back a model with nothing in production is refused, not silently ignored", async () => {
    const r = await mlRegistryService.rollback({
      modelName: `${MODEL}_never_promoted`, actorId, reason: "Should be refused because nothing is live.",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_IN_PRODUCTION");
  });

  test("every governance act reached the security audit", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ action: string }>>(
      "SELECT DISTINCT action FROM enterprise_audit_logs WHERE action LIKE 'ML_MODEL_%'",
    );
    const actions = rows.map((r) => r.action);
    for (const a of ["ML_MODEL_REGISTERED", "ML_MODEL_APPROVED", "ML_MODEL_PROMOTED", "ML_MODEL_ROLLED_BACK"]) {
      expect(actions).toContain(a);
    }
  });
});

/* ═══════════════════════════════ shadow mode ═══════════════════════════════ */

describe("shadow mode observes and controls nothing", () => {
  const M = `${MODEL}_shadow`;
  let versionId = "";

  test("recording is idempotent per entity, so a retried pass does not double-count", async () => {
    versionId = (await candidate(M)).id;
    const records = ["2026-08-01", "2026-08-02", "2026-08-03"].map((d) => ({
      entityKey: d, predictedFor: new Date(`${d}T00:00:00Z`), candidateValue: 4, productionValue: 6,
    }));
    await mlShadowService.record({ modelName: M, candidateVersionId: versionId, productionVersion: null, records });
    await mlShadowService.record({ modelName: M, candidateVersionId: versionId, productionVersion: null, records });
    const n = await prisma.mlShadowPrediction.count({ where: { candidateVersionId: versionId } });
    expect(n).toBe(3);
  });

  test("an unsettled candidate is not called better", async () => {
    const c = await mlShadowService.compare({ modelName: M, candidateVersionId: versionId });
    expect(c.settled).toBe(0);
    expect(c.candidateBetter).toBeNull();
    expect(c.verdict).toContain("NO_SETTLED_OUTCOMES");
  });

  test("outcomes settle once and cannot be rewritten", async () => {
    const first = await mlShadowService.settle({
      candidateVersionId: versionId,
      outcomes: [{ entityKey: "2026-08-01", actualValue: 5 }, { entityKey: "2026-08-02", actualValue: 5 }, { entityKey: "2026-08-03", actualValue: 5 }],
    });
    expect(first.settled).toBe(3);

    const second = await mlShadowService.settle({
      candidateVersionId: versionId,
      outcomes: [{ entityKey: "2026-08-01", actualValue: 999 }],
    });
    expect(second.settled).toBe(0);
    expect(second.skipped).toBe(1);

    const row = await prisma.mlShadowPrediction.findFirst({
      where: { candidateVersionId: versionId, entityKey: "2026-08-01" }, select: { actualValue: true },
    });
    expect(row?.actualValue).toBe(5);
  });

  test("an unknown entity is reported, never invented", async () => {
    const r = await mlShadowService.settle({
      candidateVersionId: versionId, outcomes: [{ entityKey: "1999-01-01", actualValue: 1 }],
    });
    expect(r.unknown).toBe(1);
    expect(r.settled).toBe(0);
  });

  test("the comparison scores both arms on the same rows", async () => {
    // candidate 4 vs actual 5 -> MAE 1; production 6 vs actual 5 -> MAE 1... candidate not better.
    const c = await mlShadowService.compare({ modelName: M, candidateVersionId: versionId });
    expect(c.settled).toBe(3);
    expect(c.comparableRows).toBe(3);
    expect(c.candidate?.mae).toBe(1);
    expect(c.production?.mae).toBe(1);
    expect(c.candidateBetter).toBe(false);
    expect(c.verdict).toContain("CANDIDATE_NOT_BETTER");
  });

  test("a candidate with no opponent is reported as unopposed, not as a winner", async () => {
    const v = await candidate(`${M}_solo`);
    await mlShadowService.record({
      modelName: `${M}_solo`, candidateVersionId: v.id, productionVersion: null,
      records: [{ entityKey: "2026-08-05", predictedFor: new Date("2026-08-05T00:00:00Z"), candidateValue: 3, productionValue: null }],
    });
    await mlShadowService.settle({ candidateVersionId: v.id, outcomes: [{ entityKey: "2026-08-05", actualValue: 3 }] });
    const c = await mlShadowService.compare({ modelName: `${M}_solo`, candidateVersionId: v.id });
    expect(c.settled).toBe(1);
    expect(c.comparableRows).toBe(0);
    expect(c.candidateBetter).toBeNull();
    expect(c.verdict).toContain("CANDIDATE_ONLY");
  });

  test("shadow wrote nothing outside its own table", async () => {
    expect(await snapshot()).toEqual(baseline);
  });
});

/* ═════════════════════════ readiness and leakage ═══════════════════════════ */

describe("readiness is measured, and leakage is counted", () => {
  test("every Phase-12 model is assessed, none silently omitted", async () => {
    const r = await mlReadinessService.assessAll();
    const names = r.models.map((m) => m.model).sort();
    expect(names).toEqual([
      "churn", "clv", "demand_forecast", "eta", "gps_fraud",
      "personalized_recommendations", "provider_ranking_ltr", "support_classification",
    ]);
    expect(Object.values(READINESS)).toContain(r.models[0]!.readiness);
  }, 120_000);

  /**
   * A verdict must never contradict its own decision.
   *
   * An earlier version of this service returned DATA_UNTRUSTED alongside BUILD_NOW, which would have
   * told an operator to train on a series the pipeline had stopped filling three weeks earlier.
   */
  test("an untrusted or insufficient model is never marked BUILD_NOW", async () => {
    const r = await mlReadinessService.assessAll();
    for (const m of r.models) {
      if (m.readiness === READINESS.DATA_INSUFFICIENT || m.readiness === READINESS.DATA_UNTRUSTED) {
        expect(m.decision).not.toBe("BUILD_NOW");
      }
    }
  }, 120_000);

  test("a blocking leak carries a reason and, where countable, a row count", async () => {
    const r = await mlReadinessService.assessAll();
    for (const m of r.models) {
      for (const l of m.leakage) {
        expect(l.detail.length).toBeGreaterThan(40);
        expect(["BLOCKING", "WARNING"]).toContain(l.severity);
        if (l.affectedRows !== null) expect(l.affectedRows).toBeGreaterThanOrEqual(0);
      }
    }
  }, 120_000);

  test("ETA readiness names distance as the binding constraint, from real label counts", async () => {
    const eta = await mlReadinessService.eta();
    expect(eta.model).toBe("eta");
    expect(eta.readiness).toBe(READINESS.DATA_INSUFFICIENT);
    expect(eta.decision).toBe("DATA_INSUFFICIENT");
    expect(typeof eta.evidence.withTravelDistance).toBe("number");
    expect(typeof eta.evidence.trainingReady).toBe("number");
    // The blocker must say what would actually unblock it, not "collect more data".
    expect(String(eta.blocker)).toContain("distance");
  }, 60_000);

  test("models with no relevance label keep the existing engine rather than replacing it", async () => {
    const ltr = await mlReadinessService.providerRanking();
    const fraud = await mlReadinessService.gpsFraud();
    expect(ltr.decision).toBe("KEEP_EXISTING");
    expect(fraud.decision).toBe("KEEP_EXISTING");
    expect(ltr.leakage.some((l) => l.severity === "BLOCKING")).toBe(true);
  }, 60_000);

  test("evidence is numbers or explicit strings, never undefined", async () => {
    const r = await mlReadinessService.assessAll();
    for (const m of r.models) {
      expect(Object.keys(m.evidence).length).toBeGreaterThan(0);
      for (const [, v] of Object.entries(m.evidence)) {
        expect(v === undefined).toBe(false);
      }
    }
  }, 120_000);
});

/* ════════════════════════════════ RBAC ═════════════════════════════════════ */

describe("RBAC covers every governance route at the right strength", () => {
  const cases: Array<[string, string, string, string]> = [
    ["GET", "/api/admin/ml/health", "ANALYTICS", "READ"],
    ["GET", "/api/admin/ml/readiness", "ANALYTICS", "READ"],
    ["GET", "/api/admin/ml/models", "ANALYTICS", "READ"],
    ["GET", "/api/admin/ml/models/demand/versions", "ANALYTICS", "READ"],
    ["GET", "/api/admin/ml/demand/evaluation", "ANALYTICS", "READ"],
    ["GET", "/api/admin/ml/demand/forecast", "ANALYTICS", "READ"],
    ["GET", "/api/admin/ml/shadow/abc", "ANALYTICS", "READ"],
    ["POST", "/api/admin/ml/models/demand/versions", "SETTINGS", "UPDATE"],
    ["POST", "/api/admin/ml/versions/abc/transition", "SETTINGS", "UPDATE"],
    ["POST", "/api/admin/ml/versions/abc/approve", "SETTINGS", "APPROVE"],
    ["POST", "/api/admin/ml/versions/abc/promote", "SETTINGS", "APPROVE"],
    ["POST", "/api/admin/ml/models/demand/rollback", "SETTINGS", "APPROVE"],
  ];
  for (const [method, path, resource, action] of cases) {
    test(`${method} ${path} requires ${resource}/${action}`, () => {
      const r = resolveAdminRoutePermission(method, path);
      expect(r).not.toBeNull();
      expect(String(r!.resource)).toBe(resource);
      expect(String(r!.action)).toBe(action);
    });
  }

  test("promotion is a stronger permission than registering a candidate", () => {
    const register = resolveAdminRoutePermission("POST", "/api/admin/ml/models/demand/versions");
    const promote = resolveAdminRoutePermission("POST", "/api/admin/ml/versions/abc/promote");
    expect(String(register!.action)).toBe("UPDATE");
    expect(String(promote!.action)).toBe("APPROVE");
  });

  test("an unmapped governance route is denied by default", () => {
    expect(resolveAdminRoutePermission("POST", "/api/admin/ml/versions/abc/force-live")).toBeNull();
  });
});

/* ═══════════════════ contracts, artifacts and database safety ══════════════ */

describe("contracts and database safety", () => {
  test("a rule-based artifact still has a stable, content-derived hash", () => {
    const a = deterministicArtifactHash({ strategy: "NAIVE", floor: 0 });
    const b = deterministicArtifactHash({ strategy: "NAIVE", floor: 0 });
    const c = deterministicArtifactHash({ strategy: "NAIVE", floor: 1 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(32);
  });

  test("the stage vocabulary is exactly the governed lifecycle", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ v: string }>>(
      `SELECT unnest(enum_range(NULL::"MlModelStage"))::text AS v`,
    );
    expect(rows.map((r) => r.v).sort()).toEqual([
      "APPROVED", "CANDIDATE", "EVALUATED", "PRODUCTION", "REJECTED",
      "RETIRED", "ROLLED_BACK", "SHADOW", "TRAINED", "TRAINING",
    ]);
  });

  test("no shadow row is orphaned from its model version", async () => {
    const orphans = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*) AS n FROM ml_shadow_predictions s
        WHERE NOT EXISTS (SELECT 1 FROM ml_model_versions v WHERE v.id = s.candidate_version_id)`,
    );
    expect(Number(orphans[0]!.n)).toBe(0);
  });

  test("no model has two production versions", async () => {
    const dupes = await prisma.$queryRawUnsafe<Array<{ model_name: string; n: bigint }>>(
      `SELECT model_name, COUNT(*) AS n FROM ml_model_versions
        WHERE stage = 'PRODUCTION' GROUP BY model_name HAVING COUNT(*) > 1`,
    );
    expect(dupes).toEqual([]);
  });

  test("every promoted version carries an approver", async () => {
    const unapproved = await prisma.mlModelVersion.count({
      where: { stage: "PRODUCTION", approvedBy: null },
    });
    expect(unapproved).toBe(0);
  });

  test("this suite mutated no business state", async () => {
    expect(await snapshot()).toEqual(baseline);
  });
});
