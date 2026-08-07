-- Phase 4: Enterprise AI Brain — Context, Memory, Prompt Intelligence

CREATE TYPE "AiMemoryType" AS ENUM (
  'SESSION', 'CONVERSATION', 'BUSINESS', 'USER', 'PARTNER',
  'ADMIN', 'OPERATIONAL', 'SEMANTIC', 'WORKING', 'HISTORICAL'
);

CREATE TYPE "AiPromptApprovalStatus" AS ENUM (
  'DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'DEPRECATED'
);

CREATE TYPE "AiPromptSafetyLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- Extend ai_conversations for conversation memory
ALTER TABLE "ai_conversations" ADD COLUMN IF NOT EXISTS "summary" TEXT;
ALTER TABLE "ai_conversations" ADD COLUMN IF NOT EXISTS "topics" JSONB;
ALTER TABLE "ai_conversations" ADD COLUMN IF NOT EXISTS "pinned_facts" JSONB;
ALTER TABLE "ai_conversations" ADD COLUMN IF NOT EXISTS "entities" JSONB;
ALTER TABLE "ai_conversations" ADD COLUMN IF NOT EXISTS "intent_history" JSONB;
ALTER TABLE "ai_conversations" ADD COLUMN IF NOT EXISTS "sentiment" TEXT;
ALTER TABLE "ai_conversations" ADD COLUMN IF NOT EXISTS "resolution" TEXT;
ALTER TABLE "ai_conversations" ADD COLUMN IF NOT EXISTS "compressed_at" TIMESTAMP(3);
ALTER TABLE "ai_conversations" ADD COLUMN IF NOT EXISTS "token_budget" INTEGER;

-- Extend ai_messages for entity/intent tracking
ALTER TABLE "ai_messages" ADD COLUMN IF NOT EXISTS "tokens" INTEGER;
ALTER TABLE "ai_messages" ADD COLUMN IF NOT EXISTS "intent" TEXT;
ALTER TABLE "ai_messages" ADD COLUMN IF NOT EXISTS "entities" JSONB;
ALTER TABLE "ai_messages" ADD COLUMN IF NOT EXISTS "sentiment" TEXT;

CREATE TABLE "ai_memory" (
    "id" TEXT NOT NULL,
    "memory_key" TEXT NOT NULL,
    "memory_type" "AiMemoryType" NOT NULL,
    "owner_id" TEXT,
    "tenant_id" TEXT,
    "content" JSONB NOT NULL,
    "summary" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "freshness" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ttl_seconds" INTEGER,
    "expires_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_memory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_prompt_registry" (
    "id" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "description" TEXT,
    "approval_status" "AiPromptApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_prompt_registry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_prompt_versions" (
    "id" TEXT NOT NULL,
    "registry_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "user_template" TEXT,
    "variables" JSONB,
    "inputs" JSONB,
    "outputs" JSONB,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "max_tokens" INTEGER NOT NULL DEFAULT 2048,
    "safety_level" "AiPromptSafetyLevel" NOT NULL DEFAULT 'MEDIUM',
    "fallback_prompt_id" TEXT,
    "diff_from_previous" TEXT,
    "experiment_tag" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "is_deprecated" BOOLEAN NOT NULL DEFAULT false,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_prompt_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_context_snapshots" (
    "id" TEXT NOT NULL,
    "request_id" TEXT,
    "actor_id" TEXT,
    "actor_role" "AiGatewayRole" NOT NULL,
    "context_hash" TEXT NOT NULL,
    "context_size" INTEGER NOT NULL,
    "sections" JSONB NOT NULL,
    "built_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "ai_context_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_activity_timeline" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_role" "AiGatewayRole" NOT NULL,
    "prompt_id" TEXT,
    "prompt_version" INTEGER,
    "model" TEXT,
    "provider" "AiProviderType",
    "context_hash" TEXT,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "AiRequestStatus" NOT NULL,
    "fallback_used" BOOLEAN NOT NULL DEFAULT false,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "block_reason" TEXT,
    "result_hash" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_activity_timeline_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_context_cache" (
    "id" TEXT NOT NULL,
    "cache_key" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_role" "AiGatewayRole" NOT NULL,
    "context_hash" TEXT NOT NULL,
    "context_data" JSONB NOT NULL,
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_context_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_memory_memory_key_owner_id_memory_type_key" ON "ai_memory"("memory_key", "owner_id", "memory_type");
CREATE INDEX "ai_memory_owner_id_memory_type_idx" ON "ai_memory"("owner_id", "memory_type");
CREATE INDEX "ai_memory_expires_at_idx" ON "ai_memory"("expires_at");
CREATE INDEX "ai_memory_memory_type_is_archived_idx" ON "ai_memory"("memory_type", "is_archived");

CREATE UNIQUE INDEX "ai_prompt_registry_prompt_id_key" ON "ai_prompt_registry"("prompt_id");
CREATE INDEX "ai_prompt_registry_category_idx" ON "ai_prompt_registry"("category");
CREATE INDEX "ai_prompt_registry_approval_status_idx" ON "ai_prompt_registry"("approval_status");

CREATE UNIQUE INDEX "ai_prompt_versions_registry_id_version_key" ON "ai_prompt_versions"("registry_id", "version");
CREATE INDEX "ai_prompt_versions_registry_id_is_active_idx" ON "ai_prompt_versions"("registry_id", "is_active");

CREATE INDEX "ai_context_snapshots_actor_id_built_at_idx" ON "ai_context_snapshots"("actor_id", "built_at");
CREATE INDEX "ai_context_snapshots_request_id_idx" ON "ai_context_snapshots"("request_id");

CREATE INDEX "ai_activity_timeline_actor_id_created_at_idx" ON "ai_activity_timeline"("actor_id", "created_at");
CREATE INDEX "ai_activity_timeline_request_id_idx" ON "ai_activity_timeline"("request_id");
CREATE INDEX "ai_activity_timeline_status_created_at_idx" ON "ai_activity_timeline"("status", "created_at");

CREATE UNIQUE INDEX "ai_context_cache_cache_key_key" ON "ai_context_cache"("cache_key");
CREATE INDEX "ai_context_cache_actor_id_actor_role_idx" ON "ai_context_cache"("actor_id", "actor_role");
CREATE INDEX "ai_context_cache_expires_at_idx" ON "ai_context_cache"("expires_at");

ALTER TABLE "ai_prompt_versions" ADD CONSTRAINT "ai_prompt_versions_registry_id_fkey"
    FOREIGN KEY ("registry_id") REFERENCES "ai_prompt_registry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
