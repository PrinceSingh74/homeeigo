-- ============================================================================
-- HOMIGO Analytics Warehouse — BigQuery DDL
-- Project: homigo-497619   Dataset: homigo_analytics   Location: asia-south1
-- ----------------------------------------------------------------------------
-- Star schema for geo/mobility intelligence + ML training. PII-safe: customer
-- and provider identities are carried only as SHA256 hashes (no names / emails /
-- phones). Fact tables are date-partitioned + clustered for cost control.
-- ============================================================================

-- ---- Dimensions -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics.dim_service` (
  service_id   STRING NOT NULL,
  name         STRING,
  category     STRING,
  base_price   FLOAT64,
  is_active    BOOL,
  loaded_at    TIMESTAMP
) OPTIONS (description = "Service catalogue dimension.");

CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics.dim_zone` (
  zone_id          STRING NOT NULL,
  name             STRING,
  city             STRING,
  center_lat       FLOAT64,
  center_lng       FLOAT64,
  radius_m         FLOAT64,
  surge_multiplier FLOAT64,
  loaded_at        TIMESTAMP
) OPTIONS (description = "Geofence / operating-zone dimension.");

-- ---- Facts ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics.fact_bookings` (
  booking_id      STRING NOT NULL,
  created_at      TIMESTAMP NOT NULL,
  scheduled_at    TIMESTAMP,
  completed_at    TIMESTAMP,
  customer_hash   STRING,             -- SHA256(customer_id) — PII-safe join key
  provider_hash   STRING,             -- SHA256(provider_id)
  service_id      STRING,
  category        STRING,
  city            STRING,
  zone_id         STRING,
  status          STRING,
  is_completed    BOOL,
  is_cancelled    BOOL,
  base_amount     FLOAT64,
  final_amount    FLOAT64,
  total_amount    FLOAT64,
  commission      FLOAT64,
  eta_min         FLOAT64,            -- predicted ETA at booking
  distance_km     FLOAT64,
  actual_duration_min FLOAT64,        -- realised provider→customer travel (for ETA training)
  dest_lat        FLOAT64,
  dest_lng        FLOAT64,
  payment_status  STRING,
  rating          FLOAT64,
  weather_temp_c  FLOAT64,
  weather_surge   FLOAT64,
  hour_of_day     INT64,
  day_of_week     INT64,
  loaded_at       TIMESTAMP
)
PARTITION BY DATE(created_at)
CLUSTER BY city, status
OPTIONS (description = "Booking fact — one row per booking. ETA/demand/revenue training source.");

CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics.fact_gps_pings` (
  ping_id        STRING NOT NULL,
  booking_id     STRING,
  provider_hash  STRING,
  ts             TIMESTAMP NOT NULL,
  lat            FLOAT64,
  lng            FLOAT64,
  speed_mps      FLOAT64,
  bearing_deg    FLOAT64,
  accuracy_m     FLOAT64,
  loaded_at      TIMESTAMP
)
PARTITION BY DATE(ts)
CLUSTER BY provider_hash
OPTIONS (description = "Raw GPS pings — fake-GPS / fraud-location + ETA training source.");

CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics.fact_geofence_events` (
  event_id       STRING NOT NULL,
  geofence_id    STRING,
  provider_hash  STRING,
  event_type     STRING,             -- ENTER | EXIT
  ts             TIMESTAMP NOT NULL,
  lat            FLOAT64,
  lng            FLOAT64,
  loaded_at      TIMESTAMP
)
PARTITION BY DATE(ts)
OPTIONS (description = "Geofence transition events.");

-- ---- Aggregates (demand forecasting) --------------------------------------
CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics.agg_hourly_demand` (
  zone_id      STRING,
  city         STRING,
  hour_ts      TIMESTAMP NOT NULL,
  bookings     INT64,
  completed    INT64,
  cancelled    INT64,
  revenue      FLOAT64,
  avg_eta_min  FLOAT64,
  avg_surge    FLOAT64,
  loaded_at    TIMESTAMP
)
PARTITION BY DATE(hour_ts)
CLUSTER BY zone_id
OPTIONS (description = "Zone × hour demand aggregate — ARIMA_PLUS demand-forecast source.");
