-- Phase 3: Enterprise AI Core Platform

CREATE TYPE "AiGatewayRole" AS ENUM ('CUSTOMER', 'PARTNER', 'ADMIN', 'SUPPORT', 'SYSTEM', 'AUTOMATION');
CREATE TYPE "AiProviderType" AS ENUM ('GEMINI', 'OPENAI');
CREATE TYPE "AiRequestStatus" AS ENUM ('SUCCESS', 'FAILED', 'BLOCKED', 'TIMEOUT', 'FALLBACK');

CREATE TABLE "ai_gateway_requests" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_role" "AiGatewayRole" NOT NULL,
    "template_id" TEXT,
    "prompt_hash" TEXT NOT NULL,
    "response_hash" TEXT,
    "provider" "AiProviderType",
    "status" "AiRequestStatus" NOT NULL DEFAULT 'SUCCESS',
    "latency_ms" INTEGER,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "cached_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fallback_used" BOOLEAN NOT NULL DEFAULT false,
    "error_code" TEXT,
    "ip_address" TEXT,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_gateway_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_gateway_usage" (
    "id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "granularity" TEXT NOT NULL DEFAULT 'hourly',
    "actor_role" "AiGatewayRole" NOT NULL,
    "provider" "AiProviderType" NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "fallback_count" INTEGER NOT NULL DEFAULT 0,
    "blocked_count" INTEGER NOT NULL DEFAULT 0,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avg_latency_ms" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_gateway_usage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_gateway_audit" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_role" "AiGatewayRole" NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "prompt_hash" TEXT NOT NULL,
    "response_hash" TEXT,
    "provider" "AiProviderType",
    "latency_ms" INTEGER,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "AiRequestStatus" NOT NULL,
    "ip_address" TEXT,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_gateway_audit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_gateway_cost" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "provider" "AiProviderType" NOT NULL,
    "actor_role" "AiGatewayRole" NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_gateway_cost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_prompt_templates" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "actor_role" "AiGatewayRole" NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "user_template" TEXT,
    "max_tokens" INTEGER NOT NULL DEFAULT 2048,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_prompt_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_gateway_requests_request_id_key" ON "ai_gateway_requests"("request_id");
CREATE INDEX "ai_gateway_requests_actor_id_created_at_idx" ON "ai_gateway_requests"("actor_id", "created_at");
CREATE INDEX "ai_gateway_requests_actor_role_created_at_idx" ON "ai_gateway_requests"("actor_role", "created_at");
CREATE INDEX "ai_gateway_requests_status_created_at_idx" ON "ai_gateway_requests"("status", "created_at");
CREATE INDEX "ai_gateway_requests_provider_created_at_idx" ON "ai_gateway_requests"("provider", "created_at");

CREATE UNIQUE INDEX "ai_gateway_usage_period_start_granularity_actor_role_provid_key" ON "ai_gateway_usage"("period_start", "granularity", "actor_role", "provider");
CREATE INDEX "ai_gateway_usage_period_start_actor_role_idx" ON "ai_gateway_usage"("period_start", "actor_role");

CREATE INDEX "ai_gateway_audit_request_id_idx" ON "ai_gateway_audit"("request_id");
CREATE INDEX "ai_gateway_audit_actor_id_created_at_idx" ON "ai_gateway_audit"("actor_id", "created_at");
CREATE INDEX "ai_gateway_audit_status_created_at_idx" ON "ai_gateway_audit"("status", "created_at");

CREATE UNIQUE INDEX "ai_gateway_cost_date_provider_actor_role_key" ON "ai_gateway_cost"("date", "provider", "actor_role");
CREATE INDEX "ai_gateway_cost_date_provider_idx" ON "ai_gateway_cost"("date", "provider");

CREATE UNIQUE INDEX "ai_prompt_templates_template_id_key" ON "ai_prompt_templates"("template_id");
CREATE INDEX "ai_prompt_templates_category_is_active_idx" ON "ai_prompt_templates"("category", "is_active");
CREATE INDEX "ai_prompt_templates_actor_role_is_active_idx" ON "ai_prompt_templates"("actor_role", "is_active");
