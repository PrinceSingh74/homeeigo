/**
 * Initialise counters to 0 at boot so Grafana panels render "0" instead of "NO DATA".
 * Prometheus best practice: a counter that has never been incremented is absent from the
 * scrape; pre-seeding every known label combination makes dashboards complete from t=0.
 * These are real series at value 0 — not mock data; they increment on real events.
 */
import { incCounter, setGauge } from "./metrics";

export function initMetricsAtZero(): void {
  // ── Security observability (P2) ──
  incCounter("failed_login_total", undefined, 0);
  for (const reason of ["role_mismatch", "no_permission", "not_admin", "unmapped_route"]) {
    incCounter("rbac_denied_total", { reason }, 0);
  }
  for (const scope of ["global", "payments_create_order", "search"]) {
    incCounter("rate_limit_triggered_total", { scope }, 0);
  }
  incCounter("webhook_verification_failed_total", { provider: "razorpay" }, 0);
  for (const kind of ["login_brute_force_ip", "login_brute_force_email", "webhook_bad_signature", "rbac_permission_violation"]) {
    incCounter("suspicious_activity_total", { kind }, 0);
  }
  // Newly-tracked security signals (P2 spec).
  incCounter("jwt_failures_total", undefined, 0);
  incCounter("sql_injection_attempts_total", undefined, 0);
  incCounter("brute_force_attempts_total", undefined, 0);

  // ── Maps economics per-endpoint (P6) ──
  for (const m of ["geocode_requests_total", "places_requests_total", "directions_requests_total", "distance_matrix_requests_total"]) {
    incCounter(m, undefined, 0);
  }
  for (const endpoint of ["geocode", "place", "directions", "distancematrix"]) {
    incCounter("google_api_calls_total", { endpoint }, 0);
  }

  // ── Geofence transitions (P3) ──
  incCounter("geofence_enter_total", undefined, 0);
  incCounter("geofence_exit_total", undefined, 0);

  // ── Geo-Intelligence API ──
  for (const endpoint of ["demand-forecast", "surge-prediction", "zone-scoring", "provider-density", "revenue-forecast", "eta", "fraud", "exec-kpis"]) {
    incCounter("geo_intel_requests_total", { endpoint }, 0);
  }

  // ── Partner Navigation (Phase-4 final) ──
  for (const m of ["partner_nav_sessions_total", "partner_nav_reroutes_total", "partner_nav_arrivals_total", "partner_nav_pickups_total", "partner_nav_drops_total"]) {
    incCounter(m, undefined, 0);
  }

  // ── MLOps / Vertex AI platform (Phase-4 Track 5) ──
  for (const model of ["model_demand_forecast", "model_revenue_forecast", "model_clv"]) {
    incCounter("model_inference_total", { model }, 0);
    incCounter("model_inference_errors_total", { model }, 0);
  }

  // ── City Digital Twin (Phase-4 Track 4) ──
  for (const city of ["Delhi", "Gurugram", "Noida", "Mumbai", "Bangalore", "Hyderabad", "Pune"]) {
    incCounter("digital_twin_scenarios_total", { city }, 0);
  }

  // ── Customer Intelligence (Phase-4 Track 3) ──
  for (const endpoint of ["profile", "match"]) incCounter("customer_ai_requests_total", { endpoint }, 0);
  for (const kind of ["membership", "subscription", "upsell", "rebook", "service"]) incCounter("customer_recommendation_clicks_total", { kind }, 0);

  // ── Dynamic Pricing Engine (Phase-4 Track 2) ──
  incCounter("pricing_quote_total", undefined, 0);
  for (const experiment of ["surge_v1"]) {
    for (const variant of ["control", "treatment"]) {
      incCounter("pricing_experiment_exposure_total", { experiment, variant }, 0);
      incCounter("pricing_experiment_conversion_total", { experiment, variant }, 0);
    }
  }

  // ── Cache economics (P6) ──
  for (const domain of ["weather", "catalog", "heatmap", "ops-map"]) {
    incCounter("cache_hits_total", { tier: "l2", domain }, 0);
    incCounter("cache_misses_total", { domain }, 0);
  }

  // ── Recovery / resilience telemetry (production failure recovery program) ──
  for (const signal of [
    "offline_enqueue", "offline_replay", "jwt_refresh", "realtime_reconnect",
    "heartbeat_timeout", "queue_drain", "cache_invalidation",
  ]) {
    incCounter("ux_signal_total", { signal, device: "other", network: "unknown", route: "other" }, 0);
  }
  for (const outcome of ["success", "failure"]) {
    incCounter("jwt_refresh_total", { outcome }, 0);
  }
  incCounter("redis_reconnect_total", undefined, 0);
  incCounter("backend_restart_total", undefined, 0);

  // ── Finance Intelligence (V5) — always-real gauges seeded to 0. Config-dependent
  //    gauges (ebitda/burn/runway/profit forecast) are intentionally NOT seeded: they
  //    appear only when their env inputs exist, so absence == honest "no data". ──
  for (const g of [
    "fin_canonical_gmv_inr",
    "fin_net_revenue_inr",
    "fin_gross_profit_inr",
    "fin_gross_margin_pct",
    "fin_contribution_forecast_monthly_inr",
    "fin_config_gateway_fee_pct",
    "fin_config_opex_source_db",
    "fin_config_cash_source_db",
  ]) {
    setGauge(g, 0);
  }

  // ── Email delivery observability ──
  incCounter("email_sent_total", { type: "password_reset" }, 0);
  incCounter("email_failed_total", { type: "password_reset", reason: "unknown" }, 0);
  incCounter("email_bounced_total", { type: "bounce" }, 0);
  incCounter("email_webhook_rejected_total", { reason: "bad_signature" }, 0);
  incCounter("email_webhook_rejected_total", { reason: "secret_not_configured" }, 0);
  incCounter("email_webhook_rejected_total", { reason: "timestamp_out_of_window" }, 0);

  // ── Enterprise backup retention (GFS) ──
  setGauge("backup_total", 0);
  setGauge("backup_size_bytes", 0);
  setGauge("backup_last_success_timestamp", 0);
  setGauge("backup_retention_deleted_total", 0);

  // ── Admin alert broadcast hardening ──
  incCounter("admin_alerts_sent_total", undefined, 0);
  for (const reason of ["no_subscribers"]) {
    incCounter("admin_alerts_skipped_total", { reason }, 0);
  }
  incCounter("admin_alerts_deduplicated_total", undefined, 0);
  for (const kind of ["throttle", "batch_cap"]) {
    incCounter("admin_alerts_rate_limited_total", { kind }, 0);
  }

  // ── WebSocket lifecycle ──
  incCounter("websocket_reconnect_total", undefined, 0);
  incCounter("websocket_duplicate_join_total", { room: "admin:ops" }, 0);
  setGauge("websocket_room_count", 0);
  setGauge("websocket_connection_count", 0);
  incCounter("websocket_heartbeat_failures", undefined, 0);
  incCounter("websocket_evictions_total", { reason: "reassigned" }, 0);
  incCounter("websocket_evictions_total", { reason: "token_expired" }, 0);
  incCounter("websocket_evictions_total", { reason: "session_revoked" }, 0);
  incCounter("websocket_evictions_total", { reason: "offer_rejected" }, 0);
  incCounter("websocket_evictions_total", { reason: "offer_timeout" }, 0);
  incCounter("websocket_evictions_total", { reason: "offer_withdrawn" }, 0);

  // ── Auth bootstrap (server-side refresh) ──
  for (const outcome of ["success", "failure"]) {
    incCounter("auth_refresh_total", { outcome }, 0);
  }
  incCounter("auth_refresh_failures", undefined, 0);
  incCounter("auth_startup_401_total", undefined, 0);
  setGauge("auth_bootstrap_duration_ms", 0);

  // ── Partner presence (Phase 1 liveness evidence) ──
  incCounter("partner_presence_heartbeat_success_total", undefined, 0);
  incCounter("partner_presence_heartbeat_duplicate_total", undefined, 0);
  incCounter("partner_presence_heartbeat_reject_total", { reason: "rate_limit" }, 0);
  incCounter("partner_presence_heartbeat_reject_total", { reason: "stale_session" }, 0);
  incCounter("partner_presence_heartbeat_reject_total", { reason: "invalid_session" }, 0);
  incCounter("partner_presence_location_error_total", { reason: "INVALID_LATITUDE" }, 0);
  incCounter("partner_presence_location_error_total", { reason: "IMPOSSIBLE_JUMP" }, 0);
  incCounter("partner_presence_location_success_total", undefined, 0);
  setGauge("partner_presence_stale_total", 0);
  setGauge("partner_presence_expired_total", 0);
  setGauge("partner_location_stale_total", 0);

  // ── Phase 2 dispatch eligibility ──
  incCounter("dispatch_eligibility_pass_total", undefined, 0);
  incCounter("dispatch_eligibility_reject_total", { reason: "STALE_PRESENCE" }, 0);
  incCounter("dispatch_eligibility_reject_total", { reason: "STALE_LOCATION" }, 0);
  incCounter("dispatch_eligibility_reject_total", { reason: "NOT_ACTIVE" }, 0);
  incCounter("dispatch_eligibility_reject_total", { reason: "NOT_AVAILABLE" }, 0);
  incCounter("final_revalidation_failures", { reason: "STALE_PRESENCE" }, 0);
  incCounter("direct_assignment_rejections", { reason: "STALE_PRESENCE" }, 0);
  incCounter("admin_reassignment_rejections", { reason: "STALE_PRESENCE" }, 0);

  // ── Domain event platform (Intelligence Phase 0) ──
  incCounter("homigo_domain_event_total", { event_type: "bootstrap" }, 0);
  incCounter("homigo_outbox_publish_total", { result: "success" }, 0);
  incCounter("homigo_outbox_publish_total", { result: "retry" }, 0);
  incCounter("homigo_outbox_publish_total", { result: "failed_terminal" }, 0);
  incCounter("homigo_consumer_processed_total", { consumer: "metrics.v1", event_type: "bootstrap" }, 0);
  incCounter("homigo_consumer_failed_total", { consumer: "metrics.v1", event_type: "bootstrap" }, 0);
  incCounter("homigo_consumer_retry_total", { consumer: "metrics.v1" }, 0);
  incCounter("homigo_consumer_skipped_total", { consumer: "metrics.v1", reason: "idempotent" }, 0);
  incCounter("homigo_dlq_total", { consumer: "metrics.v1", event_type: "bootstrap" }, 0);
  incCounter("homigo_dlq_persist_failed_total", { consumer: "metrics.v1", event_type: "bootstrap" }, 0);

  // ── Data archival (P1-7) ──
  incCounter("data_archival_run_total", { result: "success" }, 0);
  incCounter("data_archival_run_total", { result: "partial_failure" }, 0);
  incCounter("data_archival_pruned_total", { model: "appLogEntry", result: "success" }, 0);
  incCounter("data_archival_pruned_total", { model: "notification", result: "success" }, 0);

  // ── Scheduled DB backup outcome (P2-6) — a silent backup failure must be impossible ──
  incCounter("db_backup_total", { result: "success" }, 0);
  incCounter("db_backup_total", { result: "failed" }, 0);
  incCounter("db_backup_total", { result: "timeout" }, 0);
  incCounter("db_backup_total", { result: "spawn_error" }, 0);

  // ── Distributed lock fallback visibility (P1-5) ──
  incCounter("homigo_lock_fallback_total", { key: "bootstrap", reason: "redis_unavailable" }, 0);
  incCounter("homigo_lock_fallback_total", { key: "bootstrap", reason: "redis_error" }, 0);
  // `exclusive_anchor` is the routine path for exclusive jobs; `no_arbiter` means one was skipped
  // because neither Redis nor Postgres could answer. Both are seeded so their alerts read 0 rather
  // than NO-DATA before the first occurrence. (`pg_advisory` was the old name for the anchor and no
  // longer exists — seeding it would publish a series nothing can ever write to.)
  incCounter("homigo_lock_fallback_total", { key: "bootstrap", reason: "exclusive_anchor" }, 0);
  incCounter("homigo_lock_fallback_total", { key: "bootstrap", reason: "no_arbiter" }, 0);
  incCounter("homigo_lock_fallback_total", { key: "bootstrap", reason: "redis_error_release" }, 0);
  incCounter("homigo_scheduled_job_executions_total", { job_type: "bootstrap", result: "success" }, 0);
  incCounter("homigo_scheduled_job_executions_total", { job_type: "bootstrap", result: "failed_terminal" }, 0);
  incCounter("homigo_scheduled_job_executions_total", { job_type: "bootstrap", result: "retry" }, 0);
  incCounter("homigo_lock_lease_lost_total", { key: "bootstrap" }, 0);
  incCounter("financial_liability_drift_total", undefined, 0);
  incCounter("boot_degraded_total", { component: "bootstrap" }, 0);
  incCounter("service_configuration_validation_failures_total", undefined, 0);
  incCounter("service_publish_total", undefined, 0);
  incCounter("service_pause_total", undefined, 0);
  incCounter("service_quote_failures_total", { reason: "not_bookable" }, 0);
  incCounter("service_availability_failures_total", { reason: "not_bookable" }, 0);
  incCounter("service_availability_failures_total", { reason: "coverage" }, 0);
  incCounter("service_payment_policy_rejected_total", { reason: "wallet" }, 0);
  incCounter("service_payment_policy_rejected_total", { reason: "coupon" }, 0);
  incCounter("service_payment_policy_rejected_total", { reason: "split" }, 0);
  incCounter("service_quality_completion_block_total", { reason: "QUALITY_PROOF_REQUIRED" }, 0);
  incCounter("service_provider_ineligible_total", { reason: "required_skill" }, 0);
  incCounter("service_booking_conversion_total", undefined, 0);
  /**
   * Booking-create transaction retries, per Prisma error code.
   *
   * Seeded at zero deliberately: this counter exists BECAUSE the retries were invisible. Booking
   * creation ran at SERIALIZABLE and aborted 48% of first attempts with P2034 (2026-09-21); the
   * retry ladder was the whole p99 and nothing recorded it — Postgres does not log a client-side
   * serialization abort, and the retry branch was silent. An absent counter would let that state
   * return as "NO DATA" rather than as a visible zero that can be alerted on.
   */
  for (const code of ["P2034", "P2002", "P2010", "P2024", "P2028", "P2037"]) {
    incCounter("booking_create_tx_retry_total", { code }, 0);
  }
  incCounter("service_view_total", undefined, 0);
  incCounter("service_search_total", undefined, 0);
  incCounter("service_quote_generated_total", undefined, 0);
  incCounter("booking_loyalty_credit_failed_total", { kind: "hcoin" }, 0);
  incCounter("booking_loyalty_credit_failed_total", { kind: "cashback" }, 0);
  incCounter("partner_event_emit_failed_total", { event: "rating_received" }, 0);
  setGauge("homigo_outbox_pending", 0);
  setGauge("homigo_outbox_oldest_pending_age_seconds", 0);
  setGauge("homigo_scheduled_jobs_pending", 0);
  setGauge("homigo_scheduled_job_lag_seconds", 0);
  setGauge("homigo_dlq_unresolved", 0);
  for (const domain of ["booking", "payment", "partner"]) {
    incCounter("homigo_event_by_domain_total", { domain }, 0);
  }
}
