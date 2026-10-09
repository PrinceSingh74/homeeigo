-- Phase 15.1 — product-funnel analytics events.
--
-- Distinct from event_outbox (authoritative domain events) and from Prometheus counters
-- (service_view_total etc.). Those stay. This table stores attributable funnel events with
-- enough context to answer who / what / when / which service / version / variant / booking /
-- population / environment, without becoming a source of booking, payment, rating, or revenue
-- truth.
--
-- Additive only. No existing row is read or rewritten. event_id is unique so a retried delivery
-- cannot double-count. data_origin is nullable with no default (UNKNOWN = business, same policy
-- as users/bookings; see src/lib/analytics-scope.ts). The client never writes this column.

DO $$ BEGIN
  CREATE TYPE "AnalyticsEventName" AS ENUM (
    'SERVICE_VIEW',
    'SERVICE_CLICK',
    'VARIANT_SELECTED',
    'OPTION_SELECTED',
    'ADDON_SELECTED',
    'QUOTE_GENERATED',
    'BOOKING_STARTED',
    'CHECKOUT_STARTED',
    'BOOKING_CREATED',
    'BOOKING_COMPLETED',
    'CANCELLED',
    'REPEAT_BOOKING'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AnalyticsEventSource" AS ENUM (
    'CUSTOMER_WEB',
    'CUSTOMER_MOBILE',
    'PARTNER_WEB',
    'PARTNER_MOBILE',
    'ADMIN',
    'BACKEND'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AnalyticsEventPlatform" AS ENUM (
    'WEB',
    'ANDROID',
    'IOS',
    'SERVER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "analytics_events" (
  "id"                  TEXT NOT NULL,
  "event_id"            TEXT NOT NULL,
  "event_name"          "AnalyticsEventName" NOT NULL,
  "occurred_at"         TIMESTAMPTZ(6) NOT NULL,
  "received_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actor_user_id"       TEXT,
  "session_id"          TEXT,
  "service_id"          TEXT,
  "service_version_id"  INTEGER,
  "variant_id"          TEXT,
  "option_id"           TEXT,
  "addon_id"            TEXT,
  "booking_id"          TEXT,
  "quote_fingerprint"   TEXT,
  "source"              "AnalyticsEventSource" NOT NULL,
  "platform"            "AnalyticsEventPlatform" NOT NULL,
  "environment"         TEXT NOT NULL,
  "data_origin"         "DataOrigin",
  "metadata"            JSONB,
  CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "analytics_events_event_id_key"
  ON "analytics_events" ("event_id");

CREATE INDEX IF NOT EXISTS "analytics_events_name_occurred_idx"
  ON "analytics_events" ("event_name", "occurred_at");

CREATE INDEX IF NOT EXISTS "analytics_events_service_name_occurred_idx"
  ON "analytics_events" ("service_id", "event_name", "occurred_at");

CREATE INDEX IF NOT EXISTS "analytics_events_booking_idx"
  ON "analytics_events" ("booking_id");

CREATE INDEX IF NOT EXISTS "analytics_events_actor_occurred_idx"
  ON "analytics_events" ("actor_user_id", "occurred_at");

CREATE INDEX IF NOT EXISTS "analytics_events_data_origin_idx"
  ON "analytics_events" ("data_origin");

CREATE INDEX IF NOT EXISTS "analytics_events_session_occurred_idx"
  ON "analytics_events" ("session_id", "occurred_at");

DO $$ BEGIN
  ALTER TABLE "analytics_events"
    ADD CONSTRAINT "analytics_events_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "analytics_events"
    ADD CONSTRAINT "analytics_events_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "analytics_events"
    ADD CONSTRAINT "analytics_events_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE "analytics_events" IS
  'Product-funnel measurement. Not a source of booking, payment, rating, or revenue truth. data_origin is stamped at write from the actor or booking; the client cannot set it.';
COMMENT ON COLUMN "analytics_events"."event_id" IS
  'Producer-supplied unique key. A second delivery of the same key is a no-op.';
COMMENT ON COLUMN "analytics_events"."data_origin" IS
  'Provenance. NULL = UNKNOWN. Stamped from the actor or related booking. Business analytics default to (data_origin IS NULL OR data_origin = ''REAL'').';
