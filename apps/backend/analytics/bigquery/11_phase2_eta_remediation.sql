-- ============================================================================
-- HOMIGO Phase 2 — ETA Intelligence remediation (P1-1, P1-2, P2-2)
--
-- Additive only. No DROP, no data loss, no column rename. Extends the tables
-- created by 10_phase2_eta_intelligence.sql.
--
--   P1-1  arrival_source / quality / validation must survive to the training layer
--   P1-2  canonical ETA tables need an idempotent (MERGE) write path
--   P2-2  synthetic certification data must be excludable from training
-- ============================================================================

-- ---- P1-1 + P2-2: provenance, quality and origin columns -------------------
-- arrival_source : 'gps_geofence' (GPS-confirmed) | 'job_start' (inferred at start)
-- is_synthetic   : TRUE for certification/test fixtures, which must never train
ALTER TABLE `homigo-497619.homigo_analytics_raw.eta_raw`
  ADD COLUMN IF NOT EXISTS arrival_source STRING,
  ADD COLUMN IF NOT EXISTS is_synthetic BOOL;

ALTER TABLE `homigo-497619.homigo_analytics_validated.eta_validated`
  ADD COLUMN IF NOT EXISTS arrival_source STRING,
  ADD COLUMN IF NOT EXISTS is_synthetic BOOL;

ALTER TABLE `homigo-497619.homigo_analytics_feature.eta_feature`
  ADD COLUMN IF NOT EXISTS arrival_source STRING,
  ADD COLUMN IF NOT EXISTS quality_score FLOAT64,
  ADD COLUMN IF NOT EXISTS validation_status STRING,
  ADD COLUMN IF NOT EXISTS is_synthetic BOOL;

-- The training layer previously carried neither quality nor validation state, so a
-- trainer had no way to filter on either. Both are added here alongside provenance.
ALTER TABLE `homigo-497619.homigo_analytics_analytics.eta_training`
  ADD COLUMN IF NOT EXISTS arrival_source STRING,
  ADD COLUMN IF NOT EXISTS quality_score FLOAT64,
  ADD COLUMN IF NOT EXISTS validation_status STRING,
  ADD COLUMN IF NOT EXISTS is_synthetic BOOL;

-- ---- P1-2: staging tables backing the MERGE upsert -------------------------
-- Schema-cloned from their targets so they stay in step automatically.
-- Each MERGE truncates its staging table first, so they hold no durable state.
CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics_raw.eta_raw_stg`
AS SELECT * FROM `homigo-497619.homigo_analytics_raw.eta_raw` WHERE FALSE;

CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics_validated.eta_validated_stg`
AS SELECT * FROM `homigo-497619.homigo_analytics_validated.eta_validated` WHERE FALSE;

CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics_feature.eta_feature_stg`
AS SELECT * FROM `homigo-497619.homigo_analytics_feature.eta_feature` WHERE FALSE;

CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics_analytics.eta_training_stg`
AS SELECT * FROM `homigo-497619.homigo_analytics_analytics.eta_training` WHERE FALSE;

-- ---- Training eligibility contract -----------------------------------------
-- A single place that defines what may enter ETA model training. Downstream
-- consumers select from this view rather than re-deriving the rules.
--
--   TRAINING_ELIGIBLE = REAL AND VALID AND QUALITY_OK AND PROVENANCE_PRESENT AND UNIQUE
--
-- Uniqueness is guaranteed upstream by the MERGE on booking_id; the QUALIFY here is
-- defence in depth, not the primary mechanism.
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics_analytics.vw_eta_training_eligible` AS
SELECT
  t.booking_id,
  t.label_actual_travel_duration_sec,
  t.label_actual_travel_duration_min,
  t.feature_google_eta_seconds,
  t.feature_google_eta_minutes,
  t.feature_distance_meters,
  t.feature_city,
  t.feature_hour,
  t.feature_weekday,
  t.gap_seconds,
  t.arrival_source,
  t.quality_score,
  t.validation_status,
  t.training_version,
  t.created_at
FROM `homigo-497619.homigo_analytics_analytics.eta_training` t
WHERE
  -- REAL: certification and test fixtures never train
  COALESCE(t.is_synthetic, FALSE) = FALSE
  -- VALID: the label itself passed validation
  AND t.validation_status = 'TRAINING_READY'
  -- VALID: the supervised target must exist and be physically plausible
  AND t.label_actual_travel_duration_sec IS NOT NULL
  AND t.label_actual_travel_duration_sec BETWEEN 60 AND 14400
  -- QUALITY_OK: same threshold the Postgres validator applies
  AND COALESCE(t.quality_score, 0) >= 70
  -- PROVENANCE_PRESENT: a trainer must be able to weight by arrival precision
  AND t.arrival_source IN ('gps_geofence', 'job_start')
-- UNIQUE: one canonical row per booking
QUALIFY ROW_NUMBER() OVER (PARTITION BY t.booking_id ORDER BY t.created_at DESC) = 1;

-- ---- Provenance-aware feature store view -----------------------------------
-- Replaces the previous fs_eta_features_v2, which joined two append-only tables and
-- therefore multiplied rows whenever either side held duplicates.
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics_feature.fs_eta_features_v2` AS
WITH training AS (
  SELECT * FROM `homigo-497619.homigo_analytics_analytics.vw_eta_training_eligible`
),
features AS (
  SELECT * FROM `homigo-497619.homigo_analytics_feature.eta_feature`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY booking_id ORDER BY feature_generated_at DESC) = 1
)
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
  t.arrival_source,
  t.quality_score,
  t.training_version,
  CURRENT_TIMESTAMP() AS feature_generated_at
FROM training t
LEFT JOIN features f ON t.booking_id = f.booking_id;

-- ---- Legacy training view, now duplicate- and synthetic-safe ---------------
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics.vw_train_eta_v2` AS
WITH features AS (
  SELECT * FROM `homigo-497619.homigo_analytics_feature.eta_feature`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY booking_id ORDER BY feature_generated_at DESC) = 1
)
SELECT
  t.feature_distance_meters / 1000.0 AS distance_km,
  t.feature_hour AS hour_of_day,
  t.feature_weekday AS day_of_week,
  COALESCE(f.temperature, 0) AS weather_temp_c,
  1.0 AS weather_surge,
  t.feature_city AS city,
  'general' AS category,
  t.label_actual_travel_duration_min AS label_duration_min,
  t.feature_google_eta_minutes AS google_eta_min,
  t.gap_seconds / 60.0 AS gap_minutes,
  t.arrival_source
FROM `homigo-497619.homigo_analytics_analytics.vw_eta_training_eligible` t
LEFT JOIN features f ON t.booking_id = f.booking_id
WHERE t.label_actual_travel_duration_min BETWEEN 1 AND 240
  AND t.feature_distance_meters > 0;
