import { complianceExpiryService } from "../../services/compliance-expiry.service";
import type { ScheduledJobContext } from "../core/job-registry";

export const COMPLIANCE_EXPIRY_JOB_TYPE = "partner.compliance.expiry_eval";

export async function complianceExpiryJobHandler(
  _payload: Record<string, unknown>,
  _ctx: ScheduledJobContext,
): Promise<void> {
  await complianceExpiryService.evaluateAll();
}
