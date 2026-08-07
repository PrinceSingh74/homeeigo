-- Phase 1 schema alignment — add columns missing from legacy warehouse DDL
-- Safe to re-run: ADD COLUMN IF NOT EXISTS (BigQuery supports via ALTER)

ALTER TABLE `homigo-497619.homigo_analytics.fact_bookings`
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

-- Ensure 01_schema columns exist on legacy deployments
ALTER TABLE `homigo-497619.homigo_analytics.fact_bookings`
  ADD COLUMN IF NOT EXISTS actual_duration_min FLOAT64;

ALTER TABLE `homigo-497619.homigo_analytics.fact_bookings`
  ADD COLUMN IF NOT EXISTS weather_temp_c FLOAT64;

ALTER TABLE `homigo-497619.homigo_analytics.fact_bookings`
  ADD COLUMN IF NOT EXISTS weather_surge FLOAT64;
