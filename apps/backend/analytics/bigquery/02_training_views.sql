-- ============================================================================
-- HOMIGO Analytics — training-ready views (ML feature/label datasets)
-- These expose clean, training-ready feature sets over the warehouse facts.
-- ============================================================================

-- ---- ETA prediction: features → label = realised travel minutes ----------
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics.vw_train_eta` AS
SELECT
  distance_km,
  hour_of_day,
  day_of_week,
  COALESCE(weather_temp_c, 0)  AS weather_temp_c,
  COALESCE(weather_surge, 1)   AS weather_surge,
  city,
  category,
  actual_duration_min          AS label_duration_min
FROM `homigo-497619.homigo_analytics.fact_bookings`
WHERE actual_duration_min IS NOT NULL
  AND distance_km > 0
  AND actual_duration_min BETWEEN 1 AND 240;   -- drop outliers

-- ---- Demand forecasting: hourly series per zone (ARIMA_PLUS input) --------
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics.vw_train_demand` AS
SELECT
  zone_id,
  hour_ts,
  bookings AS demand
FROM `homigo-497619.homigo_analytics.agg_hourly_demand`
WHERE bookings IS NOT NULL;

-- ---- Provider availability: online/active windows per zone × hour ---------
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics.vw_provider_availability` AS
SELECT
  b.zone_id,
  EXTRACT(HOUR FROM b.created_at) AS hour_of_day,
  EXTRACT(DAYOFWEEK FROM b.created_at) AS day_of_week,
  COUNT(DISTINCT b.provider_hash) AS active_providers,
  COUNT(*) AS bookings,
  SAFE_DIVIDE(COUNT(*), NULLIF(COUNT(DISTINCT b.provider_hash), 0)) AS load_per_provider
FROM `homigo-497619.homigo_analytics.fact_bookings` b
WHERE b.provider_hash IS NOT NULL
GROUP BY zone_id, hour_of_day, day_of_week;

-- ---- Fake-GPS / fraud-location: impossible speed between consecutive pings -
-- Flags teleportation (implied speed > 120 km/h between fixes) per provider —
-- the core signal for spoofed-GPS detection. Real moving providers stay well below.
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics.vw_fake_gps_signals` AS
WITH seq AS (
  SELECT
    provider_hash, booking_id, ts, lat, lng,
    LAG(lat) OVER w AS prev_lat,
    LAG(lng) OVER w AS prev_lng,
    LAG(ts)  OVER w AS prev_ts
  FROM `homigo-497619.homigo_analytics.fact_gps_pings`
  WINDOW w AS (PARTITION BY provider_hash ORDER BY ts)
)
SELECT
  provider_hash, booking_id, ts, lat, lng,
  -- haversine metres between consecutive fixes
  2 * 6371000 * ASIN(SQRT(
    POW(SIN(((lat - prev_lat) * ACOS(-1)/180) / 2), 2) +
    COS(prev_lat * ACOS(-1)/180) * COS(lat * ACOS(-1)/180) *
    POW(SIN(((lng - prev_lng) * ACOS(-1)/180) / 2), 2)
  )) AS jump_meters,
  TIMESTAMP_DIFF(ts, prev_ts, SECOND) AS dt_seconds,
  SAFE_DIVIDE(
    2 * 6371000 * ASIN(SQRT(
      POW(SIN(((lat - prev_lat) * ACOS(-1)/180) / 2), 2) +
      COS(prev_lat * ACOS(-1)/180) * COS(lat * ACOS(-1)/180) *
      POW(SIN(((lng - prev_lng) * ACOS(-1)/180) / 2), 2)
    )),
    NULLIF(TIMESTAMP_DIFF(ts, prev_ts, SECOND), 0)
  ) * 3.6 AS implied_kmh,
  CASE WHEN SAFE_DIVIDE(
    2 * 6371000 * ASIN(SQRT(
      POW(SIN(((lat - prev_lat) * ACOS(-1)/180) / 2), 2) +
      COS(prev_lat * ACOS(-1)/180) * COS(lat * ACOS(-1)/180) *
      POW(SIN(((lng - prev_lng) * ACOS(-1)/180) / 2), 2)
    )),
    NULLIF(TIMESTAMP_DIFF(ts, prev_ts, SECOND), 0)
  ) * 3.6 > 120 THEN TRUE ELSE FALSE END AS is_suspicious
FROM seq
WHERE prev_ts IS NOT NULL;
