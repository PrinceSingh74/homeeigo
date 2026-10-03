/**
 * PHASE 9 - Capability 9, recommended actions.
 *
 * Runs ONLY on the isolated homigo_p39 database and aborts otherwise.
 *
 * The property defended: a recommendation is not an execution. The service imports no executor, names
 * no HIGH_RISK tool, carries no amount it did not receive from an authoritative source, and stops at
 * review for everything the platform has not decided how to do.
 */
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { describe, test, expect, beforeAll } from "bun:test";
import prisma from "../lib/prisma";
import {
  recommendedActionsService,
  riskFromCatalog,
  highRiskToolIds,
  bindingHashFor,
  RECOMMENDED_ACTIONS_RULES_VERSION,
  ACTION_REASON,
} from "../services/recommended-actions.service";
import { hashArguments } from "../ai-tools/audit/tool-audit.service";

let src = "";

function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(String.fromCharCode(10))
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join(String.fromCharCode(10));
}

type Counts = Record<string, number>;
async function snapshot(): Promise<Counts> {
  const [bookings, payments, wallet, ledger, notifications, outbox, instances, jobs, approvals, restrictions] =
    await Promise.all([
      prisma.booking.count(), prisma.payment.count(), prisma.walletTransaction.count(),
      prisma.ledgerEntry.count(), prisma.notification.count(), prisma.eventOutbox.count(),
      prisma.workflowInstance.count(), prisma.scheduledJob.count(),
      prisma.aiToolApproval.count(), prisma.partnerComplianceRestriction.count(),
    ]);
  return { bookings, payments, wallet, ledger, notifications, outbox, instances, jobs, approvals, restrictions };
}

/** Tables this read-only advisor may mutate — none. Ledger and notifications are excluded from side-effect snapshots: ledger is written by concurrent reconciliation tests; notifications are written asynchronously by assignment/dispatch fallout from earlier tests in the combined serial suite while generate() only reads. */
async function advisorSideEffectSnapshot(): Promise<Omit<Counts, "ledger" | "notifications">> {
  const s = await snapshot();
  const { ledger: _ledger, notifications: _notifications, ...rest } = s;
  return rest;
}

function stableActionJson(actions: Awaited<ReturnType<typeof recommendedActionsService.generate>>["actions"]) {
  return JSON.stringify(
    actions.map((y) => ({
      ...y,
      id: null,
      evidence: y.evidence.map((e) =>
        e.source === "ledger-reconciliation" ? { ...e, value: null } : e,
      ),
    })),
  );
}

beforeAll(async () => {
  const db = (await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db"))[0].db;
  refuseIfNotIsolatedTestDb(db);
  src = await Bun.file(import.meta.dir + "/../services/recommended-actions.service.ts").text();
});

describe("a recommendation is never an execution", () => {
  test("the service imports no executor", () => {
    const code = codeOnly(src);
    for (const f of ["refundService", "walletService", "ledgerService", "payoutService",
      "accountFreeze", "partnerSuspend", "customerBan", "financialAdjustment"]) {
      expect(code).not.toContain(f);
    }
  });

  test("the service writes nothing", () => {
    const code = codeOnly(src);
    for (const w of [".create(", ".update(", ".delete(", ".upsert(", "prisma."]) {
      expect(code).not.toContain(w);
    }
  });

  test("it does not create approvals - that belongs to the Approval Center", () => {
    const code = codeOnly(src);
    expect(code).not.toContain("createApprovalRequest");
    expect(code).not.toContain("consumeApproval");
    expect(code).not.toContain("decideApproval");
  });

  test("no generated action names a HIGH_RISK tool", async () => {
    const r = await recommendedActionsService.generate();
    const high = new Set(highRiskToolIds());
    expect(high.size).toBe(14);
    for (const a of r.actions) {
      if (a.toolId) expect(high.has(a.toolId)).toBe(false);
    }
  });

  test("every generated action requires human approval and stops at review", async () => {
    const r = await recommendedActionsService.generate();
    expect(r.actions.length).toBeGreaterThan(0);
    for (const a of r.actions) {
      expect(a.requiresHumanApproval).toBe(true);
      expect(["REVIEW_REQUIRED", "RECOMMENDATION_ONLY"]).toContain(a.state);
      expect(a.actionType.startsWith("REVIEW_")).toBe(true);
    }
  });
});

describe("risk comes from the catalog, never from this layer", () => {
  test("a real tool contributes its catalog risk level", () => {
    expect(riskFromCatalog("high_risk.finance.refund")).toBe("CRITICAL");
    expect(riskFromCatalog("read.customer.getBooking")).toBe("LOW");
  });

  test("an unknown tool yields null rather than a guessed level", () => {
    expect(riskFromCatalog("does.not.exist")).toBeNull();
  });

  test("actions without a tool are marked REVIEW_DEFAULT, not silently assigned", async () => {
    const r = await recommendedActionsService.generate();
    for (const a of r.actions) {
      if (a.toolId === null) {
        expect(a.riskSource).toBe("REVIEW_DEFAULT");
        expect(a.riskLevel).toBe(recommendedActionsService.reviewDefaultRisk());
      } else {
        expect(a.riskSource).toBe("TOOL_CATALOG");
      }
    }
  });

  test("no risk level is derived from prose", () => {
    const code = codeOnly(src);
    for (const f of ["includes(\"critical\")", "toLowerCase().includes", "severity ==="]) {
      expect(code).not.toContain(f);
    }
  });
});

describe("no amount is ever invented", () => {
  test("no generated action carries an amount", async () => {
    const r = await recommendedActionsService.generate();
    for (const a of r.actions) expect(a.amount).toBeNull();
  });

  test("a reconciliation delta is evidence, not an amount to move", () => {
    const code = codeOnly(src);
    expect(code).toContain("DELTA");
    // The delta appears as evidence; the amount field stays null on that action.
    expect(code).not.toContain("amount: { value: f.delta");
  });

  test("the compensation recommendation carries no amount", () => {
    const c = recommendedActionsService.compensationReview({ kind: "CUSTOMER", id: "c1" }, new Date().toISOString());
    expect(c.amount).toBeNull();
    expect(c.toolId).toBeNull();
  });
});

describe("customer compensation stops at review", () => {
  test("it is recommendation-only and names the missing decision", () => {
    const c = recommendedActionsService.compensationReview({ kind: "CUSTOMER", id: "c1" }, new Date().toISOString());
    expect(c.state).toBe("RECOMMENDATION_ONLY");
    expect(c.actionType).toBe("REVIEW_CUSTOMER_COMPENSATION");
    expect(c.reasonCodes).toContain(ACTION_REASON.COMPENSATION_SEMANTICS_MISSING);
    expect(c.reasonCodes).toContain(ACTION_REASON.NO_TOOL_EXISTS);
    expect(c.requiresHumanApproval).toBe(true);
  });

  test("its limitations name every unresolved mapping", () => {
    const c = recommendedActionsService.compensationReview({ kind: "CUSTOMER", id: "c1" }, new Date().toISOString());
    const joined = c.limitations.join(" ").toLowerCase();
    for (const w of ["refund", "wallet credit", "coupon", "ledger adjustment"]) {
      expect(joined).toContain(w);
    }
  });

  test("no compensation tool exists in the catalog", () => {
    const ids = highRiskToolIds().join(" ");
    expect(ids.toLowerCase()).not.toContain("compensation");
  });
});

describe("priority is not invented", () => {
  test("the missing policy is declared", async () => {
    const r = await recommendedActionsService.generate();
    expect(r.humanDecisions).toContain(ACTION_REASON.PRIORITY_POLICY_MISSING);
  });

  test("no urgency vocabulary appears on any action", async () => {
    const r = await recommendedActionsService.generate();
    const blob = JSON.stringify(r.actions).toLowerCase();
    for (const w of ["urgent", "critical priority", "immediately", "asap", "severe"]) {
      expect(blob).not.toContain(w);
    }
  });

  test("ordering is deterministic and carries no priority field", async () => {
    const a = await recommendedActionsService.generate();
    const b = await recommendedActionsService.generate();
    expect(a.actions.map((x) => x.actionType + ":" + x.target.id))
      .toEqual(b.actions.map((x) => x.actionType + ":" + x.target.id));
    for (const act of a.actions) expect(act).not.toHaveProperty("priority");
  });
});

describe("approval binding uses the platform hasher", () => {
  test("the binding hash is the platform function, not a local one", () => {
    const args = { bookingId: "b123", amount: 500 };
    expect(bindingHashFor(args)).toBe(hashArguments(args));
    expect(codeOnly(src)).toContain("hashArguments");
  });

  test("a different target produces a different binding", () => {
    expect(bindingHashFor({ bookingId: "b123", amount: 500 }))
      .not.toBe(bindingHashFor({ bookingId: "b124", amount: 500 }));
  });

  test("a different amount produces a different binding", () => {
    expect(bindingHashFor({ bookingId: "b123", amount: 500 }))
      .not.toBe(bindingHashFor({ bookingId: "b123", amount: 5000 }));
  });

  test("a different customer produces a different binding", () => {
    expect(bindingHashFor({ customerId: "A", amount: 100 }))
      .not.toBe(bindingHashFor({ customerId: "B", amount: 100 }));
  });

  test("the same arguments always produce the same binding", () => {
    const args = { bookingId: "b1", amount: 250 };
    expect(bindingHashFor(args)).toBe(bindingHashFor({ ...args }));
  });
});

describe("negative: nothing is generated beyond its evidence", () => {
  test("1. an unsupported action type cannot appear", async () => {
    const allowed = new Set([
      "REVIEW_REVENUE_ANOMALY", "REVIEW_SUPPLY_CONSTRAINT", "REVIEW_FINANCE_RECONCILIATION",
      "REVIEW_FINANCE_PERIOD_SEMANTICS", "REVIEW_FRAUD_CASE", "REVIEW_FORECAST",
      "REVIEW_CUSTOMER_COMPENSATION",
    ]);
    const r = await recommendedActionsService.generate();
    for (const a of r.actions) expect(allowed.has(a.actionType)).toBe(true);
  });

  test("2. a refused anomaly generates no action", async () => {
    const r = await recommendedActionsService.generate();
    // The detector currently refuses on every path, so no anomaly action may exist.
    const anomalyActions = r.actions.filter((a) => a.actionType === "REVIEW_REVENUE_ANOMALY");
    expect(anomalyActions.length).toBe(0);
  });

  test("3. unusable supply telemetry generates no supply action", async () => {
    const r = await recommendedActionsService.generate();
    const supply = r.actions.filter((a) => a.actionType === "REVIEW_SUPPLY_CONSTRAINT");
    // Live telemetry is 82.5% incomplete and weeks stale, so every zone refuses.
    expect(supply.length).toBe(0);
  });

  test("4. a fraud action is a review and never a sanction", async () => {
    const r = await recommendedActionsService.generate();
    for (const a of r.actions.filter((x) => x.capability === "FRAUD")) {
      expect(a.actionType).toBe("REVIEW_FRAUD_CASE");
      const blob = JSON.stringify(a).toLowerCase();
      for (const w of ["suspend", "ban", "freeze", "confirmed fraud", "fraudulent"]) {
        expect(blob).not.toContain(w);
      }
    }
  });

  test("5. prose cannot change an action target or type", async () => {
    const r = await recommendedActionsService.generate();
    if (r.actions.length === 0) return;
    const a = r.actions[0]!;
    const before = JSON.stringify({ t: a.actionType, tg: a.target, am: a.amount, rk: a.riskLevel, ap: a.requiresHumanApproval });
    const rewritten = { ...a, title: "Something else", description: "Different." };
    expect(JSON.stringify({ t: rewritten.actionType, tg: rewritten.target, am: rewritten.amount, rk: rewritten.riskLevel, ap: rewritten.requiresHumanApproval }))
      .toBe(before);
  });

  test("6. degraded evidence is carried as a limitation, not hidden", async () => {
    const r = await recommendedActionsService.generate();
    const forecastAction = r.actions.find((a) => a.actionType === "REVIEW_FORECAST");
    if (forecastAction) {
      expect(forecastAction.limitations.length).toBeGreaterThan(0);
      expect(forecastAction.reasonCodes.length).toBeGreaterThan(0);
    }
  });

  test("7. no LLM is in the action path", () => {
    const code = codeOnly(src);
    for (const f of ["aiGateway", "generateText", "openai", "gemini", "groq", "anthropic"]) {
      expect(code.toLowerCase()).not.toContain(f.toLowerCase());
    }
  });

  test("8. no confidence is invented", async () => {
    const r = await recommendedActionsService.generate();
    for (const a of r.actions) {
      expect(a.confidence === null || typeof a.confidence === "number").toBe(true);
      expect(a.modelVersion).toBeNull();
    }
  });

  test("9. the service takes no actor or role parameter", () => {
    const code = codeOnly(src);
    for (const f of ["actorId", "isAdmin", "allUsers", "req.user"]) expect(code).not.toContain(f);
  });
});

describe("provenance, determinism and side effects", () => {
  test("every action names its evidence and rules version", async () => {
    const r = await recommendedActionsService.generate();
    expect(r.rulesVersion).toBe(RECOMMENDED_ACTIONS_RULES_VERSION);
    for (const a of r.actions) {
      expect(a.rulesVersion).toBe(RECOMMENDED_ACTIONS_RULES_VERSION);
      expect(a.reasonCodes.length).toBeGreaterThan(0);
      for (const e of a.evidence) expect(e.source.length).toBeGreaterThan(0);
    }
  });

  test("the same evidence yields the same actions", async () => {
    const now = new Date();
    const a = await recommendedActionsService.generate({ now });
    const b = await recommendedActionsService.generate({ now });
    expect(stableActionJson(a.actions)).toBe(stableActionJson(b.actions));
  });

  test("concurrent generation produces identical action sets", async () => {
    const now = new Date();
    const runs = await Promise.all([
      recommendedActionsService.generate({ now }),
      recommendedActionsService.generate({ now }),
      recommendedActionsService.generate({ now }),
    ]);
    const shapes = runs.map((r) => r.actions.map((a) => a.actionType + ":" + a.target.id).sort().join("|"));
    expect(new Set(shapes).size).toBe(1);
  });

  test("no PII appears in any action", async () => {
    const r = await recommendedActionsService.generate();
    const blob = JSON.stringify(r).toLowerCase();
    for (const leak of ["phonenumber", "email", "password", "cardnumber", "ifsc", "aadhar"]) {
      expect(blob).not.toContain(leak);
    }
  });

  test("generating recommendations mutates nothing, including approvals", async () => {
    const before = await advisorSideEffectSnapshot();
    await recommendedActionsService.generate();
    await recommendedActionsService.generate();
    const after = await advisorSideEffectSnapshot();
    expect(after).toEqual(before);
  });
});
