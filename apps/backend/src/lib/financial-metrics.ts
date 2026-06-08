/** Financial Prometheus counters — appended to /metrics scrape. */
const financialCounters = new Map<string, number>();
const financialGauges = new Map<string, number>();

export function recordFinancialMetric(name: string, delta = 1): void {
  if (name.includes("delay") || name.includes("amount") || name.includes("pct")) {
    financialGauges.set(name, delta);
  } else {
    financialCounters.set(name, (financialCounters.get(name) ?? 0) + delta);
  }
}

export function renderFinancialMetrics(): string {
  const lines: string[] = [];
  const counterNames = [
    "payment_success_total",
    "payment_failed_total",
    "refund_total",
    "refund_attempt_total",
    "refund_success_total",
    "refund_failure_total",
    "refund_failed_total",
    "refund_race_blocked_total",
    "chargeback_total",
    "chargeback_open_total",
    "settlement_total",
    "settlement_mismatch_total",
    "payout_total",
    "payout_attempt_total",
    "payout_success_total",
    "payout_race_blocked_total",
    "provider_payout_total",
    "payout_failed_total",
    "provider_payout_failed_total",
    "withdrawal_race_blocked_total",
    "evidence_download_total",
    "evidence_denied_total",
    "reconciliation_mismatch_total",
    "finance_integrity_failures_total",
    "wallet_transfer_total",
    "wallet_debit_total",
    "hcoin_earned_total",
    "hcoin_redeemed_total",
    "hcoin_adjusted_total",
    "hcoin_expired_total",
    "payout_reversal_total",
    "referral_commission_total",
    "adjustment_total",
    "ledger_backfill_total",
  ];

  for (const name of counterNames) {
    lines.push(`# TYPE ${name} counter`);
    lines.push(`${name} ${financialCounters.get(name) ?? 0}`);
  }

  lines.push("# TYPE settlement_delay_hours gauge");
  lines.push(`settlement_delay_hours ${financialGauges.get("settlement_delay_hours") ?? 0}`);

  lines.push("# TYPE chargeback_amount_total gauge");
  lines.push(`chargeback_amount_total ${financialGauges.get("chargeback_amount_total") ?? 0}`);

  lines.push("# TYPE refund_amount_total gauge");
  lines.push(`refund_amount_total ${financialGauges.get("refund_amount_total") ?? 0}`);

  lines.push("# TYPE referral_commission_amount gauge");
  lines.push(`referral_commission_amount ${financialGauges.get("referral_commission_amount") ?? 0}`);

  lines.push("# TYPE adjustment_amount_total gauge");
  lines.push(`adjustment_amount_total ${financialGauges.get("adjustment_amount_total") ?? 0}`);

  return lines.join("\n");
}
