import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter } from "../lib/metrics";

/**
 * Phase 12 — shadow mode.
 *
 * ── What shadow is for ─────────────────────────────────────────────────────────
 *
 * An offline holdout says how a model would have done on history somebody already has. Shadow says
 * how it does on days nobody has seen yet, while controlling nothing. The two answer different
 * questions and a promotion needs both.
 *
 * ── The only thing this writes ─────────────────────────────────────────────────
 *
 * `ml_shadow_predictions`. No booking, no price, no dispatch, no notification. That is not a
 * convention to be maintained — it is the whole safety property of running an unproven model against
 * live data, and a test asserts it against real business-table counts.
 *
 * ── Outcomes arrive later, and are written once ────────────────────────────────
 *
 * A prediction row is created with `actualValue` null. `settle()` fills it in when the outcome is
 * genuinely observable and refuses to overwrite one already recorded — a settled outcome that can be
 * rewritten is not evidence, it is a moving target.
 */

export const ML_SHADOW_RULES_VERSION = "ml.shadow.v1";

export type ShadowRecord = {
  entityKey: string;
  predictedFor: Date;
  candidateValue: number;
  /** Null when production produced nothing. An outage is recorded, never filled with a guess. */
  productionValue: number | null;
};

export type ShadowComparison = {
  modelName: string;
  candidateVersion: number;
  /** Rows where the outcome is known. Only these can be scored. */
  settled: number;
  pending: number;
  candidate: { mae: number; rmse: number; bias: number } | null;
  production: { mae: number; rmse: number; bias: number } | null;
  /**
   * True only when both were scored on the same settled rows and the candidate MAE is lower.
   * Null when production produced nothing to compare against — a real state here, not an error,
   * because the warehouse path has been unavailable.
   */
  candidateBetter: boolean | null;
  comparableRows: number;
  verdict: string;
  rulesVersion: string;
};

function errorStats(pairs: Array<{ p: number; a: number }>): { mae: number; rmse: number; bias: number } | null {
  if (pairs.length === 0) return null;
  let abs = 0, sq = 0, err = 0;
  for (const { p, a } of pairs) {
    const e = p - a;
    abs += Math.abs(e);
    sq += e * e;
    err += e;
  }
  const r = (x: number) => Math.round(x * 10000) / 10000;
  return { mae: r(abs / pairs.length), rmse: r(Math.sqrt(sq / pairs.length)), bias: r(err / pairs.length) };
}

export const mlShadowService = {
  /**
   * Record what the candidate and the incumbent each predicted.
   *
   * Upserts on (candidateVersionId, entityKey) so re-running a shadow pass for the same day updates
   * rather than duplicating. Without that, a scheduler retry would silently double-weight a day in
   * every comparison drawn from these rows.
   */
  async record(args: {
    modelName: string;
    candidateVersionId: string;
    productionVersion: number | null;
    records: ShadowRecord[];
  }): Promise<{ written: number }> {
    let written = 0;
    for (const r of args.records) {
      await prisma.mlShadowPrediction.upsert({
        where: {
          candidateVersionId_entityKey: { candidateVersionId: args.candidateVersionId, entityKey: r.entityKey },
        },
        create: {
          modelName: args.modelName,
          candidateVersionId: args.candidateVersionId,
          productionVersion: args.productionVersion,
          entityKey: r.entityKey,
          predictedFor: r.predictedFor,
          candidateValue: r.candidateValue,
          productionValue: r.productionValue,
        },
        update: { candidateValue: r.candidateValue, productionValue: r.productionValue },
      });
      written++;
    }
    incCounter("ml_shadow_predictions_total", { model: args.modelName });
    logger.info("ml_shadow_recorded", { modelName: args.modelName, written });
    return { written };
  },

  /**
   * Write the authoritative outcome for entities whose truth is now known.
   *
   * Never overwrites. A row that already carries an actual is returned in `skipped` rather than
   * being quietly updated, because the point of an outcome is that it stopped moving.
   */
  async settle(args: {
    candidateVersionId: string;
    outcomes: Array<{ entityKey: string; actualValue: number }>;
  }): Promise<{ settled: number; skipped: number; unknown: number }> {
    let settled = 0, skipped = 0, unknown = 0;
    for (const o of args.outcomes) {
      const row = await prisma.mlShadowPrediction.findUnique({
        where: {
          candidateVersionId_entityKey: { candidateVersionId: args.candidateVersionId, entityKey: o.entityKey },
        },
        select: { id: true, actualValue: true },
      });
      if (!row) { unknown++; continue; }
      if (row.actualValue !== null) { skipped++; continue; }
      await prisma.mlShadowPrediction.update({
        where: { id: row.id },
        data: { actualValue: o.actualValue, actualAt: new Date() },
      });
      settled++;
    }
    incCounter("ml_shadow_settlements_total", { settled: String(settled > 0) });
    return { settled, skipped, unknown };
  },

  /**
   * Compare candidate against incumbent on settled rows only.
   *
   * ── Why comparability is counted separately ──────────────────────────────────
   *
   * Scoring the candidate on 14 settled days and production on the 3 where it happened to answer
   * would compare two different problems. `comparableRows` counts the rows where both produced a
   * value and the outcome is known, and `candidateBetter` stays null unless that set is non-empty.
   */
  async compare(args: { modelName: string; candidateVersionId: string }): Promise<ShadowComparison> {
    const version = await prisma.mlModelVersion.findUnique({
      where: { id: args.candidateVersionId },
      select: { version: true },
    });
    const rows = await prisma.mlShadowPrediction.findMany({
      where: { candidateVersionId: args.candidateVersionId },
      orderBy: { predictedFor: "asc" },
    });
    const settledRows = rows.filter((r) => r.actualValue !== null);
    const comparable = settledRows.filter((r) => r.productionValue !== null);

    const candidate = errorStats(settledRows.map((r) => ({ p: r.candidateValue, a: r.actualValue as number })));
    const production = errorStats(comparable.map((r) => ({ p: r.productionValue as number, a: r.actualValue as number })));

    let candidateBetter: boolean | null = null;
    let verdict: string;
    if (settledRows.length === 0) {
      verdict = `NO_SETTLED_OUTCOMES — ${rows.length} shadow prediction(s) recorded and none has an observed outcome yet. Nothing can be concluded.`;
    } else if (comparable.length === 0) {
      verdict =
        `CANDIDATE_ONLY — the candidate scored MAE ${candidate?.mae} over ${settledRows.length} settled day(s), ` +
        `but the incumbent produced no value on any of them, so there is nothing to compare it against. ` +
        `A candidate that is unopposed has not been shown to be better.`;
    } else {
      const candOnComparable = errorStats(comparable.map((r) => ({ p: r.candidateValue, a: r.actualValue as number })));
      candidateBetter = (candOnComparable?.mae ?? Infinity) < (production?.mae ?? Infinity);
      verdict = candidateBetter
        ? `CANDIDATE_BETTER — on the ${comparable.length} day(s) where both answered and the outcome is known, candidate MAE ${candOnComparable?.mae} vs production ${production?.mae}. This is evidence for approval, not approval.`
        : `CANDIDATE_NOT_BETTER — on the ${comparable.length} comparable day(s), candidate MAE ${candOnComparable?.mae} vs production ${production?.mae}. The candidate should not be promoted on this evidence.`;
    }

    return {
      modelName: args.modelName,
      candidateVersion: version?.version ?? -1,
      settled: settledRows.length,
      pending: rows.length - settledRows.length,
      candidate,
      production,
      candidateBetter,
      comparableRows: comparable.length,
      verdict,
      rulesVersion: ML_SHADOW_RULES_VERSION,
    };
  },

  /** Raw shadow rows for one candidate, so a reviewer can read the days rather than a summary. */
  async rows(candidateVersionId: string) {
    return prisma.mlShadowPrediction.findMany({
      where: { candidateVersionId },
      orderBy: { predictedFor: "asc" },
      take: 200,
    });
  },
};
