/**
 * Phase 14 — AI spend governance.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────
 *
 * Phase 13 made AI cost accurate and visible: every request is priced from a real per-provider
 * table, and requests whose provider has no pricing entry are counted separately so "unknown"
 * can never read as "free". What none of that does is *stop* anything. A retry storm, a runaway
 * agent loop or a mispriced model would have been measured in high resolution all the way to the
 * invoice. Observation is not control.
 *
 * ── Why reservations, and not a simple "have we spent too much yet" check ────────
 *
 * AI cost is only knowable AFTER the provider answers. A pre-flight check against *settled*
 * spend therefore lets N concurrent requests all read the same under-limit total and all
 * proceed — with enough concurrency the cap is a suggestion, and the moment it matters most
 * (a runaway loop firing requests in parallel) is exactly the moment it stops working.
 *
 * So each request reserves an upper bound on what it could cost before it runs, and settles that
 * reservation to the measured figure afterwards. The overshoot is then bounded by what is
 * genuinely in flight rather than unbounded by concurrency. The reservation is released on every
 * exit path, including failure — an errored request that never reached the provider must not
 * hold budget for the rest of the window.
 *
 * ── What this deliberately does NOT do ───────────────────────────────────────────
 *
 * It ships no caps. `ai_budget_policies` is empty, and with no policy the decision is
 * `NO_POLICY_CONFIGURED` — allowed, and counted, so the absence is visible rather than silent.
 * Seeding a number would mean inventing a spend limit nobody agreed to: too high and it controls
 * nothing, too low and it breaks AI in production. The mechanism is engineering; the number is a
 * human decision.
 */
import { isDeployedEnvironment } from "../lib/deployed-environment";
import type { AiBudgetFailMode, AiBudgetPolicy, AiGatewayRole, AiProviderType } from "@prisma/client";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter, setGauge, registerScrapeSampler } from "../lib/metrics";
import { AuditLogService } from "./audit-log.service";
import { computeTokenCostDetailed } from "../ai/cost/ai-cost.service";
import { eligibleChain } from "../ai/router/provider-registry";

/**
 * Why a request was allowed or refused. Each is a distinct operational condition and they are
 * never collapsed: "no cap is set" and "the cap store is unreachable" produce the same ALLOW on
 * a permissive policy but mean opposite things to whoever is on call.
 */
export type BudgetDecision =
  | "ALLOW"
  | "NO_POLICY_CONFIGURED"
  | "BUDGET_EXCEEDED"
  | "BUDGET_UNAVAILABLE"
  | "UNPRICED_PROVIDER";

export type BudgetContext = {
  /**
   * Providers that could serve this request, in failover order.
   *
   * Not "the provider" — pre-flight there is no such thing. The router walks an ordered chain and
   * a request that starts at GROQ can be answered by OPENAI three attempts later, so committing
   * to one name before the call would price the reservation against a provider that never ran.
   * The eligible chain is knowable up front and is what the cap is actually exposed to.
   */
  eligibleProviders: AiProviderType[];
  actorRole: AiGatewayRole;
  actorId: string;
  endpoint: string;
  /** Tokens the prompt is about to send. Known before the call because the prompt is already built. */
  estimatedPromptTokens: number;
  /** The ceiling the request itself sets on the answer. A real upper bound, not a guess. */
  maxOutputTokens: number;
  traceId?: string;
};

export type BudgetVerdict = {
  decision: BudgetDecision;
  allowed: boolean;
  /** Reservations taken, so settle can find them again without re-deriving which policies applied. */
  reservations: Array<{ policyId: string; windowKey: string; amountUsd: number }>;
  /** Populated when a cap refused the request, so the caller can say which one and by how much. */
  breached?: { policyId: string; scope: string; scopeKey: string; limitUsd: number; committedUsd: number };
  reason: string;
};

/** DAY windows key on the UTC date, MONTH on the UTC month. Text, so no session timezone shifts it. */
function windowKeyFor(period: "DAY" | "MONTH", now: Date): string {
  const iso = now.toISOString();
  return period === "DAY" ? iso.slice(0, 10) : iso.slice(0, 7);
}

/**
 * The most this request could cost — the dearest price among the providers that could serve it.
 *
 * Not an estimate in the guessing sense. `maxOutputTokens` is the hard ceiling the request itself
 * imposes, the prompt is already built, and the eligible chain is the exact set of providers the
 * router may reach, so this is arithmetic over known quantities. Pricing against only the primary
 * would under-reserve every request that fails over to a dearer provider, and under-reserving is
 * how a cap silently stops capping.
 *
 * Returns null when NO eligible provider has a pricing entry: the cost is then genuinely
 * unknowable, which is a different state from zero and is handled as one by the caller.
 */
function upperBoundCostUsd(ctx: BudgetContext): number | null {
  let max: number | null = null;
  for (const provider of ctx.eligibleProviders) {
    const probe = computeTokenCostDetailed(provider, ctx.estimatedPromptTokens, ctx.maxOutputTokens, 0);
    if (probe.costStatus !== "COMPUTED") continue;
    if (max === null || probe.costUsd > max) max = probe.costUsd;
  }
  return max;
}

/** The chain the router would actually walk right now, cooldowns and circuits included. */
export function currentEligibleProviders(): AiProviderType[] {
  return eligibleChain();
}

/** Every cap that could apply to this request, most specific dimensions included. */
async function applicablePolicies(ctx: BudgetContext): Promise<AiBudgetPolicy[]> {
  return prisma.aiBudgetPolicy.findMany({
    where: {
      isActive: true,
      OR: [
        { scope: "GLOBAL" },
        // A PROVIDER cap applies if ANY provider it names could serve this request. Waiting to
        // learn which one actually did would enforce the cap one request too late.
        { scope: "PROVIDER", scopeKey: { in: ctx.eligibleProviders } },
        { scope: "ROLE", scopeKey: ctx.actorRole },
        { scope: "ENDPOINT", scopeKey: ctx.endpoint },
      ],
    },
  });
}

/**
 * The atomic step. One statement does the check and the increment together, so two concurrent
 * requests cannot both observe the same headroom and both take it: Postgres locks the row for
 * the duration of the UPDATE and the second one re-evaluates the predicate against the first
 * one's result. A read-then-write in application code — however carefully ordered — cannot give
 * this guarantee, which is precisely how budget caps usually fail their first load test.
 *
 * Returns false when the reservation would breach the cap; the row is left untouched.
 */
async function tryReserve(policy: AiBudgetPolicy, windowKey: string, amountUsd: number): Promise<boolean> {
  // Create the window if this is the period's first request. ON CONFLICT makes the create itself
  // race-safe, so two simultaneous first-requests do not produce a unique-violation.
  await prisma.$executeRaw`
    INSERT INTO ai_budget_windows (id, policy_id, window_key, updated_at)
    VALUES (${crypto.randomUUID()}, ${policy.id}, ${windowKey}, NOW())
    ON CONFLICT (policy_id, window_key) DO NOTHING
  `;

  const updated = await prisma.$executeRaw`
    UPDATE ai_budget_windows
       SET reserved_usd  = reserved_usd + ${amountUsd},
           request_count = request_count + 1,
           updated_at    = NOW()
     WHERE policy_id = ${policy.id}
       AND window_key = ${windowKey}
       AND reserved_usd + settled_usd + ${amountUsd} <= ${policy.limitUsd}
  `;
  return updated > 0;
}

/** Give back a reservation that was taken but will not be used. */
async function release(policyId: string, windowKey: string, amountUsd: number): Promise<void> {
  await prisma.$executeRaw`
    UPDATE ai_budget_windows
       SET reserved_usd = GREATEST(0, reserved_usd - ${amountUsd}),
           updated_at   = NOW()
     WHERE policy_id = ${policyId} AND window_key = ${windowKey}
  `;
}

/**
 * Pre-flight. Reserves headroom against every applicable cap, or refuses.
 *
 * All-or-nothing: if the third of three caps refuses, the two already taken are released before
 * returning, so a denied request leaves no budget held.
 */
export async function checkAndReserveBudget(ctx: BudgetContext): Promise<BudgetVerdict> {
  let policies: AiBudgetPolicy[];
  try {
    policies = await applicablePolicies(ctx);
  } catch (err) {
    /**
     * The cap store is unreachable. This is NOT the same as having no cap, and the difference
     * matters most during an incident: failing closed on a database blip takes every AI surface
     * down, while failing open during a runaway loop removes the control exactly when it was
     * needed. There is no universally right answer, so the answer is not guessed here — with no
     * policies readable there is also no fail mode to read, and the platform's existing behaviour
     * (AI works) is preserved while the condition is made loudly visible.
     */
    incCounter("homigo_ai_budget_decision_total", { decision: "BUDGET_UNAVAILABLE", scope: "none" });
    logger.error("ai_budget_store_unavailable", {
      category: "APPLICATION",
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      decision: "BUDGET_UNAVAILABLE",
      allowed: true,
      reservations: [],
      reason: "Budget policy store unreachable; no cap could be evaluated",
    };
  }

  if (policies.length === 0) {
    /**
     * No cap is configured. On a deployed host that now REFUSES; on a developer machine it still
     * allows, so local work is not blocked, and `AiSpendingWithoutBudgetPolicy` pages instead.
     *
     * It used to allow everywhere. That was defensible while no provider key was configured and
     * nothing could spend — and stopped being defensible once it was measured on 2026-09-21 that
     * Gemini and Groq keys are live and real spend had occurred ($0.033 over 7 days, all Groq). On a
     * deployed host an uncapped live provider is uncontrolled spend by definition. The cap AMOUNT is
     * an owner decision and is deliberately not invented here: the fix is only to stop spending
     * money nobody has agreed to spend. Set a policy via PUT /api/admin/governance/ai-budgets.
     */
    const failClosed = isDeployedEnvironment();
    incCounter("homigo_ai_budget_decision_total", {
      decision: "NO_POLICY_CONFIGURED",
      scope: failClosed ? "enforced" : "observed",
    });
    return {
      decision: "NO_POLICY_CONFIGURED",
      allowed: !failClosed,
      reservations: [],
      reason: failClosed
        ? "No AI budget policy is configured; a deployed environment refuses AI spend until one exists"
        : "No active AI budget policy applies to this request",
    };
  }

  const bound = upperBoundCostUsd(ctx);
  if (bound === null) {
    /**
     * The provider has no pricing entry, so this request's cost is UNKNOWN — and a cap that
     * cannot see what a request spends is not a cap. Which way that resolves is the policy
     * author's decision, recorded per policy rather than assumed here: a strict cap refuses what
     * it cannot measure, a permissive one lets it through and counts it.
     */
    const strict = policies.some((p) => p.failMode === "FAIL_CLOSED");
    await countUnknownCost(policies, ctx);
    incCounter("homigo_ai_budget_decision_total", { decision: "UNPRICED_PROVIDER", scope: strict ? "enforced" : "observed" });
    if (strict) {
      await auditBudgetRefusal(ctx, "UNPRICED_PROVIDER", policies[0]!, 0);
      return {
        decision: "UNPRICED_PROVIDER",
        allowed: false,
        reservations: [],
        reason: `No pricing entry for any eligible provider (${ctx.eligibleProviders.join(", ") || "none"}); a FAIL_CLOSED budget refuses spend it cannot measure`,
      };
    }
    return {
      decision: "UNPRICED_PROVIDER",
      allowed: true,
      reservations: [],
      reason: `No pricing entry for any eligible provider (${ctx.eligibleProviders.join(", ") || "none"}); counted as unknown-cost under a FAIL_OPEN budget`,
    };
  }

  const now = new Date();
  const taken: BudgetVerdict["reservations"] = [];

  for (const policy of policies) {
    const windowKey = windowKeyFor(policy.period, now);
    let ok: boolean;
    try {
      ok = await tryReserve(policy, windowKey, bound);
    } catch (err) {
      // A write failure against one window: release what is held and treat as unavailable rather
      // than proceeding with a partial hold that settle would never balance.
      await releaseAll(taken);
      logger.error("ai_budget_reserve_failed", {
        category: "APPLICATION",
        policyId: policy.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return failModeVerdict(policy.failMode, "Budget window write failed");
    }

    if (!ok) {
      await releaseAll(taken);
      const window = await prisma.aiBudgetWindow
        .findUnique({ where: { policyId_windowKey: { policyId: policy.id, windowKey } } })
        .catch(() => null);
      const committed = (window?.reservedUsd ?? 0) + (window?.settledUsd ?? 0);

      incCounter("homigo_ai_budget_decision_total", { decision: "BUDGET_EXCEEDED", scope: policy.scope });
      await auditBudgetRefusal(ctx, "BUDGET_EXCEEDED", policy, committed);
      return {
        decision: "BUDGET_EXCEEDED",
        allowed: false,
        reservations: [],
        breached: {
          policyId: policy.id,
          scope: policy.scope,
          scopeKey: policy.scopeKey,
          limitUsd: policy.limitUsd,
          committedUsd: committed,
        },
        reason: `AI budget exceeded for ${policy.scope}:${policy.scopeKey} (${policy.period})`,
      };
    }

    taken.push({ policyId: policy.id, windowKey, amountUsd: bound });
  }

  incCounter("homigo_ai_budget_decision_total", { decision: "ALLOW", scope: "enforced" });
  return { decision: "ALLOW", allowed: true, reservations: taken, reason: "Within all applicable budgets" };
}

async function releaseAll(taken: BudgetVerdict["reservations"]): Promise<void> {
  for (const r of taken) await release(r.policyId, r.windowKey, r.amountUsd).catch(() => undefined);
}

function failModeVerdict(mode: AiBudgetFailMode, reason: string): BudgetVerdict {
  incCounter("homigo_ai_budget_decision_total", {
    decision: "BUDGET_UNAVAILABLE",
    scope: mode === "FAIL_CLOSED" ? "enforced" : "observed",
  });
  return {
    decision: "BUDGET_UNAVAILABLE",
    allowed: mode === "FAIL_OPEN",
    reservations: [],
    reason,
  };
}

/**
 * Post-flight. Converts each reservation into measured spend.
 *
 * `costStatus` is carried through from the pricing layer rather than re-derived, so the two
 * cannot drift: a request the cost service called UNKNOWN increments `unknown_cost_requests` and
 * contributes nothing to `settled_usd`. Folding it in as 0 would make the settled figure read as
 * complete when it is not — the same failure Phase 13 removed from the dashboards.
 */
export async function settleBudget(
  reservations: BudgetVerdict["reservations"],
  actual: { costUsd: number; costStatus: "COMPUTED" | "UNKNOWN" },
): Promise<void> {
  for (const r of reservations) {
    try {
      if (actual.costStatus === "UNKNOWN") {
        await prisma.$executeRaw`
          UPDATE ai_budget_windows
             SET reserved_usd          = GREATEST(0, reserved_usd - ${r.amountUsd}),
                 unknown_cost_requests = unknown_cost_requests + 1,
                 updated_at            = NOW()
           WHERE policy_id = ${r.policyId} AND window_key = ${r.windowKey}
        `;
      } else {
        await prisma.$executeRaw`
          UPDATE ai_budget_windows
             SET reserved_usd = GREATEST(0, reserved_usd - ${r.amountUsd}),
                 settled_usd  = settled_usd + ${actual.costUsd},
                 updated_at   = NOW()
           WHERE policy_id = ${r.policyId} AND window_key = ${r.windowKey}
        `;
      }
    } catch (err) {
      // A lost settle leaves the reservation held until the window rolls. That over-counts spend,
      // which is the safe direction to be wrong in, but it must not be silent.
      logger.error("ai_budget_settle_failed", {
        category: "APPLICATION",
        policyId: r.policyId,
        windowKey: r.windowKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** Release without settling — the request never reached the provider, so it spent nothing. */
export async function abandonBudget(reservations: BudgetVerdict["reservations"]): Promise<void> {
  await releaseAll(reservations);
}

async function countUnknownCost(policies: AiBudgetPolicy[], _ctx: BudgetContext): Promise<void> {
  const now = new Date();
  for (const policy of policies) {
    const windowKey = windowKeyFor(policy.period, now);
    await prisma
      .$executeRaw`
        INSERT INTO ai_budget_windows (id, policy_id, window_key, unknown_cost_requests, updated_at)
        VALUES (${crypto.randomUUID()}, ${policy.id}, ${windowKey}, 1, NOW())
        ON CONFLICT (policy_id, window_key)
        DO UPDATE SET unknown_cost_requests = ai_budget_windows.unknown_cost_requests + 1,
                      updated_at = NOW()
      `
      .catch(() => undefined);
  }
}

/**
 * §44 — a refusal is a governance event, so it goes through the canonical audit service rather
 * than a log line. ALLOW is deliberately not audited per request: at gateway volume that would
 * bury the refusals it exists to make findable, and allowed volume is already a metric.
 */
async function auditBudgetRefusal(
  ctx: BudgetContext,
  decision: BudgetDecision,
  policy: AiBudgetPolicy,
  committedUsd: number,
): Promise<void> {
  await AuditLogService.record("AI_BUDGET_BLOCKED", "failure", {
    userId: ctx.actorId,
    traceId: ctx.traceId,
    reason: decision,
    details: {
      decision,
      policyId: policy.id,
      scope: policy.scope,
      scopeKey: policy.scopeKey,
      period: policy.period,
      limitUsd: policy.limitUsd,
      committedUsd,
      eligibleProviders: ctx.eligibleProviders,
      actorRole: ctx.actorRole,
      endpoint: ctx.endpoint,
    },
  });
}

/** Publishes current budget consumption. Absent policies publish nothing — no policy, no series. */
export async function publishBudgetGauges(): Promise<void> {
  const now = new Date();
  const policies = await prisma.aiBudgetPolicy.findMany({ where: { isActive: true } });
  for (const policy of policies) {
    const windowKey = windowKeyFor(policy.period, now);
    const window = await prisma.aiBudgetWindow.findUnique({
      where: { policyId_windowKey: { policyId: policy.id, windowKey } },
    });
    const labels = { scope: policy.scope, scope_key: policy.scopeKey, period: policy.period };
    setGauge("homigo_ai_budget_limit_usd", policy.limitUsd, labels);
    setGauge("homigo_ai_budget_committed_usd", (window?.reservedUsd ?? 0) + (window?.settledUsd ?? 0), labels);
    setGauge("homigo_ai_budget_unknown_cost_requests", window?.unknownCostRequests ?? 0, labels);
  }
  setGauge("homigo_ai_budget_policies_active", policies.length, {});
}

/**
 * Publish budget consumption on every scrape.
 *
 * On failure the gauges are deliberately left at their last known values rather than zeroed: a
 * budget reported as `committed = 0` because the query failed would read as "plenty of headroom"
 * at precisely the moment nobody can see the real figure.
 */
export function registerAiBudgetSamplers(): void {
  registerScrapeSampler(async () => {
    try {
      await publishBudgetGauges();
    } catch {
      /* keep the last real reading; a failed sample must not publish a reassuring zero */
    }
  });
}

/**
 * Count an embedding call whose cost this platform cannot price.
 *
 * Embeddings are billed at a different rate from generation, and this project's price table only
 * covers generation. Running an embedding through `computeTokenCostDetailed` would return a
 * confident, wrong number — so the call is counted as UNKNOWN-cost against every active policy
 * instead. It contributes nothing to `settled_usd`, which keeps the settled figure honest, and a
 * non-zero `unknown_cost_requests` says plainly that spend is understated by that many calls.
 *
 * No reservation is taken: an upper bound cannot be derived without a price, and reserving a made-up
 * amount would be the same fabrication in a different field.
 */
export async function recordEmbeddingSpend(input: {
  provider: AiProviderType;
  actorRole: AiGatewayRole;
}): Promise<void> {
  const now = new Date();
  const policies = await prisma.aiBudgetPolicy
    .findMany({
      where: {
        isActive: true,
        OR: [
          { scope: "GLOBAL" },
          { scope: "PROVIDER", scopeKey: input.provider },
          { scope: "ROLE", scopeKey: input.actorRole },
          { scope: "ENDPOINT", scopeKey: "knowledge.embed" },
        ],
      },
    })
    .catch(() => [] as AiBudgetPolicy[]);

  incCounter("homigo_ai_budget_decision_total", {
    decision: policies.length ? "UNPRICED_PROVIDER" : "NO_POLICY_CONFIGURED",
    scope: "embedding",
  });

  for (const policy of policies) {
    const windowKey = windowKeyFor(policy.period, now);
    await prisma
      .$executeRaw`
        INSERT INTO ai_budget_windows (id, policy_id, window_key, request_count, unknown_cost_requests, updated_at)
        VALUES (${crypto.randomUUID()}, ${policy.id}, ${windowKey}, 1, 1, NOW())
        ON CONFLICT (policy_id, window_key)
        DO UPDATE SET request_count = ai_budget_windows.request_count + 1,
                      unknown_cost_requests = ai_budget_windows.unknown_cost_requests + 1,
                      updated_at = NOW()
      `
      .catch(() => undefined);
  }
}
