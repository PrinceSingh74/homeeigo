-- Phase 14 — governance, experimentation & production hardening.
--
-- Additive only. No existing column is altered or dropped, so this cannot disturb the
-- slot-exclusion columns that a `prisma db push` would have removed.

-- ── AI spend governance ──────────────────────────────────────────────────────
CREATE TYPE "ai_budget_scope"     AS ENUM ('GLOBAL', 'PROVIDER', 'ROLE', 'ENDPOINT');
CREATE TYPE "ai_budget_period"    AS ENUM ('DAY', 'MONTH');
CREATE TYPE "ai_budget_fail_mode" AS ENUM ('FAIL_OPEN', 'FAIL_CLOSED');

CREATE TABLE "ai_budget_policies" (
  "id"         TEXT NOT NULL,
  "scope"      "ai_budget_scope" NOT NULL,
  "scope_key"  TEXT NOT NULL,
  "period"     "ai_budget_period" NOT NULL,
  "limit_usd"  DOUBLE PRECISION NOT NULL,
  "fail_mode"  "ai_budget_fail_mode" NOT NULL DEFAULT 'FAIL_CLOSED',
  "is_active"  BOOLEAN NOT NULL DEFAULT true,
  "note"       TEXT,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_budget_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_budget_policies_scope_scope_key_period_key"
  ON "ai_budget_policies" ("scope", "scope_key", "period");
CREATE INDEX "ai_budget_policies_is_active_idx" ON "ai_budget_policies" ("is_active");

CREATE TABLE "ai_budget_windows" (
  "id"                    TEXT NOT NULL,
  "policy_id"             TEXT NOT NULL,
  "window_key"            TEXT NOT NULL,
  "reserved_usd"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  "settled_usd"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  "request_count"         INTEGER NOT NULL DEFAULT 0,
  "unknown_cost_requests" INTEGER NOT NULL DEFAULT 0,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_budget_windows_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_budget_windows_policy_id_window_key_key"
  ON "ai_budget_windows" ("policy_id", "window_key");
CREATE INDEX "ai_budget_windows_window_key_idx" ON "ai_budget_windows" ("window_key");
ALTER TABLE "ai_budget_windows"
  ADD CONSTRAINT "ai_budget_windows_policy_id_fkey"
  FOREIGN KEY ("policy_id") REFERENCES "ai_budget_policies" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Reserved and settled spend are accumulators, never negative. A settle that over-releases a
-- reservation is a bug, and it should surface here rather than as a quietly negative budget
-- that grants unlimited headroom.
ALTER TABLE "ai_budget_windows"
  ADD CONSTRAINT "ai_budget_windows_reserved_nonneg" CHECK ("reserved_usd" >= 0),
  ADD CONSTRAINT "ai_budget_windows_settled_nonneg"  CHECK ("settled_usd"  >= 0);

-- ── Policy decision versioning ───────────────────────────────────────────────
-- Nullable with no backfill: rows written before this genuinely have no version, and stamping
-- them with the current one would assert something untrue about the past.
ALTER TABLE "ai_tool_policy_logs" ADD COLUMN "policy_version" TEXT;
