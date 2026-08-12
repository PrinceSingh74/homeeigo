-- Hyperlocal Coverage Engine V1 — additive demand-capture table.
-- Standalone table (no FKs) so existing schema is untouched.

-- CreateEnum
CREATE TYPE "CoverageRequestStatus" AS ENUM ('NEW', 'REVIEWING', 'PLANNED', 'LAUNCHED', 'DECLINED');

-- CreateTable
CREATE TABLE "coverage_requests" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "city" TEXT,
    "area" TEXT NOT NULL,
    "society" TEXT,
    "pincode" TEXT,
    "source" TEXT NOT NULL DEFAULT 'web_coverage_explorer',
    "status" "CoverageRequestStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coverage_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coverage_requests_status_created_at_idx" ON "coverage_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "coverage_requests_city_idx" ON "coverage_requests"("city");

-- CreateIndex
CREATE INDEX "coverage_requests_pincode_idx" ON "coverage_requests"("pincode");
