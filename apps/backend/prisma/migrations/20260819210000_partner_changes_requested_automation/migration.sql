-- Certify LIVE partner changes-requested resume automation (idempotent).

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
VALUES (
  'cert_pa_partner_changes_requested_resume',
  'partner_changes_requested_resume',
  1,
  'system:partner-acquisition',
  'section-01-partner-acquisition',
  'section-01-partner-acquisition-shadow-rehearsal',
  'src/__tests__/partner-acquisition-automation.test.ts',
  'LOW'::"WorkflowRiskClass",
  'Immediate in-app/push resume nudge when HQ requests application changes.',
  'LIVE'::"WorkflowExecutionMode",
  NOW(),
  NOW()
)
ON CONFLICT ("automation_id", "workflow_version") DO NOTHING;
