/**
 * Data Quality Engine — rule-based validation with severity, quarantine hints, quality scores.
 */
import prisma from "../../src/lib/prisma";
import type { DataQualitySeverity } from "@prisma/client";
import { logger } from "../../src/lib/logger";
import { fqTable, bqQuery } from "../etl/bq-client";
import { recordDataQualityMetrics } from "../../src/lib/etl-metrics";
import { classifyWarehouseFailure, isWarehouseOutage, withWarehouseDeadline } from "../../src/lib/warehouse-read";

export type DataQualityRule = {
  id: string;
  dataset: string;
  name: string;
  severity: DataQualitySeverity;
  sql: string;
  repairSuggestion: string;
  weight: number;
};

export const DATA_QUALITY_RULES: DataQualityRule[] = [
  { id: "dq.duplicate_booking", dataset: "fact_bookings", name: "Duplicate Booking", severity: "CRITICAL", sql: `SELECT COUNT(*) AS cnt FROM (SELECT booking_id, COUNT(*) c FROM ${fqTable("curated", "fact_bookings")} GROUP BY booking_id HAVING c > 1)`, repairSuggestion: "Deduplicate by booking_id using latest updated_at", weight: 10 },
  { id: "dq.duplicate_payment", dataset: "fact_payments", name: "Duplicate Payment", severity: "CRITICAL", sql: `SELECT COUNT(*) AS cnt FROM (SELECT payment_id, COUNT(*) c FROM ${fqTable("curated", "fact_payments")} GROUP BY payment_id HAVING c > 1)`, repairSuggestion: "Deduplicate payments by payment_id", weight: 10 },
  { id: "dq.negative_amount", dataset: "fact_bookings", name: "Negative Amount", severity: "CRITICAL", sql: `SELECT COUNTIF(total_amount < 0) AS cnt FROM ${fqTable("curated", "fact_bookings")}`, repairSuggestion: "Quarantine rows with negative amounts; investigate source", weight: 8 },
  { id: "dq.invalid_gps", dataset: "fact_gps_pings", name: "Invalid GPS", severity: "WARNING", sql: `SELECT COUNTIF(lat NOT BETWEEN -90 AND 90 OR lng NOT BETWEEN -180 AND 180) AS cnt FROM ${fqTable("curated", "fact_gps_pings")}`, repairSuggestion: "Filter invalid coordinates at ETL boundary", weight: 5 },
  { id: "dq.future_timestamp", dataset: "fact_bookings", name: "Future Timestamp", severity: "WARNING", sql: `SELECT COUNTIF(created_at > CURRENT_TIMESTAMP()) AS cnt FROM ${fqTable("curated", "fact_bookings")}`, repairSuggestion: "Reject future-dated records at extraction", weight: 5 },
  { id: "dq.null_customer", dataset: "fact_bookings", name: "Null Critical Fields", severity: "CRITICAL", sql: `SELECT COUNTIF(customer_hash IS NULL) AS cnt FROM ${fqTable("curated", "fact_bookings")}`, repairSuggestion: "Ensure customer_hash is populated during ETL", weight: 8 },
  { id: "dq.invalid_coords", dataset: "fact_gps_pings", name: "Invalid Coordinates", severity: "WARNING", sql: `SELECT COUNTIF(lat = 0 AND lng = 0) AS cnt FROM ${fqTable("curated", "fact_gps_pings")}`, repairSuggestion: "Drop null-island coordinates", weight: 4 },
  { id: "dq.missing_event", dataset: "fact_domain_events", name: "Missing Event", severity: "INFO", sql: `SELECT COUNT(*) AS cnt FROM ${fqTable("raw", "fact_domain_events")} WHERE event_id IS NULL`, repairSuggestion: "Verify outbox processor is publishing events", weight: 3 },
  { id: "dq.broken_ledger", dataset: "fact_ledger_entries", name: "Broken Ledger", severity: "CRITICAL", sql: `SELECT COUNTIF(debit_paise IS NULL AND credit_paise IS NULL) AS cnt FROM ${fqTable("curated", "fact_ledger_entries")}`, repairSuggestion: "Reconcile ledger entries with source journal", weight: 9 },
  { id: "dq.eta_negative_duration", dataset: "eta_validated", name: "ETA Negative Duration", severity: "CRITICAL", sql: `SELECT COUNTIF(actual_travel_duration_sec < 0) AS cnt FROM ${fqTable("validated", "eta_validated")}`, repairSuggestion: "Reject labels with negative travel duration", weight: 8 },
  { id: "dq.eta_missing_timestamps", dataset: "eta_validated", name: "ETA Missing Timestamps", severity: "CRITICAL", sql: `SELECT COUNTIF(dispatch_at IS NULL OR arrival_at IS NULL) AS cnt FROM ${fqTable("validated", "eta_validated")}`, repairSuggestion: "Ensure dispatch and arrival timestamps are captured", weight: 8 },
  { id: "dq.eta_future_timestamp", dataset: "eta_validated", name: "ETA Future Timestamp", severity: "WARNING", sql: `SELECT COUNTIF(arrival_at > CURRENT_TIMESTAMP()) AS cnt FROM ${fqTable("validated", "eta_validated")}`, repairSuggestion: "Reject future-dated arrival timestamps", weight: 5 },
  { id: "dq.eta_duplicate_trip", dataset: "eta_raw", name: "ETA Duplicate Trip", severity: "CRITICAL", sql: `SELECT COUNT(*) AS cnt FROM (SELECT booking_id, COUNT(*) c FROM ${fqTable("raw", "eta_raw")} GROUP BY booking_id HAVING c > 1)`, repairSuggestion: "Deduplicate ETA labels by booking_id", weight: 7 },
];

export type DataQualityReport = {
  evaluatedAt: string;
  /** Null when no rule could be evaluated — an unmeasured score is not 0% (X-90). */
  overallScore: number | null;
  /** `evaluated: false` = the warehouse did not answer; `passed` is then null, never false. */
  rules: Array<{ ruleId: string; name: string; severity: string; evaluated: boolean; passed: boolean | null; violationCount: number; repairSuggestion: string }>;
  criticalFailures: number;
  warnings: number;
  /** Rules the warehouse could not evaluate (outage), excluded from the score and not persisted. */
  unevaluatedRules: number;
  /** True when the warehouse answered no rule at all. */
  sourceUnavailable: boolean;
};

/**
 * `deadlineMs` bounds each rule's query — the HTTP routes pass it so a hung warehouse cannot hold the
 * request; the scheduled run does not, because a rule over a large table may legitimately be slow.
 */
export async function runDataQualityChecks(executionId?: string, opts: { deadlineMs?: number } = {}): Promise<DataQualityReport> {
  const results: DataQualityReport["rules"] = [];
  let totalWeight = 0;
  let earnedWeight = 0;
  let criticalFailures = 0;
  let warnings = 0;
  let unevaluatedRules = 0;
  /**
   * Set once the warehouse itself is known to be down (credentials, connection, deadline). The rules
   * run one after another, so without this a HUNG warehouse held an HTTP request for every rule's
   * deadline in turn (13 × 15 s). A failure specific to one query (a 403 on one dataset, a 404) does
   * not stop the others.
   */
  let sourceDown = false;

  for (const rule of DATA_QUALITY_RULES) {
    let violationCount = 0;
    let passed = true;
    if (sourceDown) {
      unevaluatedRules++;
      results.push({
        ruleId: rule.id, name: rule.name, severity: rule.severity,
        evaluated: false, passed: null, violationCount: 0, repairSuggestion: rule.repairSuggestion,
      });
      continue;
    }
    try {
      const read = bqQuery<{ cnt: number }>(rule.sql);
      const [row] = opts.deadlineMs ? await withWarehouseDeadline(read, opts.deadlineMs) : await read;
      violationCount = Number(row?.cnt ?? 0);
      passed = violationCount === 0;
    } catch (err) {
      /**
       * X-90: a rule the warehouse could not answer was scored as FAILED — during an outage every rule
       * failed, the overall score read 0%, every CRITICAL rule counted as a critical failure, and a
       * `data_quality_results` row per rule (quality_score 101) was written, on a GET. An outage is
       * "not evaluated": not scored, not counted, not persisted. A rule whose query is itself wrong
       * (missing table, invalid SQL) still fails — that IS a data-pipeline defect.
       */
      if (isWarehouseOutage(err)) {
        const cause = classifyWarehouseFailure(err);
        if (cause === "CREDENTIALS" || cause === "CONNECTION" || cause === "TIMEOUT") sourceDown = true;
        unevaluatedRules++;
        logger.warn("dq_rule_not_evaluated", { ruleId: rule.id, error: err instanceof Error ? err.message : String(err) });
        results.push({
          ruleId: rule.id, name: rule.name, severity: rule.severity,
          evaluated: false, passed: null, violationCount: 0, repairSuggestion: rule.repairSuggestion,
        });
        continue;
      }
      passed = false;
      violationCount = -1;
      logger.warn("dq_rule_skipped", { ruleId: rule.id, error: err instanceof Error ? err.message : String(err) });
    }

    if (!passed) {
      if (rule.severity === "CRITICAL") criticalFailures++;
      if (rule.severity === "WARNING") warnings++;
    }

    totalWeight += rule.weight;
    if (passed) earnedWeight += rule.weight;

    await prisma.dataQualityResult.create({
      data: {
        ruleId: rule.id,
        dataset: rule.dataset,
        severity: rule.severity,
        passed,
        violationCount: Math.max(0, violationCount),
        repairSuggestion: rule.repairSuggestion,
        qualityScore: passed ? 100 : Math.max(0, 100 - violationCount),
        executionId,
      },
    });

    results.push({
      ruleId: rule.id,
      name: rule.name,
      severity: rule.severity,
      evaluated: true,
      passed,
      violationCount: Math.max(0, violationCount),
      repairSuggestion: rule.repairSuggestion,
    });
  }

  const sourceUnavailable = unevaluatedRules > 0 && totalWeight === 0;
  // Scored over the rules that were evaluated. Nothing evaluated → no score (not 0%, not 100%).
  const overallScore = sourceUnavailable ? null : totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 100;
  // The gauge keeps its last measured value rather than recording an outage as a score.
  if (overallScore !== null) recordDataQualityMetrics(overallScore, criticalFailures, warnings);

  return {
    evaluatedAt: new Date().toISOString(),
    overallScore,
    rules: results,
    criticalFailures,
    warnings,
    unevaluatedRules,
    sourceUnavailable,
  };
}

export async function getQualityHistory(dataset: string, limit = 50) {
  return prisma.dataQualityResult.findMany({
    where: { dataset },
    orderBy: { evaluatedAt: "desc" },
    take: limit,
  });
}
