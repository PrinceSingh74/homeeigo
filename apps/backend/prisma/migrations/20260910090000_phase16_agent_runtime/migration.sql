-- CreateEnum
CREATE TYPE "AgentRunMode" AS ENUM ('SHADOW', 'LIVE');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('CREATED', 'PLANNING', 'WAITING_POLICY', 'WAITING_APPROVAL', 'EXECUTING', 'VERIFYING', 'COMPLETED', 'FAILED', 'ESCALATED', 'CANCELLED', 'TIMED_OUT', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "AgentRiskTier" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AgentStepStatus" AS ENUM ('PLANNED', 'POLICY_DENIED', 'AWAITING_APPROVAL', 'EXECUTED', 'VERIFIED', 'VERIFICATION_FAILED', 'FAILED', 'SKIPPED', 'SHADOWED', 'INDETERMINATE');


-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "agent_version" TEXT NOT NULL,
    "prompt_version" TEXT,
    "policy_version" TEXT,
    "toolset_version" TEXT,
    "model_provider" TEXT,
    "model_name" TEXT,
    "mode" "AgentRunMode" NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'CREATED',
    "risk_tier" "AgentRiskTier",
    "actor_id" TEXT,
    "actor_role" "AiGatewayRole" NOT NULL,
    "trigger_type" TEXT NOT NULL,
    "trigger_ref" TEXT,
    "subject_type" TEXT,
    "subject_id" TEXT,
    "trace_id" TEXT NOT NULL,
    "causation_id" TEXT,
    "parent_run_id" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "goal" TEXT NOT NULL,
    "plan_hash" TEXT,
    "plan" JSONB,
    "step_count" INTEGER NOT NULL DEFAULT 0,
    "tool_call_count" INTEGER NOT NULL DEFAULT 0,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latency_ms" INTEGER,
    "stop_reason" TEXT,
    "escalation_reason" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "idempotency_key" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "heartbeat_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run_steps" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "step_index" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "capability" TEXT,
    "tool_id" TEXT,
    "arguments_hash" TEXT,
    "arguments_preview" JSONB,
    "risk_tier" "AgentRiskTier",
    "policy_decision" "AiToolPolicyDecision",
    "status" "AgentStepStatus" NOT NULL,
    "execution_id" TEXT,
    "approval_id" TEXT,
    "verification" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_run_id_key" ON "agent_runs"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_idempotency_key_key" ON "agent_runs"("idempotency_key");

-- CreateIndex
CREATE INDEX "agent_runs_agent_id_created_at_idx" ON "agent_runs"("agent_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_runs_status_created_at_idx" ON "agent_runs"("status", "created_at");

-- CreateIndex
CREATE INDEX "agent_runs_trace_id_idx" ON "agent_runs"("trace_id");

-- CreateIndex
CREATE INDEX "agent_runs_causation_id_idx" ON "agent_runs"("causation_id");

-- CreateIndex
CREATE INDEX "agent_runs_subject_type_subject_id_idx" ON "agent_runs"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "agent_run_steps_tool_id_created_at_idx" ON "agent_run_steps"("tool_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_run_steps_execution_id_idx" ON "agent_run_steps"("execution_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_run_steps_run_id_step_index_key" ON "agent_run_steps"("run_id", "step_index");


-- AddForeignKey
ALTER TABLE "agent_run_steps" ADD CONSTRAINT "agent_run_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("run_id") ON DELETE CASCADE ON UPDATE CASCADE;
