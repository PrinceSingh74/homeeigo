#!/usr/bin/env bun
/**
 * Report partner acquisition automation certification state.
 *
 * This script is READ-ONLY. It does not write AutomationCertification rows,
 * does not activate LIVE, and does not restore the removed boot-time
 * self-certification path. LIVE requires a human ADMIN via certifyAutomation
 * plus a deliberate activation outside any startup path.
 *
 * Usage:
 *   bun --env-file=.env run scripts/certify-partner-acquisition-automations.ts
 */
import { registerPartnerAcquisitionWorkflows } from "../src/automation/registry/definitions/partner-acquisition-workflows";
import { listWorkflows } from "../src/automation/registry/workflow-registry";

const PARTNER_PREFIX = [
  "partner_lead_intake",
  "partner_lead_followup",
  "partner_onboarding_nudge",
  "partner_kyc_reminder",
  "partner_training_reminder",
  "partner_approval_escalation",
  "partner_welcome_journey",
  "partner_application_approved_notify",
  "partner_changes_requested_resume",
];

async function main() {
  console.log("Partner acquisition automation — certification STATUS (read-only)\n");

  registerPartnerAcquisitionWorkflows();
  const registered = listWorkflows().filter((wf) => PARTNER_PREFIX.includes(wf.workflowId));

  let shadow = 0;
  let live = 0;
  let draft = 0;
  for (const wf of registered) {
    console.log(
      `  ${wf.workflowId}.v${wf.version}  mode=${wf.executionMode}  cert=${wf.certificationStatus}`,
    );
    if (wf.executionMode === "SHADOW") shadow += 1;
    if (wf.executionMode === "LIVE") live += 1;
    if (wf.certificationStatus === "DRAFT") draft += 1;
  }

  console.log(`\nRegistered: ${registered.length}/9`);
  console.log(`SHADOW=${shadow} LIVE=${live} DRAFT=${draft}`);
  console.log(
    "\nLIVE activation is intentionally gated. SHADOW is the safe production state until a human certifies each workflow.",
  );

  if (registered.length !== 9) {
    console.error("FAIL: expected 9 partner acquisition workflows.");
    process.exit(1);
  }
  if (live > 0) {
    console.error("FAIL: partner acquisition workflows must not self-activate as LIVE.");
    process.exit(1);
  }
  console.log("\nDone — definitions present, SHADOW/DRAFT, no self-certification.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
