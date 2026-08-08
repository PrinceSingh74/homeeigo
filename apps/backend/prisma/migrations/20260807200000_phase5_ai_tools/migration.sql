-- Phase 5: Enterprise AI Tools — Registry, Policy, Approval, Execution

CREATE TYPE "AiToolCategory" AS ENUM ('READ', 'WRITE', 'HIGH_RISK');
CREATE TYPE "AiToolRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "AiToolStatus" AS ENUM ('ACTIVE', 'DEPRECATED', 'DISABLED');
CREATE TYPE "AiToolPolicyDecision" AS ENUM ('ALLOW', 'DENY', 'REQUIRES_APPROVAL');
CREATE TYPE "AiToolExecutionStatus" AS ENUM (
  'PENDING', 'PENDING_APPROVAL', 'RUNNING', 'SUCCESS', 'FAILED', 'DENIED', 'TIMEOUT', 'CANCELLED'
);
CREATE TYPE "AiToolApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "AiToolApprovalMode" AS ENUM ('SINGLE', 'SEQUENTIAL', 'PARALLEL');

CREATE TABLE "ai_tool_registry" (
    "id" TEXT NOT NULL,
    "tool_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "AiToolCategory" NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "required_permission" TEXT NOT NULL,
    "required_role" TEXT NOT NULL,
    "required_policy" TEXT NOT NULL,
    "risk_level" "AiToolRiskLevel" NOT NULL,
    "parameters" JSONB NOT NULL,
    "validation_schema" JSONB NOT NULL,
    "timeout_ms" INTEGER NOT NULL DEFAULT 30000,
    "max_retries" INTEGER NOT NULL DEFAULT 2,
    "audit_required" BOOLEAN NOT NULL DEFAULT true,
    "approval_required" BOOLEAN NOT NULL DEFAULT false,
    "service_mapping" TEXT NOT NULL,
    "event_mapping" TEXT,
    "metrics_key" TEXT,
    "cost_estimate_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "owner" TEXT NOT NULL,
    "status" "AiToolStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_tool_registry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_tool_approvals" (
    "id" TEXT NOT NULL,
    "approval_id" TEXT NOT NULL,
    "tool_id" TEXT NOT NULL,
    "execution_id" TEXT,
    "requested_by" TEXT NOT NULL,
    "requested_role" "AiGatewayRole" NOT NULL,
    "arguments_hash" TEXT NOT NULL,
    "risk_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "AiToolApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "approval_mode" "AiToolApprovalMode" NOT NULL DEFAULT 'SINGLE',
    "required_approvers" INTEGER NOT NULL DEFAULT 1,
    "approved_by" TEXT,
    "rejected_by" TEXT,
    "decision_reason" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "decided_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_tool_approvals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_tool_executions" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "tool_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_role" "AiGatewayRole" NOT NULL,
    "arguments_hash" TEXT NOT NULL,
    "policy_decision" "AiToolPolicyDecision" NOT NULL,
    "status" "AiToolExecutionStatus" NOT NULL,
    "result_hash" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "correlation_id" TEXT,
    "trace_id" TEXT,
    "idempotency_key" TEXT,
    "approval_id" TEXT,
    "ip_address" TEXT,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "ai_tool_executions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_tool_policy_logs" (
    "id" TEXT NOT NULL,
    "tool_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_role" "AiGatewayRole" NOT NULL,
    "decision" "AiToolPolicyDecision" NOT NULL,
    "reason" TEXT,
    "rule_matched" TEXT,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_tool_policy_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_tool_registry_tool_id_key" ON "ai_tool_registry"("tool_id");
CREATE INDEX "ai_tool_registry_category_status_idx" ON "ai_tool_registry"("category", "status");
CREATE INDEX "ai_tool_registry_risk_level_idx" ON "ai_tool_registry"("risk_level");

CREATE UNIQUE INDEX "ai_tool_approvals_approval_id_key" ON "ai_tool_approvals"("approval_id");
CREATE INDEX "ai_tool_approvals_status_expires_at_idx" ON "ai_tool_approvals"("status", "expires_at");
CREATE INDEX "ai_tool_approvals_tool_id_status_idx" ON "ai_tool_approvals"("tool_id", "status");

CREATE UNIQUE INDEX "ai_tool_executions_execution_id_key" ON "ai_tool_executions"("execution_id");
CREATE UNIQUE INDEX "ai_tool_executions_idempotency_key_key" ON "ai_tool_executions"("idempotency_key");
CREATE INDEX "ai_tool_executions_tool_id_started_at_idx" ON "ai_tool_executions"("tool_id", "started_at");
CREATE INDEX "ai_tool_executions_actor_id_started_at_idx" ON "ai_tool_executions"("actor_id", "started_at");
CREATE INDEX "ai_tool_executions_status_started_at_idx" ON "ai_tool_executions"("status", "started_at");
CREATE INDEX "ai_tool_executions_trace_id_idx" ON "ai_tool_executions"("trace_id");

CREATE INDEX "ai_tool_policy_logs_tool_id_created_at_idx" ON "ai_tool_policy_logs"("tool_id", "created_at");
CREATE INDEX "ai_tool_policy_logs_decision_created_at_idx" ON "ai_tool_policy_logs"("decision", "created_at");

ALTER TABLE "ai_tool_approvals" ADD CONSTRAINT "ai_tool_approvals_tool_id_fkey"
    FOREIGN KEY ("tool_id") REFERENCES "ai_tool_registry"("tool_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_tool_executions" ADD CONSTRAINT "ai_tool_executions_tool_id_fkey"
    FOREIGN KEY ("tool_id") REFERENCES "ai_tool_registry"("tool_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_tool_executions" ADD CONSTRAINT "ai_tool_executions_approval_id_fkey"
    FOREIGN KEY ("approval_id") REFERENCES "ai_tool_approvals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
