/** Canonical BigQuery column allowlists — ETL payloads are projected to these before load. */
export const BQ_TABLE_COLUMNS: Record<string, readonly string[]> = {
  fact_bookings: [
    "booking_id", "created_at", "updated_at", "scheduled_at", "completed_at",
    "customer_hash", "provider_hash", "service_id", "category", "city", "zone_id",
    "status", "is_completed", "is_cancelled", "base_amount", "final_amount", "total_amount",
    "commission", "eta_min", "distance_km", "actual_duration_min", "dest_lat", "dest_lng",
    "payment_status", "rating", "weather_temp_c", "weather_surge", "hour_of_day", "day_of_week", "loaded_at",
  ],
  dim_service: ["service_id", "name", "category", "base_price", "is_active", "loaded_at"],
  dim_zone: ["zone_id", "name", "city", "center_lat", "center_lng", "radius_m", "surge_multiplier", "loaded_at"],
  dim_partner: [
    "provider_hash", "user_hash", "is_verified", "is_active", "rating", "total_bookings",
    "acceptance_rate", "cancellation_rate", "city", "created_at", "updated_at", "loaded_at",
  ],
  dim_customer: ["customer_hash", "city", "created_at", "updated_at", "loaded_at"],
  fact_payments: [
    "payment_id", "booking_id", "customer_hash", "amount", "amount_paise", "status", "method",
    "created_at", "updated_at", "loaded_at",
  ],
  fact_wallet_txns: ["txn_id", "customer_hash", "amount", "type", "description", "created_at", "loaded_at"],
  fact_ledger_entries: ["entry_id", "account_id", "journal_id", "debit_paise", "credit_paise", "created_at", "loaded_at"],
  fact_fraud_signals: ["signal_id", "customer_hash", "signal_type", "reference_id", "reference_type", "city", "created_at", "loaded_at"],
  fact_gps_pings: ["ping_id", "booking_id", "provider_hash", "ts", "lat", "lng", "accuracy_m", "loaded_at"],
  fact_notifications: ["notification_id", "user_hash", "type", "is_read", "created_at", "loaded_at"],
  fact_reviews: ["review_id", "booking_id", "customer_hash", "provider_hash", "stars", "created_at", "loaded_at"],
  fact_referrals: ["referral_id", "referrer_hash", "referred_hash", "status", "fraud_flagged", "created_at", "loaded_at"],
  fact_hcoin_txns: ["txn_id", "customer_hash", "amount", "type", "reason", "created_at", "loaded_at"],
  fact_scheduled_jobs: ["job_id", "job_type", "status", "run_at", "attempts", "created_at", "completed_at", "loaded_at"],
  fact_domain_events: ["outbox_id", "event_id", "event_type", "aggregate_type", "aggregate_id", "published_at", "created_at", "loaded_at"],
  fact_audit_logs: ["audit_id", "action", "actor_hash", "actor_type", "resource_type", "resource_id", "created_at", "loaded_at"],
  ml_eta_labels: [
    "event_id", "booking_id", "provider_hash", "travel_duration_min", "distance_km", "google_eta_min",
    "hour_of_day", "day_of_week", "city", "service_category", "ingested_at",
  ],
};

export function projectRow(tableId: string, row: Record<string, unknown>): Record<string, unknown> {
  const cols = BQ_TABLE_COLUMNS[tableId];
  if (!cols) return row;
  const out: Record<string, unknown> = {};
  for (const col of cols) {
    if (col in row) out[col] = row[col];
  }
  return out;
}

export function projectRows(tableId: string, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => projectRow(tableId, r));
}
