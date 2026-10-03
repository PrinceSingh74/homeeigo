import { TOOL_CATALOG } from "../ai-tools/registry/tool-catalog";
import { hashArguments } from "../ai-tools/audit/tool-audit.service";
import { revenueAnomalyService } from "./revenue-anomaly.service";
import { demandSupplyWarningService } from "./demand-supply-warning.service";
import { financeNarrativeService } from "./finance-narrative.service";
import { fraudNarrativeService } from "./fraud-narrative.service";
import { forecastExplainerService } from "./forecast-explainer.service";

/**
 * Phase 9, Capability 9 - recommended actions.
 *
 * A recommendation is not an execution. Nothing here refunds, freezes, bans, suspends, adjusts a
 * wallet or a ledger, changes pricing or touches a booking. The service imports no executor at all,
 * which a test asserts structurally rather than trusting the absence of a call.
 *
 * -- The taxonomy already existed --
 *
 * Actions are not invented here. Where a recommendation corresponds to a real platform action it
 * names the existing `toolId` from `TOOL_CATALOG`, and takes that entry's `riskLevel` verbatim.
 * Deriving a risk level from prose, or inventing an action type with no tool behind it, would be
 * this layer making a governance decision it has no standing to make.
 *
 * All 14 HIGH_RISK tools are deliberately unbound (0/14 handlers). A recommendation that names one
 * is therefore reviewable and unexecutable by construction, which is the correct shape and is not
 * something to "fix".
 *
 * -- Two things a human still owes --
 *
 * There is no recommendation priority policy anywhere in this platform. The only `priority` notions
 * that exist are booking-queue and support-ticket priorities, which are different domains. So
 * nothing here is called urgent, critical or high-priority; actions are ordered deterministically by
 * evidence and the gap is recorded as ACTION_PRIORITY_POLICY_HUMAN_DECISION_REQUIRED.
 *
 * There is no CUSTOMER_COMPENSATION tool. Whether compensation means a refund, a wallet credit, a
 * coupon or a ledger adjustment is a business mapping that does not exist, so the recommendation
 * stops at CUSTOMER_COMPENSATION_REVIEW_REQUIRED and executes nothing.
 */

export const RECOMMENDED_ACTIONS_RULES_VERSION = "exec.actions.v1";

export type ActionRisk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ActionState =
  | "PROPOSED"
  | "REVIEW_REQUIRED"
  | "RECOMMENDATION_ONLY"
  | "NOT_GENERATED";

export const ACTION_REASON = {
  PRIORITY_POLICY_MISSING: "ACTION_PRIORITY_POLICY_HUMAN_DECISION_REQUIRED",
  COMPENSATION_SEMANTICS_MISSING: "CUSTOMER_COMPENSATION_SEMANTICS_HUMAN_DECISION_REQUIRED",
  AMOUNT_UNAVAILABLE: "AMOUNT_UNAVAILABLE",
  EVIDENCE_DEGRADED: "EVIDENCE_DEGRADED",
  NO_EVIDENCE: "NO_EVIDENCE",
  TOOL_UNBOUND: "TOOL_HANDLER_UNBOUND",
  NO_TOOL_EXISTS: "NO_TOOL_EXISTS_FOR_ACTION",
} as const;

/**
 * Action types this capability can emit.
 *
 * Every one is a review. None names an operation that changes state, because none of the sources
 * feeding this layer establishes a fact that would justify one.
 */
export type ActionType =
  | "REVIEW_REVENUE_ANOMALY"
  | "REVIEW_SUPPLY_CONSTRAINT"
  | "REVIEW_FINANCE_RECONCILIATION"
  | "REVIEW_FINANCE_PERIOD_SEMANTICS"
  | "REVIEW_FRAUD_CASE"
  | "REVIEW_FORECAST"
  | "REVIEW_CUSTOMER_COMPENSATION";

export type ActionEvidence = {
  signal: string;
  value: number | string | null;
  source: string;
  observedAt: string | null;
  state: string;
};

export type RecommendedAction = {
  id: string;
  capability: string;
  actionType: ActionType;
  title: string;
  description: string;
  reasonCodes: string[];
  evidence: ActionEvidence[];
  /** From the tool catalog when a tool exists; otherwise the review default. Never derived here. */
  riskLevel: ActionRisk;
  riskSource: "TOOL_CATALOG" | "REVIEW_DEFAULT";
  /** The existing tool this action would eventually route through, when one exists. */
  toolId: string | null;
  requiresHumanApproval: boolean;
  state: ActionState;
  target: { kind: string; id: string | null };
  scope: string;
  /** Amounts are only ever carried from an authoritative source. Null when none exists. */
  amount: { value: number; currency: string } | null;
  /** Only where a producing service publishes one. Never invented. */
  confidence: number | null;
  generatedAt: string;
  rulesVersion: string;
  modelVersion: null;
  /** Caveats inherited from degraded evidence, so an action never looks better founded than it is. */
  limitations: string[];
};

/** The review default for an action with no tool behind it. Not a judgement about severity. */
const REVIEW_DEFAULT_RISK: ActionRisk = "MEDIUM";

/**
 * Risk comes from the catalog, never from this layer.
 *
 * A tool that does not exist yields null, and the caller falls back to the review default with
 * `riskSource: "REVIEW_DEFAULT"` so the provenance of the level is visible.
 */
export function riskFromCatalog(toolId: string): ActionRisk | null {
  const entry = (TOOL_CATALOG as Array<{ toolId: string; riskLevel?: string }>).find(
    (t) => t.toolId === toolId,
  );
  if (!entry || !entry.riskLevel) return null;
  return entry.riskLevel as ActionRisk;
}

/** Every HIGH_RISK tool id, read from the catalog rather than listed here. */
export function highRiskToolIds(): string[] {
  return (TOOL_CATALOG as Array<{ toolId: string; category: string }>)
    .filter((t) => t.category === "HIGH_RISK")
    .map((t) => t.toolId)
    .sort();
}

/**
 * The binding an approval would use, computed with the platform hasher.
 *
 * Exposed so a caller can create an approval through the existing engine with a hash this service
 * did not invent. Nothing here creates the approval - that is the Approval Center's job.
 */
export function bindingHashFor(args: Record<string, unknown>): string {
  return hashArguments(args);
}

let seq = 0;
function actionId(kind: string): string {
  seq += 1;
  return "act_" + kind.toLowerCase() + "_" + seq;
}

export const recommendedActionsService = {
  /**
   * Generate every recommendation the current evidence supports.
   *
   * Each source is consulted independently and a failure in one does not suppress the others - an
   * executive missing the fraud section is better served than one shown nothing.
   */
  async generate(opts?: { now?: Date }): Promise<{
    actions: RecommendedAction[];
    humanDecisions: string[];
    generatedAt: string;
    rulesVersion: string;
  }> {
    const now = opts?.now ?? new Date();
    const generatedAt = now.toISOString();
    const actions: RecommendedAction[] = [];

    const [anomaly, ds, finance, forecast] = await Promise.all([
      revenueAnomalyService.evaluate("gmv").catch(() => null),
      demandSupplyWarningService.assess({ now }).catch(() => null),
      financeNarrativeService.build("monthly", { now }).catch(() => null),
      forecastExplainerService.explainDemandForecast({ now }).catch(() => null),
    ]);

    if (anomaly) actions.push(...this.fromAnomaly(anomaly, generatedAt));
    if (ds) actions.push(...this.fromDemandSupply(ds, generatedAt));
    if (finance) actions.push(...this.fromFinance(finance, generatedAt));
    if (forecast) actions.push(...this.fromForecast(forecast, generatedAt));

    const fraud = await this.fromFraud(generatedAt).catch(() => []);
    actions.push(...fraud);

    /**
     * Ordering is deterministic and explicitly not a priority.
     *
     * Sorted by action type then target so the list is stable between runs. No urgency is implied,
     * because no policy defines what urgent means here.
     */
    actions.sort((a, b) =>
      a.actionType === b.actionType
        ? String(a.target.id).localeCompare(String(b.target.id))
        : a.actionType.localeCompare(b.actionType));

    return {
      actions,
      humanDecisions: [
        ACTION_REASON.PRIORITY_POLICY_MISSING,
        ACTION_REASON.COMPENSATION_SEMANTICS_MISSING,
      ],
      generatedAt,
      rulesVersion: RECOMMENDED_ACTIONS_RULES_VERSION,
    };
  },

  /**
   * A revenue anomaly only becomes an action when one was actually evaluated.
   *
   * The detector currently refuses on every path (unstable baseline, unset threshold), so this
   * produces nothing today - which is correct. Recommending a review of an anomaly that was never
   * detected would be manufacturing the finding this whole phase exists to avoid.
   */
  fromAnomaly(
    r: Awaited<ReturnType<typeof revenueAnomalyService.evaluate>>,
    generatedAt: string,
  ): RecommendedAction[] {
    if (r.state !== "EVALUATED") return [];
    return [{
      id: actionId("anomaly"),
      capability: "REVENUE_ANOMALY",
      actionType: "REVIEW_REVENUE_ANOMALY",
      title: "Review a revenue observation flagged against its baseline",
      description: "The detector compared the most recent day against its measured baseline.",
      reasonCodes: [r.reasonCode ?? "EVALUATED"],
      evidence: r.evidence.map((e) => ({
        signal: e.signal, value: e.value, source: e.source,
        observedAt: r.generatedAt, state: r.state,
      })),
      riskLevel: REVIEW_DEFAULT_RISK,
      riskSource: "REVIEW_DEFAULT",
      toolId: null,
      requiresHumanApproval: true,
      state: "REVIEW_REQUIRED",
      target: { kind: "METRIC", id: r.metric },
      scope: "PLATFORM",
      amount: null,
      confidence: r.confidence,
      generatedAt,
      rulesVersion: RECOMMENDED_ACTIONS_RULES_VERSION,
      modelVersion: null,
      limitations: [],
    }];
  },

  /**
   * Supply warnings become actions only where the assessment reached a verdict.
   *
   * Every zone currently reports SUPPLY_UNAVAILABLE because the telemetry is 82.5% incomplete and
   * weeks stale, so no supply action is generated - the correct outcome, and the limitation is
   * carried when one ever is.
   */
  fromDemandSupply(
    r: Awaited<ReturnType<typeof demandSupplyWarningService.assess>>,
    generatedAt: string,
  ): RecommendedAction[] {
    const actionable = r.zones.filter(
      (z) => z.state === "DEMAND_PRESSURE" || z.state === "SUPPLY_CONSTRAINT");
    return actionable.map((z) => ({
      id: actionId("supply"),
      capability: "DEMAND_SUPPLY",
      actionType: "REVIEW_SUPPLY_CONSTRAINT" as ActionType,
      title: "Review supply in " + z.zoneName,
      description: "Demand and supply in this zone were compared on the same basis and scope.",
      reasonCodes: [z.reasonCode],
      evidence: z.evidence.map((e) => ({
        signal: e.signal, value: e.value, source: e.source,
        observedAt: z.observedAt, state: z.state,
      })),
      riskLevel: REVIEW_DEFAULT_RISK,
      riskSource: "REVIEW_DEFAULT" as const,
      toolId: null,
      requiresHumanApproval: true,
      state: "REVIEW_REQUIRED" as ActionState,
      target: { kind: "ZONE", id: z.zoneId },
      scope: "ZONE",
      amount: null,
      confidence: z.confidence,
      generatedAt,
      rulesVersion: RECOMMENDED_ACTIONS_RULES_VERSION,
      modelVersion: null,
      limitations: r.supplyQuality.usable ? [] : ["Supply telemetry is incomplete or stale."],
    }));
  },

  /**
   * Finance actions come from the caveats the narrative already carries.
   *
   * A reconciliation difference and a period-basis defect are different problems with different
   * owners, so they become different actions rather than one generic "review finance".
   */
  fromFinance(
    r: Awaited<ReturnType<typeof financeNarrativeService.build>>,
    generatedAt: string,
  ): RecommendedAction[] {
    const out: RecommendedAction[] = [];

    for (const f of r.reconciliation.findings) {
      if (f.informational || f.delta === 0) continue;
      out.push({
        id: actionId("recon"),
        capability: "FINANCE",
        actionType: "REVIEW_FINANCE_RECONCILIATION",
        title: "Review the reconciliation difference on " + f.source,
        description: "Operational and ledger balances disagree for this account. Neither is assumed correct.",
        reasonCodes: [f.reasonCode],
        evidence: [
          { signal: "OPERATIONAL_BALANCE", value: f.operationalBalance, source: "ledger-reconciliation", observedAt: r.generatedAt, state: "OK" },
          { signal: "LEDGER_BALANCE", value: f.ledgerBalance, source: "ledger-reconciliation", observedAt: r.generatedAt, state: "OK" },
          { signal: "DELTA", value: f.delta, source: "ledger-reconciliation", observedAt: r.generatedAt, state: "OK" },
        ],
        riskLevel: REVIEW_DEFAULT_RISK,
        riskSource: "REVIEW_DEFAULT",
        toolId: null,
        requiresHumanApproval: true,
        state: "REVIEW_REQUIRED",
        target: { kind: "LEDGER_ACCOUNT", id: f.ledgerAccount },
        scope: "PLATFORM",
        /**
         * The delta is evidence, never an amount to act on. An `amount` on a recommendation reads as
         * "this much money should move", and nothing here establishes that.
         */
        amount: null,
        confidence: null,
        generatedAt,
        rulesVersion: RECOMMENDED_ACTIONS_RULES_VERSION,
        modelVersion: null,
        limitations: [],
      });
    }

    const flagged = r.narratives.filter((n) => n.state === "DATA_QUALITY_ISSUE");
    if (flagged.length > 0) {
      out.push({
        id: actionId("period"),
        capability: "FINANCE",
        actionType: "REVIEW_FINANCE_PERIOD_SEMANTICS",
        title: "Resolve the period basis used by the reporting source",
        description: "Several figures are assembled from inputs on different period bases.",
        reasonCodes: [...new Set(flagged.map((n) => n.reasonCode ?? "DATA_QUALITY_ISSUE"))],
        evidence: flagged.map((n) => ({
          signal: n.metric.toUpperCase(), value: n.value, source: n.source,
          observedAt: n.observedAt, state: n.state,
        })),
        riskLevel: REVIEW_DEFAULT_RISK,
        riskSource: "REVIEW_DEFAULT",
        toolId: null,
        requiresHumanApproval: true,
        state: "REVIEW_REQUIRED",
        target: { kind: "REPORTING_SOURCE", id: "finance-dashboard:getOverview" },
        scope: "PLATFORM",
        amount: null,
        confidence: null,
        generatedAt,
        rulesVersion: RECOMMENDED_ACTIONS_RULES_VERSION,
        modelVersion: null,
        limitations: ["These figures mix period bases and must not be read at face value."],
      });
    }
    return out;
  },

  /**
   * A stale forecast is worth reviewing; a fresh one is not an action.
   *
   * The review is of the model's freshness, never of a demand conclusion drawn from it.
   */
  fromForecast(
    r: Awaited<ReturnType<typeof forecastExplainerService.explainDemandForecast>>,
    generatedAt: string,
  ): RecommendedAction[] {
    if (r.state !== "FORECAST_STALE") return [];
    return [{
      id: actionId("forecast"),
      capability: "FORECAST",
      actionType: "REVIEW_FORECAST",
      title: "Review the demand forecast: its horizon has elapsed",
      description: "The forecast window is in the past, so it does not describe the period ahead.",
      reasonCodes: [r.reasonCode ?? "FORECAST_HORIZON_ELAPSED"],
      evidence: r.evidence.map((e) => ({
        signal: e.signal, value: e.value, source: e.source,
        observedAt: r.retrievedAt, state: r.state,
      })),
      riskLevel: REVIEW_DEFAULT_RISK,
      riskSource: "REVIEW_DEFAULT",
      toolId: null,
      requiresHumanApproval: true,
      state: "REVIEW_REQUIRED",
      target: { kind: "MODEL", id: r.model },
      scope: String(r.scope),
      amount: null,
      confidence: null,
      generatedAt,
      rulesVersion: RECOMMENDED_ACTIONS_RULES_VERSION,
      modelVersion: null,
      limitations: r.limitations,
    }];
  },

  /**
   * A partner queued for review becomes a review action, and never anything stronger.
   *
   * The domain has no CONFIRMED_FRAUD state, so no suspend, freeze or ban can be recommended from a
   * risk signal. The action names the review the risk engine itself asked for.
   */
  async fromFraud(generatedAt: string): Promise<RecommendedAction[]> {
    const list = await fraudNarrativeService.listPartnerRisk(25);
    return list
      .filter((n) => n.disposition === "REVIEW")
      .map((n) => ({
        id: actionId("fraud"),
        capability: "FRAUD",
        actionType: "REVIEW_FRAUD_CASE" as ActionType,
        title: "Review a partner queued by the risk engine",
        description: "The risk engine placed this partner in review. No conclusion has been recorded.",
        reasonCodes: [n.reasonCode ?? "REVIEW"],
        evidence: [
          { signal: "RISK_LEVEL", value: n.riskLevel, source: n.source, observedAt: n.lastEvaluatedAt, state: n.state },
          { signal: "RISK_SCORE", value: n.riskScore, source: n.source, observedAt: n.lastEvaluatedAt, state: n.state },
          { signal: "SIGNAL_COUNT", value: n.signalCount, source: n.source, observedAt: n.newestSignalAt, state: n.state },
        ],
        riskLevel: REVIEW_DEFAULT_RISK,
        riskSource: "REVIEW_DEFAULT" as const,
        toolId: null,
        requiresHumanApproval: true,
        state: "REVIEW_REQUIRED" as ActionState,
        target: { kind: "PARTNER", id: n.subjectId },
        scope: "PARTNER",
        amount: null,
        confidence: null,
        generatedAt,
        rulesVersion: RECOMMENDED_ACTIONS_RULES_VERSION,
        modelVersion: null,
        limitations: n.freshness === "STALE"
          ? ["The risk profile has not absorbed its newest signal."]
          : [],
      }));
  },

  /**
   * Customer compensation, which cannot be executed because nobody has defined what it means.
   *
   * No tool exists for it, and whether it is a refund, a wallet credit, a coupon or a ledger
   * adjustment is a business mapping this layer must not choose. The recommendation stops at review,
   * carries no amount, and names the missing decision.
   */
  compensationReview(target: { kind: string; id: string | null }, generatedAt: string): RecommendedAction {
    return {
      id: actionId("compensation"),
      capability: "CUSTOMER_COMPENSATION",
      actionType: "REVIEW_CUSTOMER_COMPENSATION",
      title: "Customer compensation requires a human decision",
      description: "No compensation action exists in this platform, and its meaning has not been defined.",
      reasonCodes: [ACTION_REASON.COMPENSATION_SEMANTICS_MISSING, ACTION_REASON.NO_TOOL_EXISTS],
      evidence: [],
      riskLevel: REVIEW_DEFAULT_RISK,
      riskSource: "REVIEW_DEFAULT",
      toolId: null,
      requiresHumanApproval: true,
      state: "RECOMMENDATION_ONLY",
      target,
      scope: "CUSTOMER",
      /** No amount: guessing one would be inventing a financial figure. */
      amount: null,
      confidence: null,
      generatedAt,
      rulesVersion: RECOMMENDED_ACTIONS_RULES_VERSION,
      modelVersion: null,
      limitations: [
        "No CUSTOMER_COMPENSATION tool exists.",
        "Whether compensation means a refund, wallet credit, coupon or ledger adjustment is undecided.",
      ],
    };
  },

  /** Exposed so tests read the review default rather than restating it. */
  reviewDefaultRisk(): ActionRisk {
    return REVIEW_DEFAULT_RISK;
  },
};
