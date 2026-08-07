-- Surge planning view (deployed separately — trailing view after MODEL blocks in 07)
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
