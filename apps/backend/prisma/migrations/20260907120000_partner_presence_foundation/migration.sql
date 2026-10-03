-- Phase 1 — Partner presence evidence subsystem (liveness; not a fifth FSM).
CREATE TABLE IF NOT EXISTS "partner_presence" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "active_session_id" TEXT,
    "active_device_id" TEXT,
    "last_heartbeat_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "last_location_at" TIMESTAMP(3),
    "last_location_lat" DOUBLE PRECISION,
    "last_location_lng" DOUBLE PRECISION,
    "last_location_accuracy" DOUBLE PRECISION,
    "last_location_source" TEXT,
    "last_location_seq" INTEGER,
    "app_state" TEXT,
    "platform" TEXT,
    "app_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_presence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "partner_presence_provider_id_key" ON "partner_presence"("provider_id");
CREATE INDEX IF NOT EXISTS "partner_presence_last_heartbeat_at_idx" ON "partner_presence"("last_heartbeat_at");
CREATE INDEX IF NOT EXISTS "partner_presence_active_session_id_idx" ON "partner_presence"("active_session_id");

ALTER TABLE "partner_presence" DROP CONSTRAINT IF EXISTS "partner_presence_provider_id_fkey";
ALTER TABLE "partner_presence" ADD CONSTRAINT "partner_presence_provider_id_fkey"
    FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
