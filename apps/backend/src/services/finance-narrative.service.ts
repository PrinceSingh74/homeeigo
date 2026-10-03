import { logger } from "../lib/logger";
import { executiveIntelligenceService } from "./executive-intelligence.service";
import { ledgerReconciliationService } from "./ledger-reconciliation.service";
import { financialIntegrityService } from "./financial-integrity.service";
import { EXEC_REASON } from "./executive-intelligence.types";
import type { ExecutiveFact, ExecutiveIntelligenceContext } from "./executive-intelligence.types";
import type { ReportPeriod } from "./executive-reporting.service";

/**
 * Phase 9, Capability 5 — finance narratives.
 *
 * The ledger is the source of truth. Nothing here calculates a balance, recomputes revenue, derives
 * a payout, invents an exposure or resolves a discrepancy. Every figure arrives from the
 * Capability-1 context or from an authoritative reconciliation service, and is carried unchanged.
 *
 * ── Read-only, and one trap worth recording ────────────────────────────────────
 *
 * `financialIntegrityService.validate()` looks like the natural call and **writes**: it runs
 * `runChecks()`, which persists a `FinancialIntegrityRun` row. A narrative that used it would
 * mutate the database every time an executive opened a page. `getLatestReport()` reads the most
 * recent stored run instead, and `ledgerReconciliationService.buildReport()` was verified to contain
 * no mutations. `reconcile()` is never called — it posts adjustment entries.
 *
 * ── Reconciliation drift is surfaced, never resolved ───────────────────────────
 *
 * When operational balances disagree with the ledger, both numbers and their delta are reported and
 * the narrative says so. It does not pick whichever looks right, and it applies **no tolerance** —
 * deciding how much drift is acceptable is a business judgement, so any non-zero delta is reported
 * as a delta with its exact value rather than being silently absorbed.
 *
 * ── What is never said ─────────────────────────────────────────────────────────
 *
 * No causation. "Refund volume was X" is a measurement; "refunds caused the revenue decline" is a
 * claim about mechanism that no source here establishes. The statement table contains no sentence of
 * the second kind, and the known `netRevenue` period mismatch is reported as a data-quality issue
 * rather than explained away as a refund effect.
 */

export const FINANCE_NARRATIVE_RULES_VERSION = "exec.finance.v1";

export type FinanceNarrativeType =
  | "FINANCE_STABLE"
  | "FINANCE_CHANGE"
  | "FINANCE_DATA_QUALITY"
  | "FINANCE_RECONCILIATION"
  | "FINANCE_LIQUIDITY"
  | "FINANCE_REFUND"
  | "FINANCE_CHARGEBACK"
  | "FINANCE_PAYOUT"
  | "FINANCE_MARGIN"
  | "FINANCE_UNAVAILABLE";

export const FINANCE_REASON = {
  MIXED_PERIOD_BASIS: EXEC_REASON.MIXED_PERIOD_BASIS,
  MARGIN_UNDEFINED_ZERO_GMV: EXEC_REASON.MARGIN_SEMANTICS_HUMAN_DECISION_REQUIRED,
  RECONCILIATION_DELTA: "RECONCILIATION_DELTA",
  RECONCILIATION_CLEAN: "RECONCILIATION_CLEAN",
  /** The source marked this row informational; its delta is not drift. */
  RECONCILIATION_INFORMATIONAL: "RECONCILIATION_INFORMATIONAL",
  RECONCILIATION_UNAVAILABLE: "RECONCILIATION_UNAVAILABLE",
  INTEGRITY_REPORT_ABSENT: "INTEGRITY_REPORT_ABSENT",
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
} as const;

/**
 * Sentences by narrative type. Flat, dull, and free of mechanism.
 *
 * The reconciliation sentence deliberately says a difference exists and names neither side as
 * correct. The data-quality sentence names the period mismatch rather than attributing the number to
 * refunds.
 */
const STATEMENTS: Record<FinanceNarrativeType, string> = {
  FINANCE_STABLE: "This figure is unchanged from the previous comparable period.",
  FINANCE_CHANGE: "This figure differs from the previous comparable period.",
  FINANCE_DATA_QUALITY:
    "This figure is assembled from inputs on different period bases, so it should not be read at " +
    "face value. The reporting source has not been changed.",
  FINANCE_RECONCILIATION:
    "Operational balances and the ledger report different totals for this account. Neither is " +
    "assumed correct here; both are shown with their difference.",
  FINANCE_LIQUIDITY: "This is a balance as it stands now, not a figure for the requested period.",
  FINANCE_REFUND: "This is the refunded amount recorded by the payment source.",
  FINANCE_CHARGEBACK: "This is the amount currently under open chargeback statuses.",
  FINANCE_PAYOUT: "This is the amount payable to partners as it stands now.",
  FINANCE_MARGIN:
    "Margin cannot be read at face value: the source cannot distinguish an undefined ratio from a " +
    "genuine zero, and its inputs are on different period bases.",
  FINANCE_UNAVAILABLE: "The authoritative source for this figure is unavailable.",
};

/** Advisory only. A narrative may ask for review; it can never authorise an action. */
export const REVIEW_ACTIONS = {
  REVIEW_RECONCILIATION: "Investigate the reconciliation difference for this account.",
  REVIEW_REFUND_ACTIVITY: "Review refund activity for the period.",
  REVIEW_CHARGEBACK_EXPOSURE: "Review open chargeback exposure.",
  REVIEW_PERIOD_SEMANTICS: "Resolve the period basis used by the reporting source.",
} as const;

export type FinanceEvidence = {
  signal: string;
  value: number | string | null;
  currency?: string;
  source: string;
  observedAt: string | null;
  periodBasis: string;
  state: string;
  reasonCode?: string;
};

export type FinanceNarrative = {
  metric: string;
  type: FinanceNarrativeType;
  /** Exact value, never the rounded display form. */
  value: number | null;
  currency: string | null;
  /** Display form. Rounding lives here and nowhere else; nothing reads it back. */
  formatted: string | null;
  periodBasis: string;
  statement: string;
  evidence: FinanceEvidence[];
  /** Advisory review prompts. Never an executable action. */
  reviewActions: string[];
  requiresHumanApproval: false;
  state: string;
  reasonCode?: string;
  source: string;
  observedAt: string | null;
  rulesVersion: string;
  contextRulesVersion: string;
};

export type ReconciliationFinding = {
  source: string;
  ledgerAccount: string;
  operationalBalance: number;
  ledgerBalance: number;
  /** Exact difference as the reconciliation service reports it. No tolerance is applied. */
  delta: number;
  clean: boolean;
  /**
   * Whether the source marks this row as informational rather than as a reconciliation assertion.
   *
   * `buildReport()` emits one such row: "Pending Cashback (info)", which compares pending cashback
   * owed to customers against the PLATFORM_REVENUE ledger account. Those are different quantities
   * and have no reason to be equal — a live delta of 36,176.80 was observed and is expected. Counting
   * it as drift produced a false DELTA_PRESENT on the first real observation.
   */
  informational: boolean;
  reasonCode: string;
};

export type FinanceNarrativeReport = {
  narratives: FinanceNarrative[];
  reconciliation: {
    findings: ReconciliationFinding[];
    /** Count of accounts whose operational and ledger balances disagree. */
    accountsWithDelta: number;
    state: "CLEAN" | "DELTA_PRESENT" | "UNAVAILABLE";
    reasonCode: string;
  };
  integrity: {
    /** From the most recently stored run. Null when no run has ever been recorded. */
    status: string | null;
    issueCount: number | null;
    observedAt: string | null;
    reasonCode: string;
  };
  generatedAt: string;
  rulesVersion: string;
};

/**
 * Display formatting. Applied at the edge only.
 *
 * The exact value stays on the narrative; this is the string a screen shows. Nothing downstream
 * reads `formatted` back into arithmetic, and a test asserts the two can differ without the meaning
 * changing.
 */
function formatMoney(value: number | null, currency: string | null): string | null {
  if (value === null) return null;
  const cur = currency ?? "";
  return (cur ? cur + " " : "") + value.toFixed(2);
}

const METRIC_TYPE: Record<string, FinanceNarrativeType> = {
  walletLiability: "FINANCE_LIQUIDITY",
  giftCardLiability: "FINANCE_LIQUIDITY",
  cashbackLiability: "FINANCE_LIQUIDITY",
  providerLiability: "FINANCE_PAYOUT",
  chargebackExposure: "FINANCE_CHARGEBACK",
  platformMarginPct: "FINANCE_MARGIN",
};

const METRIC_REVIEW: Record<string, string> = {
  chargebackExposure: REVIEW_ACTIONS.REVIEW_CHARGEBACK_EXPOSURE,
  netRevenue: REVIEW_ACTIONS.REVIEW_PERIOD_SEMANTICS,
  platformMarginPct: REVIEW_ACTIONS.REVIEW_PERIOD_SEMANTICS,
  totalLiabilities: REVIEW_ACTIONS.REVIEW_PERIOD_SEMANTICS,
};

export const financeNarrativeService = {
  /**
   * Build the finance narrative for one period.
   *
   * The context is passed in where a caller already has one, so a dashboard does not rebuild it per
   * card. Reconciliation and integrity are read once for the whole report.
   */
  async build(
    period: ReportPeriod = "monthly",
    opts?: { now?: Date; customDays?: number; context?: ExecutiveIntelligenceContext },
  ): Promise<FinanceNarrativeReport> {
    const now = opts?.now ?? new Date();
    const generatedAt = now.toISOString();
    const ctx = opts?.context ?? (await executiveIntelligenceService.getContext(period, opts));

    const [reconciliation, integrity] = await Promise.all([
      this.readReconciliation(),
      this.readIntegrity(),
    ]);

    const narratives: FinanceNarrative[] = [];
    for (const domain of ["REVENUE", "FINANCE"] as const) {
      const facts = ctx.domains[domain];
      if (!facts) continue;
      for (const [metric, f] of Object.entries(facts)) {
        narratives.push(this.narrateFact(metric, f, ctx));
      }
    }

    return {
      narratives,
      reconciliation,
      integrity,
      generatedAt,
      rulesVersion: FINANCE_NARRATIVE_RULES_VERSION,
    };
  },

  /**
   * Narrate one fact.
   *
   * A fact the context already flagged keeps its flag: the narrative adds a sentence explaining what
   * the flag means, never one that explains the number away.
   */
  narrateFact(
    metric: string,
    f: ExecutiveFact<number | string>,
    ctx: ExecutiveIntelligenceContext,
  ): FinanceNarrative {
    const value = typeof f.value === "number" ? f.value : null;
    const currency = f.unit === "INR" ? "INR" : null;

    let type: FinanceNarrativeType;
    if (f.state === "UNAVAILABLE" || f.state === "UNKNOWN" || f.state === "MODEL_UNAVAILABLE") {
      type = "FINANCE_UNAVAILABLE";
    } else if (metric === "platformMarginPct") {
      type = "FINANCE_MARGIN";
    } else if (f.state === "DATA_QUALITY_ISSUE") {
      type = "FINANCE_DATA_QUALITY";
    } else {
      type = METRIC_TYPE[metric] ?? "FINANCE_STABLE";
    }

    const reviewActions: string[] = [];
    const review = METRIC_REVIEW[metric];
    if (review && f.state !== "OK") reviewActions.push(review);

    const evidence: FinanceEvidence[] = [
      {
        signal: metric.toUpperCase(),
        value: f.value,
        ...(currency ? { currency } : {}),
        source: f.source,
        observedAt: f.observedAt,
        periodBasis: f.period.basis,
        state: f.state,
        ...(f.reasonCode ? { reasonCode: f.reasonCode } : {}),
      },
    ];

    return {
      metric,
      type,
      value,
      currency,
      formatted: formatMoney(value, currency),
      periodBasis: f.period.basis,
      statement: STATEMENTS[type],
      evidence,
      reviewActions,
      requiresHumanApproval: false,
      state: f.state,
      ...(f.reasonCode ? { reasonCode: f.reasonCode } : {}),
      source: f.source,
      observedAt: f.observedAt,
      rulesVersion: FINANCE_NARRATIVE_RULES_VERSION,
      contextRulesVersion: ctx.rulesVersion,
    };
  },

  /**
   * Read operational-versus-ledger drift.
   *
   * `buildReport()` only — verified to contain no mutations. `reconcile()` posts adjustment entries
   * and is never called from a narrative path.
   */
  async readReconciliation(): Promise<FinanceNarrativeReport["reconciliation"]> {
    try {
      const rows = await ledgerReconciliationService.buildReport();
      const findings: ReconciliationFinding[] = rows.map((r) => {
        /**
         * The source's own marker decides what is an assertion.
         *
         * Read from the row rather than from a list kept here, so a future informational row is
         * classified correctly without this file being edited to know about it.
         */
        const informational = /\(info\)/i.test(r.source);
        return {
          source: r.source,
          ledgerAccount: r.ledgerAccount,
          operationalBalance: r.operationalBalance,
          ledgerBalance: r.ledgerBalance,
          delta: r.delta,
          clean: informational ? true : r.delta === 0,
          informational,
          reasonCode: informational
            ? FINANCE_REASON.RECONCILIATION_INFORMATIONAL
            : r.delta === 0
              ? FINANCE_REASON.RECONCILIATION_CLEAN
              : FINANCE_REASON.RECONCILIATION_DELTA,
        };
      });
      /** Informational rows are excluded: they are not claims that two numbers should match. */
      const accountsWithDelta = findings.filter((f) => !f.informational && f.delta !== 0).length;
      return {
        findings,
        accountsWithDelta,
        state: accountsWithDelta > 0 ? "DELTA_PRESENT" : "CLEAN",
        reasonCode: accountsWithDelta > 0
          ? FINANCE_REASON.RECONCILIATION_DELTA
          : FINANCE_REASON.RECONCILIATION_CLEAN,
      };
    } catch (err) {
      logger.warn("finance_narrative_reconciliation_unavailable", { error: String(err).slice(0, 200) });
      return {
        findings: [],
        accountsWithDelta: 0,
        state: "UNAVAILABLE",
        reasonCode: FINANCE_REASON.RECONCILIATION_UNAVAILABLE,
      };
    }
  },

  /**
   * Read the most recent stored integrity run.
   *
   * Never `validate()` or `runChecks()`: those persist a run row, which would make opening an
   * executive page a database write.
   */
  async readIntegrity(): Promise<FinanceNarrativeReport["integrity"]> {
    try {
      const latest = await financialIntegrityService.getLatestReport();
      if (!latest) {
        return {
          status: null, issueCount: null, observedAt: null,
          reasonCode: FINANCE_REASON.INTEGRITY_REPORT_ABSENT,
        };
      }
      const issues = latest.report?.issues;
      return {
        status: String(latest.status),
        issueCount: Array.isArray(issues) ? issues.length : null,
        observedAt: latest.createdAt.toISOString(),
        reasonCode: FINANCE_REASON.RECONCILIATION_CLEAN,
      };
    } catch (err) {
      logger.warn("finance_narrative_integrity_unavailable", { error: String(err).slice(0, 200) });
      return {
        status: null, issueCount: null, observedAt: null,
        reasonCode: FINANCE_REASON.SOURCE_UNAVAILABLE,
      };
    }
  },

  /** Exposed so tests assert the tables rather than restating them. */
  statements(): Readonly<Record<FinanceNarrativeType, string>> {
    return STATEMENTS;
  },

  reviewActions(): Readonly<Record<string, string>> {
    return REVIEW_ACTIONS;
  },

  format(value: number | null, currency: string | null): string | null {
    return formatMoney(value, currency);
  },
};
