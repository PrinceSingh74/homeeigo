/**
 * Data Quality Engine — rule-based validation with severity, quarantine hints, quality scores.
 */
import prisma from "../../src/lib/prisma";
import type { DataQualitySeverity } from "@prisma/client";
import { logger } from "../../src/lib/logger";
import { fqTable, bqQuery } from "../etl/bq-client";
import { recordDataQualityMetrics } from "../../src/lib/etl-metrics";

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
  overallScore: number;
  rules: Array<{ ruleId: string; name: string; severity: string; passed: boolean; violationCount: number; repairSuggestion: string }>;
  criticalFailures: number;
  warnings: number;
};

export async function runDataQualityChecks(executionId?: string): Promise<DataQualityReport> {
  const results: DataQualityReport["rules"] = [];
  let totalWeight = 0;
  let earnedWeight = 0;
  let criticalFailures = 0;
  let warnings = 0;

  for (const rule of DATA_QUALITY_RULES) {
    let violationCount = 0;
    let passed = true;
    try {
      const [row] = await bqQuery<{ cnt: number }>(rule.sql);
      violationCount = Number(row?.cnt ?? 0);
      passed = violationCount === 0;
    } catch (err) {
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
      passed,
      violationCount: Math.max(0, violationCount),
      repairSuggestion: rule.repairSuggestion,
    });
  }

  const overallScore = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 100;
  recordDataQualityMetrics(overallScore, criticalFailures, warnings);

  return { evaluatedAt: new Date().toISOString(), overallScore, rules: results, criticalFailures, warnings };
}

export async function getQualityHistory(dataset: string, limit = 50) {
  return prisma.dataQualityResult.findMany({
    where: { dataset },
    orderBy: { evaluatedAt: "desc" },
    take: limit,
  });
}
