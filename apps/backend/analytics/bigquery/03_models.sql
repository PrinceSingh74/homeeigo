-- ============================================================================
-- HOMIGO Analytics — BigQuery ML prediction foundations
-- Real in-warehouse models. Run after the ETL has populated the facts/aggregates.
-- ============================================================================

-- ---- 1) DEMAND FORECAST (ARIMA_PLUS) -------------------------------------
-- Per-zone hourly booking-demand forecaster. Trains on agg_hourly_demand and
-- supports ML.FORECAST(model, horizon) for the next N hours per zone.
CREATE OR REPLACE MODEL `homigo-497619.homigo_analytics.model_demand_forecast`
OPTIONS (
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'hour_ts',
  time_series_data_col = 'demand',
  time_series_id_col = 'zone_id',
  horizon = 24,
  auto_arima = TRUE,
  data_frequency = 'HOURLY'
) AS
SELECT zone_id, hour_ts, demand
FROM `homigo-497619.homigo_analytics.vw_train_demand`;

-- Forecast usage:
--   SELECT * FROM ML.FORECAST(MODEL `homigo-497619.homigo_analytics.model_demand_forecast`,
--                             STRUCT(12 AS horizon, 0.9 AS confidence_level));

-- ---- 2) ETA PREDICTION (LINEAR_REG / BOOSTED_TREE) ------------------------
-- Predicts realised travel minutes from distance + time-of-day + weather + city.
-- NOTE: requires a clean `actual_duration_min` label = realised provider→customer
-- travel time (first-GPS-dispatch → ARRIVED). Ready to run once that signal is
-- captured in fact_bookings (the warehouse + view are already in place).
CREATE OR REPLACE MODEL `homigo-497619.homigo_analytics.model_eta`
OPTIONS (
  model_type = 'BOOSTED_TREE_REGRESSOR',
  input_label_cols = ['label_duration_min'],
  max_iterations = 30
) AS
SELECT distance_km, hour_of_day, day_of_week, weather_temp_c, weather_surge, city, category, label_duration_min
FROM `homigo-497619.homigo_analytics.vw_train_eta`;

-- Predict usage:
--   SELECT * FROM ML.PREDICT(MODEL `homigo-497619.homigo_analytics.model_eta`,
--     (SELECT 5.2 AS distance_km, 18 AS hour_of_day, 3 AS day_of_week,
--             32.0 AS weather_temp_c, 1.2 AS weather_surge, 'Delhi' AS city, 'Cleaning' AS category));

-- ---- 3) FAKE-GPS / FRAUD-LOCATION ----------------------------------------
-- Already functional as a rule-based detector over vw_fake_gps_signals
-- (implied speed > 120 km/h between consecutive fixes ⇒ spoofed/teleport).
-- A supervised model can be layered on once labelled fraud cases accumulate:
--   CREATE OR REPLACE MODEL model_fake_gps OPTIONS(model_type='LOGISTIC_REG',
--     input_label_cols=['is_suspicious']) AS
--   SELECT jump_meters, dt_seconds, implied_kmh, is_suspicious FROM vw_fake_gps_signals;
