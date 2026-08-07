-- ============================================================================
-- HOMIGO Phase 1 — ARIMA_PLUS Demand Forecast Upgrade
-- Extends existing model_demand_forecast — does NOT replace.
-- Adds hourly/daily/weekly/monthly horizons + city/zone granularity.
-- ============================================================================

-- Rebuild training views with multi-granularity support
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics.vw_train_demand_hourly` AS
SELECT COALESCE(zone_id, 'unzoned') AS zone_id, city, hour_ts, bookings AS demand, revenue
FROM `homigo-497619.homigo_analytics_analytics.agg_hourly_demand`;

CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics.vw_train_demand_daily` AS
SELECT COALESCE(zone_id, 'unzoned') AS zone_id, city, day_ts AS ts, bookings AS demand, revenue
FROM `homigo-497619.homigo_analytics_analytics.agg_daily_demand`;

CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics.vw_train_demand_weekly` AS
SELECT COALESCE(zone_id, 'unzoned') AS zone_id, city, week_ts AS ts, bookings AS demand, revenue
FROM `homigo-497619.homigo_analytics_analytics.agg_weekly_demand`;

CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics.vw_train_demand_monthly` AS
SELECT COALESCE(zone_id, 'unzoned') AS zone_id, city, month_ts AS ts, bookings AS demand, revenue
FROM `homigo-497619.homigo_analytics_analytics.agg_monthly_demand`;

-- City-level demand (cross-zone aggregation)
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics.vw_train_city_demand` AS
SELECT city, hour_ts, SUM(bookings) AS demand, SUM(revenue) AS revenue
FROM `homigo-497619.homigo_analytics_analytics.agg_hourly_demand`
WHERE city IS NOT NULL
GROUP BY city, hour_ts;

-- Upgrade existing hourly zone model (extends, not replaces)
CREATE OR REPLACE MODEL `homigo-497619.homigo_analytics.model_demand_forecast`
OPTIONS (
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'hour_ts',
  time_series_data_col = 'demand',
  time_series_id_col = 'zone_id',
  horizon = 168,
  auto_arima = TRUE,
  data_frequency = 'HOURLY',
  holiday_region = 'IN',
  clean_spikes_and_dips = TRUE,
  adjust_step_changes = TRUE
) AS
SELECT zone_id, hour_ts, demand
FROM `homigo-497619.homigo_analytics.vw_train_demand`;

-- Daily forecast model (new — complements hourly)
CREATE OR REPLACE MODEL `homigo-497619.homigo_analytics.model_demand_forecast_daily`
OPTIONS (
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'ts',
  time_series_data_col = 'demand',
  time_series_id_col = 'zone_id',
  horizon = 30,
  auto_arima = TRUE,
  data_frequency = 'DAILY',
  holiday_region = 'IN'
) AS
SELECT zone_id, ts, demand
FROM `homigo-497619.homigo_analytics.vw_train_demand_daily`;

-- Weekly forecast model
CREATE OR REPLACE MODEL `homigo-497619.homigo_analytics.model_demand_forecast_weekly`
OPTIONS (
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'ts',
  time_series_data_col = 'demand',
  time_series_id_col = 'zone_id',
  horizon = 12,
  auto_arima = TRUE,
  data_frequency = 'WEEKLY'
) AS
SELECT zone_id, ts, demand
FROM `homigo-497619.homigo_analytics.vw_train_demand_weekly`;

-- City demand model (executive dashboard + digital twin)
CREATE OR REPLACE MODEL `homigo-497619.homigo_analytics.model_city_demand_forecast`
OPTIONS (
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'hour_ts',
  time_series_data_col = 'demand',
  time_series_id_col = 'city',
  horizon = 168,
  auto_arima = TRUE,
  data_frequency = 'HOURLY',
  holiday_region = 'IN'
) AS
SELECT city, hour_ts, demand
FROM `homigo-497619.homigo_analytics.vw_train_city_demand`;

-- Partner earnings forecast (revenue-based ARIMA)
CREATE OR REPLACE MODEL `homigo-497619.homigo_analytics.model_partner_earnings_forecast`
OPTIONS (
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'hour_ts',
  time_series_data_col = 'revenue',
  time_series_id_col = 'zone_id',
  horizon = 168,
  auto_arima = TRUE,
  data_frequency = 'HOURLY'
) AS
SELECT COALESCE(zone_id, 'all') AS zone_id, hour_ts, COALESCE(revenue, 0) AS revenue
FROM `homigo-497619.homigo_analytics_analytics.agg_hourly_demand`;

-- Surge planning view (demand vs capacity)
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics.vw_surge_planning` AS
SELECT
  d.zone_id, d.city, d.hour_ts, d.bookings AS demand,
  COALESCE(p.active_providers, 0) AS active_providers,
  SAFE_DIVIDE(d.bookings, NULLIF(p.active_providers, 0)) AS demand_per_provider,
  CASE
    WHEN SAFE_DIVIDE(d.bookings, NULLIF(p.active_providers, 0)) > 3 THEN 'HIGH_SURGE'
    WHEN SAFE_DIVIDE(d.bookings, NULLIF(p.active_providers, 0)) > 1.5 THEN 'MODERATE_SURGE'
    ELSE 'NORMAL'
  END AS surge_recommendation
FROM `homigo-497619.homigo_analytics_analytics.agg_hourly_demand` d
LEFT JOIN `homigo-497619.homigo_analytics.vw_provider_availability` p
  ON d.zone_id = p.zone_id AND EXTRACT(HOUR FROM d.hour_ts) = p.hour_of_day;

-- Forecast usage examples:
-- SELECT * FROM ML.FORECAST(MODEL `homigo-497619.homigo_analytics.model_demand_forecast`, STRUCT(24 AS horizon));
-- SELECT * FROM ML.FORECAST(MODEL `homigo-497619.homigo_analytics.model_city_demand_forecast`, STRUCT(48 AS horizon));
-- SELECT * FROM ML.FORECAST(MODEL `homigo-497619.homigo_analytics.model_demand_forecast_daily`, STRUCT(7 AS horizon));
