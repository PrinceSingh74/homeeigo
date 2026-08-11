-- Phase 5 — give the human approver something to actually review.
--
-- The row stored only `arguments_hash`. That is the right *binding* — it makes an approval
-- unusable for different arguments — but it is unreadable, so an approver was being asked
-- to authorise "a refund" without seeing which booking or how much. An approval nobody can
-- assess is a rubber stamp.
--
-- `arguments_preview` holds a REDACTED copy for display only. The hash remains the sole
-- authorisation binding; nothing reads the preview when deciding whether an approval is
-- valid, so tampering with it cannot widen an approval.
--
-- Additive and nullable: approvals created before this column read as "no preview".
ALTER TABLE "ai_tool_approvals" ADD COLUMN IF NOT EXISTS "arguments_preview" JSONB;
ALTER TABLE "ai_tool_approvals" ADD COLUMN IF NOT EXISTS "resource_ref" TEXT;
