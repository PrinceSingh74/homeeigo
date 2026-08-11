-- Phase 5 (P5-D6) — a confirmation tier distinct from human approval.
--
-- The model previously had only ALLOW / DENY / REQUIRES_APPROVAL, so a booking either ran
-- unannounced or waited on a second human. Neither expresses "the user must see the price
-- and agree first". Business-hours blocking was standing in for consent, which it is not.
--
-- Additive: a new enum value. Existing policy-log rows keep their decisions.
ALTER TYPE "AiToolPolicyDecision" ADD VALUE IF NOT EXISTS 'REQUIRES_CONFIRMATION';
