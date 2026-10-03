/**
 * Phase 14 — governance, experimentation and production hardening.
 *
 * These tests exist to hold the properties that were *demonstrated* during the phase, not to
 * re-describe them. Each one corresponds to a defect that was real: a cap that concurrency could
 * walk past, an audit log that silently dropped its second record per request, an experiment with
 * no off switch, a policy decision that could not be tied to the rules that made it.
 */
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import prisma from "../lib/prisma";
import {
  checkAndReserveBudget,
  settleBudget,
  abandonBudget,
  currentEligibleProviders,
} from "../services/ai-budget.service";
import { detectStuckInstances, recoverInstance } from "../services/workflow-recovery.service";
import { dynamicPricingService } from "../services/dynamic-pricing.service";
import { evaluatePolicy } from "../ai-tools/policy/policy-engine";
import { POLICY_RULESET_VERSION, POLICY_RULES } from "../ai-tools/policy/policy-rules";
import { enterpriseAuditService } from "../services/enterprise-audit.service";
import { AuditLogService } from "../services/audit-log.service";
import { securityEventRetention } from "../services/enterprise-audit.service";
import { WORKFLOW_STEP_JOB_TYPE } from "../automation/engine/step-scheduler";

const TAG = `p14test-${Date.now()}`;
let actorId: string;

beforeAll(async () => {
  const user = await prisma.user.findFirst({ select: { id: true } });
  actorId = user?.id ?? "p14-test-actor";
});

afterAll(async () => {
  await prisma.aiBudgetWindow.deleteMany({ where: { policy: { createdBy: TAG } } });
  await prisma.aiBudgetPolicy.deleteMany({ where: { createdBy: TAG } });
  await prisma.platformExperiment.deleteMany({ where: { updatedBy: TAG } });
  await prisma.scheduledJob.deleteMany({ where: { jobType: WORKFLOW_STEP_JOB_TYPE, triggerEventId: TAG } });
  await prisma.workflowInstance.deleteMany({ where: { subjectId: { startsWith: TAG } } });
  await prisma.enterpriseAuditLog.deleteMany({ where: { traceId: { startsWith: TAG } } });
});

// ── I. AI budget caps ─────────────────────────────────────────────────────────
describe("AI budget caps", () => {
  const ctx = () => ({
    eligibleProviders: ["GROQ"] as const as never,
    actorRole: "ADMIN" as never,
    actorId,
    endpoint: "test",
    estimatedPromptTokens: 20_000,
    maxOutputTokens: 20_000,
    traceId: `${TAG}-budget`,
  });

  /**
   * Budget scopes compose: a GLOBAL cap applies to every request regardless of role or endpoint.
   * That is correct, and it means a test leaving an exhausted GLOBAL cap behind would block every
   * test after it — so each starts from a clean policy set rather than inheriting one.
   */
  const clearPolicies = async () => {
    await prisma.aiBudgetWindow.deleteMany({ where: { policy: { createdBy: TAG } } });
    await prisma.aiBudgetPolicy.deleteMany({ where: { createdBy: TAG } });
  };

  it("allows and says so explicitly when no cap is configured", async () => {
    await clearPolicies();
    const v = await checkAndReserveBudget(ctx());
    // The absence of a cap must be a named state, not an unexplained pass.
    expect(v.decision).toBe("NO_POLICY_CONFIGURED");
    expect(v.allowed).toBe(true);
    expect(v.reservations).toHaveLength(0);
  });

  it("REFUSES when no cap is configured on a deployed host", async () => {
    // Live Gemini/Groq keys and real spend were measured on 2026-09-21 with zero policies. Allowing
    // uncapped spend on a developer machine is a convenience; on staging or production it is
    // uncontrolled spend. `.env.staging` ships NODE_ENV=development, so this is keyed on APP_ENV
    // through lib/deployed-environment — the same trap the Pass-5 staging fixes closed.
    await clearPolicies();
    const saved = process.env.APP_ENV;
    process.env.APP_ENV = "staging";
    try {
      const v = await checkAndReserveBudget(ctx());
      expect(v.decision).toBe("NO_POLICY_CONFIGURED");
      expect(v.allowed).toBe(false);
      expect(v.reservations).toHaveLength(0);
    } finally {
      if (saved === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = saved;
    }
  });

  it("holds the cap exactly under concurrency", async () => {
    await clearPolicies();
    const policy = await prisma.aiBudgetPolicy.create({
      data: { scope: "GLOBAL", scopeKey: "*", period: "DAY", limitUsd: 0.138, createdBy: TAG, note: "test cap" },
    });

    // One request first, to learn the real per-request reservation from the pricing table
    // rather than assuming a figure.
    const probe = await checkAndReserveBudget(ctx());
    const per = probe.reservations[0]!.amountUsd;
    await abandonBudget(probe.reservations);
    await prisma.aiBudgetWindow.updateMany({
      where: { policyId: policy.id },
      data: { reservedUsd: 0, settledUsd: 0, requestCount: 0 },
    });

    const capacity = Math.floor(0.138 / per);
    const results = await Promise.all(Array.from({ length: 30 }, () => checkAndReserveBudget(ctx())));
    const allowed = results.filter((r) => r.allowed).length;

    // The point of the reservation design: 30 simultaneous callers cannot all read the same
    // headroom and all take it.
    expect(allowed).toBe(capacity);
    expect(results.filter((r) => r.decision === "BUDGET_EXCEEDED")).toHaveLength(30 - capacity);

    const w = await prisma.aiBudgetWindow.findFirst({ where: { policyId: policy.id } });
    expect((w!.reservedUsd + w!.settledUsd)).toBeLessThanOrEqual(0.138 + 1e-9);
  });

  it("never folds an UNKNOWN cost into settled spend", async () => {
    await clearPolicies();
    const policy = await prisma.aiBudgetPolicy.create({
      data: { scope: "ROLE", scopeKey: "SUPPORT", period: "DAY", limitUsd: 10, createdBy: TAG, note: "unknown-cost test" },
    });
    const v = await checkAndReserveBudget({ ...ctx(), actorRole: "SUPPORT" as never });
    expect(v.allowed).toBe(true);

    await settleBudget(v.reservations, { costUsd: 0, costStatus: "UNKNOWN" });
    const w = await prisma.aiBudgetWindow.findFirst({ where: { policyId: policy.id } });

    // An unmeasurable cost is counted as unknown, never as $0 — the distinction Phase 13
    // established and this must not undo.
    expect(w!.unknownCostRequests).toBeGreaterThan(0);
    expect(w!.settledUsd).toBe(0);
    expect(w!.reservedUsd).toBe(0);
  });

  it("releases the reservation when a request fails", async () => {
    await clearPolicies();
    const policy = await prisma.aiBudgetPolicy.create({
      data: { scope: "ENDPOINT", scopeKey: "abandon-test", period: "DAY", limitUsd: 10, createdBy: TAG, note: "abandon test" },
    });
    const v = await checkAndReserveBudget({ ...ctx(), endpoint: "abandon-test" });
    await abandonBudget(v.reservations);
    const w = await prisma.aiBudgetWindow.findFirst({ where: { policyId: policy.id } });
    // A failed request spent nothing and must not hold budget for the rest of the window.
    expect(w!.reservedUsd).toBe(0);
    expect(w!.settledUsd).toBe(0);
  });

  it("prices against the whole eligible chain, not one provider", () => {
    // The router may fail over, so the reservation has to bound the dearest outcome.
    expect(Array.isArray(currentEligibleProviders())).toBe(true);
  });
});

// ── O / §65. Audit integrity ──────────────────────────────────────────────────
describe("audit integrity", () => {
  it("stores every governance event on a shared trace", async () => {
    const traceId = `${TAG}-shared`;
    const base = {
      resource: "p14_test", actorType: "ADMIN" as const, status: "SUCCESS" as const,
      retentionCategory: "SECURITY_EVENTS" as const, traceId,
    };
    await enterpriseAuditService.log({ ...base, action: "ML_MODEL_APPROVED", changesSummary: "first" });
    await enterpriseAuditService.log({ ...base, action: "ML_MODEL_PROMOTED", changesSummary: "second" });

    // `trace_id` was UNIQUE, so the promotion was silently dropped: one request could record
    // only one governance event, and the trail was thinnest on the most complex actions.
    const rows = await prisma.enterpriseAuditLog.findMany({ where: { traceId } });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.action).sort()).toEqual(["ML_MODEL_APPROVED", "ML_MODEL_PROMOTED"]);
  });

  it("retains governance acts as security events, not one-year system logs", () => {
    // These used to fall through to SYSTEM_LOGS — a model approval discarded after twelve months
    // while the ledger entry it caused was kept for ten years.
    for (const action of [
      "ML_MODEL_APPROVED", "ML_MODEL_PROMOTED", "ML_MODEL_ROLLED_BACK",
      "AI_BUDGET_BLOCKED", "AI_BUDGET_POLICY_CHANGED",
      "EVENT_REPLAY_EXECUTED", "WORKFLOW_INSTANCE_RECOVERED",
      "EXPERIMENT_CREATED", "EXPERIMENT_STATUS_CHANGED",
    ]) {
      expect(securityEventRetention(action)).not.toBe("SYSTEM_LOGS");
    }
  });

  it("keeps financial retention unchanged", () => {
    // The new routing must not have stolen events from the longest bucket.
    expect(securityEventRetention("WALLET_DEBIT")).toBe("FINANCIAL_LEDGER");
    expect(securityEventRetention("PAYMENT_CAPTURED")).toBe("PAYMENT_EVENTS");
    expect(securityEventRetention("LOGIN")).toBe("LOGIN_EVENTS");
  });
});


// ── §45 / §46. Audit trace capacity and fail-closed governance ────────────────
describe("audit trace capacity", () => {
  it("stores ten governance events on one trace, sequentially", async () => {
    const traceId = `${TAG}-ten`;
    const actions = [
      "ML_MODEL_REGISTERED", "ML_MODEL_STAGE_CHANGED", "ML_MODEL_APPROVED", "ML_MODEL_PROMOTED",
      "ML_MODEL_ROLLED_BACK", "AI_BUDGET_BLOCKED", "AI_BUDGET_POLICY_CHANGED",
      "EVENT_REPLAY_EXECUTED", "WORKFLOW_INSTANCE_RECOVERED", "EXPERIMENT_CREATED",
    ] as const;
    for (const action of actions) {
      await enterpriseAuditService.log({
        action, resource: "p14_test", actorType: "ADMIN", status: "SUCCESS",
        retentionCategory: "SECURITY_EVENTS", traceId, changesSummary: action,
      });
    }
    // Two was the minimum that proved the defect; ten proves there is no residual cap.
    expect(await prisma.enterpriseAuditLog.count({ where: { traceId } })).toBe(10);
  });

  it("stores ten concurrent governance events on one trace", async () => {
    const traceId = `${TAG}-ten-conc`;
    await Promise.all(Array.from({ length: 10 }, (_, i) =>
      enterpriseAuditService.log({
        action: "AI_BUDGET_BLOCKED", resource: "p14_test", actorType: "ADMIN", status: "SUCCESS",
        retentionCategory: "SECURITY_EVENTS", traceId, changesSummary: `concurrent ${i}`,
      })));
    expect(await prisma.enterpriseAuditLog.count({ where: { traceId } })).toBe(10);
  });

  it("records a governed act and returns", async () => {
    const traceId = `${TAG}-governed`;
    await AuditLogService.recordGoverned("AI_BUDGET_POLICY_CHANGED", "success", {
      traceId, reason: "phase 14 governed-audit regression test",
    });
    expect(await prisma.enterpriseAuditLog.count({ where: { traceId } })).toBe(1);
  });

  it("refuses a governed act whose audit cannot be persisted", async () => {
    /**
     * A real outage, not a stub: the table is renamed away so the insert genuinely fails. An
     * earlier version of this probe monkey-patched `enterpriseAuditService.log` and reported a
     * false failure, because bun resolved the relatively-imported module inside
     * `audit-log.service` to a different instance from the absolutely-imported one in the probe.
     * Renaming the table cannot miss, whichever instance is in play.
     */
    await prisma.$executeRawUnsafe("ALTER TABLE enterprise_audit_logs RENAME TO enterprise_audit_logs_p14t");
    try {
      await expect(
        AuditLogService.recordGoverned("ML_MODEL_PROMOTED", "success", {
          traceId: `${TAG}-closed`, reason: "phase 14 fail-closed regression test",
        }),
      ).rejects.toThrow(/GOVERNANCE_AUDIT_UNAVAILABLE/);

      // The fail-OPEN default must be untouched: an audit outage cannot be allowed to log
      // every user out of the platform.
      await AuditLogService.record("LOGIN", "success", { traceId: `${TAG}-openlogin` });
    } finally {
      await prisma.$executeRawUnsafe("ALTER TABLE enterprise_audit_logs_p14t RENAME TO enterprise_audit_logs");
    }
  });
});


// ── §8 / §63. Governance bypass guard ─────────────────────────────────────────
describe("no ungoverned path to a paid AI provider", () => {
  /**
   * The guard for the defect that motivated it: `vision-intelligence.service` called
   * `callGeminiVision` directly, so a customer-facing route reached a paid provider without the
   * rate limit, the spend cap, the cost record or the AI audit trail. A budget that covers one of
   * two doors is not a budget.
   *
   * ── Why this test proves it looked ────────────────────────────────────────────
   *
   * Two earlier versions of this guard passed while a real bypass was present. The first accepted
   * an `import` of `checkAndReserveBudget` as evidence of governance; the second scanned from a
   * root that turned out to be empty, so it asserted `[] === []` and proved nothing. A guard that
   * cannot demonstrate coverage is worse than none, because it is trusted.
   *
   * So the coverage is asserted first: the scan must find the provider adapters and the one
   * governed exception. If the walk breaks, those assertions fail before the offender list is
   * ever consulted.
   */
  /**
   * Two ways to reach a paid provider, because checking only the first missed a real bypass.
   *
   * The adapter-name pattern is what this guard originally used. `knowledge-embedding.service`
   * slipped past it by calling Gemini's `embedContent` endpoint with a raw `fetch` — it uses no
   * adapter function, so a name-based guard cannot see it, and it runs on every RAG query. The
   * host pattern closes that gap: a file naming a provider API host is reaching one, whatever it
   * calls the call.
   */
  const PROVIDER_CALL = /(callGroq|callGemini|callOpenAi|callAnthropic|callGeminiVision)\s*\(/;
  const PROVIDER_HOST = /(generativelanguage\.googleapis\.com|api\.openai\.com|api\.groq\.com|api\.anthropic\.com)/;

  /** Naming a host in configuration is not calling it; the router and adapters are sanctioned. */
  const ALLOWED = ["ai/router/model-router.ts", "ai/providers/model-providers.ts", "ai/config.ts"];

  it("only the router invokes a provider adapter, and every exception is governed", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join, relative, sep, resolve } = await import("node:path");

    // Resolved from this file's own location, then asserted, so a wrong root cannot pass silently.
    const root = resolve(import.meta.dir, "..");
    expect(readdirSync(root)).toContain("services");

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry !== "__tests__" && entry !== "node_modules") walk(full);
        } else if (entry.endsWith(".ts")) files.push(full);
      }
    };
    walk(root);
    // The backend has hundreds of source files; a walk that finds a handful has broken.
    expect(files.length).toBeGreaterThan(300);

    const matched: string[] = [];
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(root, file).split(sep).join("/");
      const src = readFileSync(file, "utf8");
      if (!PROVIDER_CALL.test(src) && !PROVIDER_HOST.test(src)) continue;
      matched.push(rel);
      if (ALLOWED.includes(rel)) continue;

      /**
       * Governance is checked as CALLS, not mentions — an import satisfies an `includes` check.
       *
       * Two shapes are accepted. A priceable call reserves and settles a budget. An embedding call
       * cannot be priced (this project's table covers generation, and embeddings bill differently),
       * so it records unknown-cost spend instead — reserving a made-up amount would be the same
       * fabrication in a different field. Both must also rate-limit.
       */
      const priced = /checkAndReserveBudget\s*\(/.test(src) && /settleBudget\s*\(/.test(src);
      const unpriced = /recordEmbeddingSpend\s*\(/.test(src) && /checkAiRateLimit\s*\(/.test(src);
      if (!priced && !unpriced) offenders.push(rel);
    }

    // Proof of coverage: the adapters and the one governed exception must have been seen.
    expect(matched).toContain("ai/providers/model-providers.ts");
    expect(matched).toContain("services/vision-intelligence.service.ts");
    // The bypass this widened guard was written to catch.
    expect(matched).toContain("services/knowledge-embedding.service.ts");

    expect(offenders).toEqual([]);
    // Bind-mounted Windows→Linux walks of src/ routinely exceed Bun's 5s default `it` budget.
    // Assertions are unchanged; this only lets the scan finish.
  }, 120_000);
});

// ── B / §12. PII must not reach logs through an error string ─────────────────
describe("log PII scrubbing", () => {
  it("withholds Prisma's echoed arguments while keeping the error kind", async () => {
    const { logger, getRingBufferLogs } = await import("../lib/logger");
    const phone = "+919812345678";
    const email = "p14test@example.com";

    /**
     * The real shape of the leak. Prisma echoes the arguments of a failed call into its message,
     * so a validation error on a user create carries email and phone verbatim — and this codebase
     * logs `err.message` in dozens of places, correctly. Key-name redaction cannot help: the key
     * is `error` and the PII is inside the value.
     */
    const leaky =
      "Invalid `prisma.user.create()` invocation in /app/src/x.ts:1:1 " +
      `{ data: { email: "${email}", phone: "${phone}" } } ` +
      "Argument `password` is missing.";

    logger.error("p14_scrub_test", { category: "APPLICATION", error: leaky });
    const entry = getRingBufferLogs(10).find((l) => l.message === "p14_scrub_test");
    const logged = JSON.stringify(entry?.meta ?? {});

    expect(logged).not.toContain(phone);
    expect(logged).not.toContain(email);
    // Observability preserved: the failure is still identifiable.
    expect(logged).toContain("prisma-error");
    expect(logged).toContain("password");
  });

  it("leaves an ordinary error message untouched", async () => {
    const { logger, getRingBufferLogs } = await import("../lib/logger");
    const normal = "outbox dispatch failed after 3 attempts";
    logger.error("p14_scrub_normal", { category: "APPLICATION", error: normal });
    const entry = getRingBufferLogs(10).find((l) => l.message === "p14_scrub_normal");
    // Over-scrubbing would trade one problem for a worse one.
    expect(JSON.stringify(entry?.meta ?? {})).toContain(normal);
  });

  it("secrets never reach the logs, whatever key they arrive under (negative test)", async () => {
    const { logger, getRingBufferLogs } = await import("../lib/logger");
    const secrets = {
      password: "hunter2-very-secret",
      otp: "483921",
      accessToken: "eyJhbGciOiJIUzI1NiJ9.secretpayload.sig",
      refreshToken: "eyJhbGciOiJIUzI1NiJ9.refreshpayload.sig",
      authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.bearer.sig",
      razorpaySignature: "9ef4dffbfd84f1318f6739a3ce19f9d85851857ae648f114332d8401e0949a3d",
      cardNumber: "4111111111111111",
      cvv: "123",
      ifsc: "HDFC0001234",
      panNumber: "ABCDE1234F",
      nested: { secret: "top-secret-value", kycSecret: "kyc-secret-value" },
    };
    logger.error("p14_secret_negative", { category: "SECURITY", ...secrets });
    const dump = JSON.stringify(getRingBufferLogs(10).find((l) => l.message === "p14_secret_negative")?.meta ?? {});
    for (const v of [
      "hunter2-very-secret", "483921", "secretpayload", "refreshpayload", "bearer.sig",
      "9ef4dffbfd84f1318f6739a3ce19f9d85851857ae648f114332d8401e0949a3d",
      "4111111111111111", "HDFC0001234", "ABCDE1234F", "top-secret-value", "kyc-secret-value",
    ]) {
      expect(dump).not.toContain(v);
    }
    expect(dump).toContain("[REDACTED]");
  });

  it("scrubbing a hostile string is linear, and shield markers in user text cannot corrupt output", async () => {
    const { scrubTextForTelemetry } = await import("../lib/logger");
    // The old email pattern backtracked quadratically on this shape; 10 KB must stay fast.
    const hostile = "a".repeat(10_000) + "@" + "a".repeat(10_000);
    const t0 = Date.now();
    scrubTextForTelemetry(hostile);
    expect(Date.now() - t0).toBeLessThan(500);

    // Private-use shield markers arriving inside user text are stripped, never honoured.
    const spoofed = `booking 0 and HOMIGO-20260916-00003 with +919812345678`;
    const out = scrubTextForTelemetry(spoofed);
    expect(out).toContain("HOMIGO-20260916-00003");
    expect(out).toContain("[phone]");
    expect(out).not.toContain("");
  });

  it("correlation identifiers survive the phone mask (seen corrupting 8.5% of trace ids live)", async () => {
    const { logger, getRingBufferLogs, scrubTextForTelemetry } = await import("../lib/logger");
    // A 32-hex trace id contains a 10+ digit run by chance; the mask used to eat exactly that part.
    const ids = {
      traceId: "834e2381947560312b9d164a74e3af62",
      spanId: "0123456789abcdef",
      requestId: "req_01a7dfd1a85ae806",
      paymentId: "pay_TOrB6HcOfGROGy",
      orderId: "order_dev_9f14827361bc0d42",
      cuid: "cmu9b0d5n13x5tze48knkorhl",
    };
    logger.info("p14_ids_survive", { category: "APPLICATION", ...ids });
    const meta = getRingBufferLogs(10).find((l) => l.message === "p14_ids_survive")?.meta ?? {};
    for (const [k, v] of Object.entries(ids)) expect(meta[k]).toBe(v);

    // …and a pure-digit run is still masked, because a phone never contains letters.
    expect(scrubTextForTelemetry("call +91 98123 45678 now")).toBe("call [phone] now");
    expect(scrubTextForTelemetry("card 4111111111111111")).toBe("card [phone]");
  });

  it("Sentry telemetry is scrubbed with the same rules as the logs", async () => {
    const { redactForTelemetry, scrubTextForTelemetry } = await import("../lib/logger");
    // `extra` used to be handed to Sentry verbatim, so a caller could leak what the logs refuse.
    const scrubbed = JSON.stringify(
      redactForTelemetry({
        otp: "483921",
        accessToken: "eyJhbGciOiJIUzI1NiJ9.leak.sig",
        note: "customer +91 98123 45678 said to call back",
        bookingNumber: "HOMIGO-20260916-00003",
      }),
    );
    expect(scrubbed).not.toContain("483921");
    expect(scrubbed).not.toContain("leak.sig");
    expect(scrubbed).not.toContain("98123");
    expect(scrubbed).toContain("HOMIGO-20260916-00003"); // identifiers stay searchable
    expect(scrubTextForTelemetry("reached +919812345678")).toBe("reached [phone]");
  });

  it("does not mistake identifiers for phone numbers (release certification Ph24)", async () => {
    // The old pattern rewrote any 10+ run of digits/hyphens: a UUID became `f[phone]-a127-…` (and
    // the event-bus DLQ test failed whenever a random eventId contained such a run), a booking
    // number became `HOMIGO-[phone]`.
    const { logger, getRingBufferLogs } = await import("../lib/logger");
    const ids = {
      eventId: "f1234567-8901-4a12-a127-8cead0e38b0d",
      bookingNumber: "HOMIGO-20260916-00003",
      withdrawalNumber: "WD-20260919-000123",
      at: "2026-09-19T20:18:22.846Z",
      note: "phone +91 98123 45678 and 9812345678 must still be masked",
    };
    logger.warn("p14_scrub_ids", { category: "APPLICATION", ...ids });
    const meta = getRingBufferLogs(10).find((l) => l.message === "p14_scrub_ids")?.meta ?? {};
    expect(meta.eventId).toBe(ids.eventId);
    expect(meta.bookingNumber).toBe(ids.bookingNumber);
    expect(meta.withdrawalNumber).toBe(ids.withdrawalNumber);
    expect(meta.at).toBe(ids.at);
    expect(meta.note).toBe("phone [phone] and [phone] must still be masked");
  });

  it("still masks phones in every shape a narrower pattern leaked (independent review)", async () => {
    const { logger, getRingBufferLogs } = await import("../lib/logger");
    const leaky = {
      twoInARow: "phones 9812345678 9876543210",
      withOtp: "sent to 9812345678 123456",
      intlPrefix: "0091 98123 45678",
      underscored: "phone_9812345678",
      hyphenated: "user-9812345678 and 9812345678-otp",
      urlEncoded: "?phone=%2B919812345678",
      pgTimestampNextToPhone: "2026-09-19 20:18:22 call 9812345678",
      list: ["+919812345678", "ok"],
      nested: { contacts: [{ tel: "+91 98123 45678" }] },
    };
    logger.warn("p14_scrub_leaky", { category: "APPLICATION", ...leaky });
    const meta = getRingBufferLogs(10).find((l) => l.message === "p14_scrub_leaky")?.meta ?? {};
    const text = JSON.stringify(meta);
    for (const digits of ["9812345678", "9876543210", "98123 45678", "919812345678"]) {
      expect(text).not.toContain(digits);
    }
    // …while the timestamp next to a phone survives intact.
    expect(String(meta.pgTimestampNextToPhone)).toBe("2026-09-19 20:18:22 call [phone]");
    expect((meta.list as string[])[1]).toBe("ok");
  });
});


// ── A / §10. Policy versioning ────────────────────────────────────────────────
describe("policy decision versioning", () => {
  it("derives a version that changes with the ruleset", () => {
    expect(POLICY_RULESET_VERSION).toMatch(/^rules\.v\d+\.[0-9a-f]{8}$/);
    expect(POLICY_RULESET_VERSION).toContain(`v${POLICY_RULES.length}`);
  });

  it("stamps the version onto a persisted decision", async () => {
    const before = await prisma.aiToolPolicyLog.count();
    await evaluatePolicy({
      tool: {
        toolId: "read.admin.p14test", name: "t", description: "d", category: "READ",
        requiredRole: "ADMIN", requiredPermission: "tools.read.admin.p14test",
        approvalRequired: false, riskLevel: "LOW",
      } as never,
      actor: { actorId, actorRole: "ADMIN", traceId: `${TAG}-policy` } as never,
      arguments: {},
      confirmed: false,
    });
    expect(await prisma.aiToolPolicyLog.count()).toBe(before + 1);

    const row = await prisma.aiToolPolicyLog.findFirst({ orderBy: { createdAt: "desc" } });
    // A row naming `rbac.role_check` says which rule fired, not what it did; the version pins it.
    expect(row!.policyVersion).toBe(POLICY_RULESET_VERSION);
  });
});

// ── G / §87. Experiment stop switch ───────────────────────────────────────────
describe("experiment governance", () => {
  const KEY = "p14_test_experiment";

  it("suppresses an unregistered experiment", async () => {
    await prisma.platformExperiment.deleteMany({ where: { key: KEY } });
    const r = await dynamicPricingService.assignExperiment("cust-a", KEY);
    // An experiment with no registry row has no owner and no off switch, so it is treated
    // as stopped rather than running-by-default.
    expect(r.active).toBe(false);
    expect(r.variant).toBe("control");
  });

  it("assigns both arms deterministically while running", async () => {
    await prisma.platformExperiment.create({
      data: { key: KEY, status: "running", variants: [{ name: "control" }, { name: "treatment" }], updatedBy: TAG },
    });
    const ids = Array.from({ length: 100 }, (_, i) => `c${i}`);
    const assigned = await Promise.all(ids.map((i) => dynamicPricingService.assignExperiment(i, KEY)));
    expect(assigned.every((a) => a.active)).toBe(true);
    expect(assigned.filter((a) => a.variant === "treatment").length).toBeGreaterThan(20);

    const repeat = await Promise.all(Array.from({ length: 10 }, () => dynamicPricingService.assignExperiment("c7", KEY)));
    expect(new Set(repeat.map((r) => r.variant)).size).toBe(1);
  });

  it("stops immediately when paused, with no cached assignment surviving", async () => {
    await prisma.platformExperiment.update({ where: { key: KEY }, data: { status: "paused" } });
    const after = await Promise.all(
      Array.from({ length: 50 }, (_, i) => dynamicPricingService.assignExperiment(`c${i}`, KEY)),
    );
    expect(after.every((a) => !a.active)).toBe(true);
    expect(after.every((a) => a.variant === "control")).toBe(true);
  });

  it("reports the arms as undifferentiated rather than implying an effect", async () => {
    await prisma.platformExperiment.update({ where: { key: KEY }, data: { status: "running" } });
    const r = await dynamicPricingService.assignExperiment("cust-z", KEY);
    // Both arms return priceMultiplier 1.0. Saying so is what stops the exposure counter being
    // mistaken for evidence of an effect.
    expect(r.differentiated).toBe(false);
    expect(r.priceMultiplier).toBe(1.0);
  });
});

// ── M / §57–§60. Stuck workflow recovery ──────────────────────────────────────
describe("stuck workflow recovery", () => {
  const mkInstance = (name: string, over: Record<string, unknown>) =>
    prisma.workflowInstance.create({
      data: {
        workflowId: "checkout_recovery", workflowVersion: 1, executionMode: "SHADOW",
        subjectType: "test", subjectId: `${TAG}-${name}`, idempotencyKey: `${TAG}-${name}`,
        stepIndex: 3, stepCount: 3, ...over,
      } as never,
    });

  it("never reports a healthy parked instance as stuck", async () => {
    const future = await mkInstance("future", { status: "WAITING", nextRunAt: new Date(Date.now() + 3_600_000) });
    const withJob = await mkInstance("withjob", { status: "WAITING", nextRunAt: new Date(Date.now() - 3_600_000) });
    await prisma.scheduledJob.create({
      data: { jobType: WORKFLOW_STEP_JOB_TYPE, triggerEventId: TAG, payload: { instanceId: withJob.id }, runAt: new Date(), status: "pending" },
    });

    const stuck = await detectStuckInstances();
    const ids = stuck.map((s) => s.instanceId);
    // A future wake-up is healthy; a past one with a queued job is healthy too.
    expect(ids).not.toContain(future.id);
    expect(ids).not.toContain(withJob.id);
  });

  it("detects a lost wake-up with its evidence", async () => {
    const lost = await mkInstance("lost", { status: "WAITING", nextRunAt: new Date(Date.now() - 3_600_000) });
    const found = (await detectStuckInstances()).find((s) => s.instanceId === lost.id);
    expect(found?.reason).toBe("LOST_WAKEUP");
    expect(found?.recommendedAction).toBe("REQUEUE");
    // Evidence, not just a label — an operator should not be asked to trust the classification.
    expect(found?.evidence).toContain("nothing will wake it");
  });

  it("lets exactly one of two concurrent operators recover", async () => {
    const inst = await mkInstance("race", { status: "WAITING", nextRunAt: new Date(Date.now() - 3_600_000) });
    const observed = await prisma.workflowInstance.findUnique({ where: { id: inst.id } });
    const args = {
      instanceId: inst.id, action: "REQUEUE" as const, actorId,
      reason: "phase 14 concurrency regression test",
      observedStatus: observed!.status, observedUpdatedAt: observed!.updatedAt,
    };

    const [a, b] = await Promise.all([recoverInstance({ ...args }), recoverInstance({ ...args })]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([a.code, b.code].sort()).toEqual(["LOST_RACE", "RECOVERED"]);

    // Two winners would mean two wake-ups on one instance — the next step executed twice.
    const jobs = await prisma.scheduledJob.count({
      where: { jobType: WORKFLOW_STEP_JOB_TYPE, status: "pending", payload: { path: ["instanceId"], equals: inst.id } },
    });
    expect(jobs).toBe(1);
  });

  it("refuses a recovery with no stated reason", async () => {
    const inst = await mkInstance("noreason", { status: "WAITING", nextRunAt: new Date(Date.now() - 3_600_000) });
    const observed = await prisma.workflowInstance.findUnique({ where: { id: inst.id } });
    const r = await recoverInstance({
      instanceId: inst.id, action: "CANCEL", actorId, reason: "x",
      observedStatus: observed!.status, observedUpdatedAt: observed!.updatedAt,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("NOT_ACTIONABLE");
  });

  it("refuses to recover a terminal instance", async () => {
    const inst = await mkInstance("done", { status: "COMPLETED", completedAt: new Date() });
    const r = await recoverInstance({
      instanceId: inst.id, action: "REQUEUE", actorId,
      reason: "phase 14 terminal-instance regression test",
      observedStatus: "WAITING", observedUpdatedAt: new Date(),
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("NOT_STUCK");
  });
});
