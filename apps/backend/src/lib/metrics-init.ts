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

  // ── Auth bootstrap (server-side refresh) ──
  for (const outcome of ["success", "failure"]) {
    incCounter("auth_refresh_total", { outcome }, 0);
  }
  incCounter("auth_refresh_failures", undefined, 0);
  incCounter("auth_startup_401_total", undefined, 0);
  setGauge("auth_bootstrap_duration_ms", 0);

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
  setGauge("homigo_outbox_pending", 0);
  setGauge("homigo_outbox_oldest_pending_age_seconds", 0);
  setGauge("homigo_scheduled_jobs_pending", 0);
  setGauge("homigo_scheduled_job_lag_seconds", 0);
  setGauge("homigo_dlq_unresolved", 0);
  for (const domain of ["booking", "payment", "partner"]) {
    incCounter("homigo_event_by_domain_total", { domain }, 0);
  }
}
