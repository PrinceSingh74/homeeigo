-- Section 01 — partner acquisition automation LIVE certification (idempotent seed).
-- Runtime bootstrap also certifies; this migration ensures fresh deploys pass the LIVE gate
-- before the first maintenance tick completes.

INSERT INTO "automation_certifications" (
  "id",
  "automation_id",
  "workflow_version",
  "certified_by",
  "approval_reference",
  "shadow_evidence_reference",
  "test_evidence_reference",
  "risk_class",
  "known_limitations",
  "approved_execution_mode",
  "created_at",
  "certified_at"
)
SELECT
  'cert_pa_' || wf.id,
  wf.id,
  1,
  'system:partner-acquisition',
  'section-01-partner-acquisition',
  'section-01-partner-acquisition-shadow-rehearsal',
  'src/__tests__/partner-acquisition-automation.test.ts',
  'LOW'::"WorkflowRiskClass",
  'Lead queue escalations are ops-facing; partner notifications are in-app/push only.',
  'LIVE'::"WorkflowExecutionMode",
  NOW(),
  NOW()
FROM (
  VALUES
    ('partner_lead_intake'),
    ('partner_lead_followup'),
    ('partner_onboarding_nudge'),
    ('partner_kyc_reminder'),
    ('partner_training_reminder'),
    ('partner_approval_escalation'),
    ('partner_welcome_journey'),
    ('partner_application_approved_notify')
) AS wf(id)
ON CONFLICT ("automation_id", "workflow_version") DO NOTHING;
