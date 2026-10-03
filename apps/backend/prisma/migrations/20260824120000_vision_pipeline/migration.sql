-- Vision AI: the record of an image submitted for analysis, and what a provider said about it.
--
-- Two tables rather than one because they have different lifetimes. The bytes are deleted when
-- retention says so; the account of what was asked and answered outlives them, so an analysis can
-- still be explained after its source image is gone.

CREATE TYPE "VisionImagePurpose" AS ENUM ('ISSUE_REPORT', 'SERVICE_CONTEXT', 'SUPPORT_ATTACHMENT');
CREATE TYPE "VisionImageStatus" AS ENUM ('PENDING', 'ANALYZED', 'FAILED', 'PURGED');
CREATE TYPE "VisionObservationMode" AS ENUM ('REAL_PROVIDER', 'FALLBACK');

CREATE TABLE "vision_images" (
    "id"              TEXT NOT NULL,
    "owner_id"        TEXT NOT NULL,
    "purpose"         "VisionImagePurpose" NOT NULL,
    "storage_key"     TEXT NOT NULL,
    "mime_type"       TEXT NOT NULL,
    "byte_size"       INTEGER NOT NULL,
    "content_hash"    TEXT NOT NULL,
    "status"          "VisionImageStatus" NOT NULL DEFAULT 'PENDING',
    "retention_until" TIMESTAMP(3) NOT NULL,
    "purged_at"       TIMESTAMP(3),
    "booking_id"      TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "vision_images_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vision_images_owner_id_created_at_idx" ON "vision_images"("owner_id", "created_at");
-- The retention sweep reads exactly this predicate: not yet purged, and past its date.
CREATE INDEX "vision_images_status_retention_until_idx" ON "vision_images"("status", "retention_until");

ALTER TABLE "vision_images" ADD CONSTRAINT "vision_images_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An image with no size is not an image, and a retention date before the upload can never expire
-- correctly.
ALTER TABLE "vision_images" ADD CONSTRAINT "vision_images_positive_size" CHECK ("byte_size" > 0);

CREATE TABLE "vision_analyses" (
    "id"                     TEXT NOT NULL,
    "image_id"               TEXT NOT NULL,
    "observation_mode"       "VisionObservationMode" NOT NULL,
    "provider"               TEXT NOT NULL,
    "model"                  TEXT NOT NULL,
    "observed_category"      TEXT,
    "observations"           TEXT[],
    "confidence"             DOUBLE PRECISION NOT NULL,
    "recommended_service_id" TEXT,
    "safety_flags"           TEXT[],
    "advisory"               BOOLEAN NOT NULL DEFAULT true,
    "latency_ms"             INTEGER NOT NULL,
    "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vision_analyses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vision_analyses_image_id_created_at_idx" ON "vision_analyses"("image_id", "created_at");
-- Separating real observations from fallback ones is a query the reporting must be able to make
-- cheaply, because conflating them is the failure this column exists to prevent.
CREATE INDEX "vision_analyses_observation_mode_created_at_idx" ON "vision_analyses"("observation_mode", "created_at");

ALTER TABLE "vision_analyses" ADD CONSTRAINT "vision_analyses_image_id_fkey"
  FOREIGN KEY ("image_id") REFERENCES "vision_images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A confidence outside 0..1 is not a confidence.
ALTER TABLE "vision_analyses" ADD CONSTRAINT "vision_analyses_confidence_range"
  CHECK ("confidence" >= 0 AND "confidence" <= 1);

-- Vision output is advisory by construction. A row claiming otherwise would be a capability nobody
-- granted, so the database refuses to hold one.
ALTER TABLE "vision_analyses" ADD CONSTRAINT "vision_analyses_advisory_only" CHECK ("advisory" = true);
