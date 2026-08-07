-- Phase 2 — ETA Intelligence Data Collection Platform
CREATE TYPE "EtaLabelStatus" AS ENUM ('RAW', 'VALIDATED', 'REJECTED', 'TRAINING_READY');

CREATE TABLE "eta_training_labels" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "partner_hash" TEXT NOT NULL,
    "customer_hash" TEXT NOT NULL,
    "city" TEXT,
    "zone" TEXT,
    "cluster" TEXT,
    "service_category" TEXT,
    "vehicle_type" TEXT,
    "booking_priority" TEXT,
    "dispatch_timestamp" TIMESTAMP(3),
    "accepted_timestamp" TIMESTAMP(3),
    "partner_depart_timestamp" TIMESTAMP(3),
    "en_route_timestamp" TIMESTAMP(3),
    "arrival_timestamp" TIMESTAMP(3),
    "booking_start_timestamp" TIMESTAMP(3),
    "booking_complete_timestamp" TIMESTAMP(3),
    "pickup_latitude" DOUBLE PRECISION,
    "pickup_longitude" DOUBLE PRECISION,
    "partner_lat_dispatch" DOUBLE PRECISION,
    "partner_lng_dispatch" DOUBLE PRECISION,
    "partner_lat_arrival" DOUBLE PRECISION,
    "partner_lng_arrival" DOUBLE PRECISION,
    "travel_distance_meters" DOUBLE PRECISION,
    "actual_travel_duration_sec" INTEGER,
    "actual_travel_duration_min" DOUBLE PRECISION,
    "google_eta_seconds" INTEGER,
    "google_eta_minutes" DOUBLE PRECISION,
    "google_distance_meters" DOUBLE PRECISION,
    "traffic_model" TEXT,
    "traffic_level" TEXT,
    "road_speed" DOUBLE PRECISION,
    "weekday" INTEGER,
    "month" INTEGER,
    "hour" INTEGER,
    "minute" INTEGER,
    "is_weekend" BOOLEAN NOT NULL DEFAULT false,
    "holiday_flag" BOOLEAN NOT NULL DEFAULT false,
    "rain" DOUBLE PRECISION,
    "temperature" DOUBLE PRECISION,
    "humidity" DOUBLE PRECISION,
    "wind" DOUBLE PRECISION,
    "weather_condition" TEXT,
    "partner_rating" DOUBLE PRECISION,
    "partner_experience" INTEGER,
    "partner_acceptance_rate" DOUBLE PRECISION,
    "partner_cancellation_rate" DOUBLE PRECISION,
    "partner_today_trips" INTEGER,
    "partner_today_hours" DOUBLE PRECISION,
    "partner_current_load" INTEGER,
    "partner_battery" DOUBLE PRECISION,
    "partner_network_quality" TEXT,
    "device_os" TEXT,
    "device_model" TEXT,
    "gps_accuracy" DOUBLE PRECISION,
    "location_sampling_rate" DOUBLE PRECISION,
    "booking_source" TEXT,
    "campaign" TEXT,
    "surge_multiplier" DOUBLE PRECISION,
    "special_instructions" TEXT,
    "bearing" DOUBLE PRECISION,
    "route_efficiency" DOUBLE PRECISION,
    "average_speed" DOUBLE PRECISION,
    "peak_hour" BOOLEAN NOT NULL DEFAULT false,
    "night_flag" BOOLEAN NOT NULL DEFAULT false,
    "rush_hour" BOOLEAN NOT NULL DEFAULT false,
    "distance_bucket" TEXT,
    "trip_bucket" TEXT,
    "partner_familiarity" DOUBLE PRECISION,
    "historical_route_count" INTEGER,
    "historical_avg_duration" DOUBLE PRECISION,
    "historical_avg_delay" DOUBLE PRECISION,
    "weather_bucket" TEXT,
    "quality_score" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "status" "EtaLabelStatus" NOT NULL DEFAULT 'RAW',
    "rejection_reason" TEXT,
    "event_id" TEXT,
    "features" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eta_training_labels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "eta_training_labels_booking_id_key" ON "eta_training_labels"("booking_id");
CREATE INDEX "eta_training_labels_status_created_at_idx" ON "eta_training_labels"("status", "created_at");
CREATE INDEX "eta_training_labels_city_created_at_idx" ON "eta_training_labels"("city", "created_at");
CREATE INDEX "eta_training_labels_partner_hash_idx" ON "eta_training_labels"("partner_hash");

CREATE TABLE "eta_google_snapshots" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "request_timestamp" TIMESTAMP(3) NOT NULL,
    "response_timestamp" TIMESTAMP(3) NOT NULL,
    "api_latency_ms" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "eta_seconds" INTEGER,
    "distance_meters" DOUBLE PRECISION,
    "traffic_model" TEXT,
    "polyline_hash" TEXT,
    "road_class" TEXT,
    "source" TEXT NOT NULL DEFAULT 'google',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eta_google_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "eta_google_snapshots_booking_id_created_at_idx" ON "eta_google_snapshots"("booking_id", "created_at");

CREATE TABLE "eta_gps_tracks" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "partner_hash" TEXT NOT NULL,
    "ping_count" INTEGER NOT NULL DEFAULT 0,
    "compressed_path" BYTEA NOT NULL,
    "first_timestamp" TIMESTAMP(3) NOT NULL,
    "last_timestamp" TIMESTAMP(3) NOT NULL,
    "avg_accuracy" DOUBLE PRECISION,
    "avg_sampling_hz" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eta_gps_tracks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "eta_gps_tracks_booking_id_key" ON "eta_gps_tracks"("booking_id");
CREATE INDEX "eta_gps_tracks_partner_hash_idx" ON "eta_gps_tracks"("partner_hash");
