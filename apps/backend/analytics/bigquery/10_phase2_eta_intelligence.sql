-- ============================================================================
-- HOMIGO Phase 2 — ETA Intelligence Data Collection Platform
-- Extends Phase 1 five-layer architecture. NO ML models — label collection only.
-- ============================================================================

-- ---- RAW layer: all captured ETA signals -----------------------------------
CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics_raw.eta_raw` (
  booking_id STRING NOT NULL,
  partner_hash STRING,
  customer_hash STRING,
  city STRING,
  service_category STRING,
  dispatch_at TIMESTAMP,
  arrival_at TIMESTAMP,
  actual_travel_duration_sec INT64,
  google_eta_seconds INT64,
  google_distance_meters FLOAT64,
  status STRING,
  ingested_at TIMESTAMP
);

-- ---- VALIDATED layer: quality-checked labels -------------------------------
CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics_validated.eta_validated` (
  booking_id STRING NOT NULL,
  partner_hash STRING,
  customer_hash STRING,
  city STRING,
  service_category STRING,
  dispatch_at TIMESTAMP,
  arrival_at TIMESTAMP,
  actual_travel_duration_sec INT64,
  google_eta_seconds INT64,
  google_distance_meters FLOAT64,
  status STRING,
  quality_score FLOAT64,
  ingested_at TIMESTAMP
);

-- ---- FEATURE layer: engineered features for future ML --------------------
CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics_feature.eta_feature` (
  booking_id STRING NOT NULL,
  partner_hash STRING,
  city STRING,
  distance_bucket STRING,
  weather_bucket STRING,
  bearing FLOAT64,
  route_efficiency FLOAT64,
  average_speed FLOAT64,
  peak_hour BOOL,
  rush_hour BOOL,
  rain FLOAT64,
  temperature FLOAT64,
  partner_rating FLOAT64,
  hour INT64,
  weekday INT64,
  feature_generated_at TIMESTAMP
);

-- ---- TRAINING layer: supervised learning labels --------------------------
CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics_analytics.eta_training` (
  booking_id STRING NOT NULL,
  label_actual_travel_duration_sec INT64,
  label_actual_travel_duration_min FLOAT64,
  feature_google_eta_seconds INT64,
  feature_google_eta_minutes FLOAT64,
  feature_distance_meters FLOAT64,
  feature_city STRING,
  feature_hour INT64,
  feature_weekday INT64,
  gap_seconds INT64,
  training_version STRING,
  created_at TIMESTAMP
);

-- ---- Prediction history (placeholder for Phase 3 — no active predictions) -
CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics_analytics.eta_prediction_history` (
  booking_id STRING,
  predicted_eta_seconds INT64,
  google_eta_seconds INT64,
  actual_eta_seconds INT64,
  model_version STRING,
  shadow_mode BOOL DEFAULT TRUE,
  predicted_at TIMESTAMP
);

-- ---- ETA Feature Store view (versioned, auditable) -----------------------
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics_feature.fs_eta_features_v2` AS
SELECT
  t.booking_id,
  f.partner_hash,
  f.city,
  f.distance_bucket,
  f.weather_bucket,
  f.bearing,
  f.route_efficiency,
  f.average_speed,
  f.peak_hour,
  f.rush_hour,
  f.rain,
  f.temperature,
  f.partner_rating,
  f.hour,
  f.weekday,
  t.label_actual_travel_duration_sec AS label_duration_sec,
  t.feature_google_eta_seconds AS google_eta_sec,
  t.gap_seconds,
  t.training_version,
  CURRENT_TIMESTAMP() AS feature_generated_at
FROM `homigo-497619.homigo_analytics_analytics.eta_training` t
LEFT JOIN `homigo-497619.homigo_analytics_feature.eta_feature` f
  ON t.booking_id = f.booking_id
WHERE t.label_actual_travel_duration_sec IS NOT NULL
  AND t.label_actual_travel_duration_sec BETWEEN 60 AND 14400;

-- ---- Training-ready view (extends Phase 1 vw_train_eta) ------------------
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics.vw_train_eta_v2` AS
SELECT
  feature_distance_meters / 1000.0 AS distance_km,
  feature_hour AS hour_of_day,
  feature_weekday AS day_of_week,
  COALESCE(temperature, 0) AS weather_temp_c,
  1.0 AS weather_surge,
  feature_city AS city,
  'general' AS category,
  label_actual_travel_duration_min AS label_duration_min,
  feature_google_eta_minutes AS google_eta_min,
  gap_seconds / 60.0 AS gap_minutes
FROM `homigo-497619.homigo_analytics_analytics.eta_training` t
LEFT JOIN `homigo-497619.homigo_analytics_feature.eta_feature` f
  ON t.booking_id = f.booking_id
WHERE label_actual_travel_duration_min IS NOT NULL
  AND label_actual_travel_duration_min BETWEEN 1 AND 240
  AND feature_distance_meters > 0;

-- ---- Google snapshot raw table --------------------------------------------
CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics_raw.eta_google_snapshots` (
  booking_id STRING,
  request_at TIMESTAMP,
  response_at TIMESTAMP,
  api_latency_ms INT64,
  status STRING,
  eta_seconds INT64,
  distance_meters FLOAT64,
  traffic_model STRING,
  polyline_hash STRING,
  source STRING,
  ingested_at TIMESTAMP
);

-- ---- GPS compressed tracks (metadata; full path in PG) --------------------
CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics_raw.eta_gps_tracks` (
  booking_id STRING,
  partner_hash STRING,
  ping_count INT64,
  first_timestamp TIMESTAMP,
  last_timestamp TIMESTAMP,
  avg_accuracy FLOAT64,
  avg_sampling_hz FLOAT64,
  ingested_at TIMESTAMP
);
