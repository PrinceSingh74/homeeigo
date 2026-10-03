import { registerJobHandler } from "../core/job-registry";
import { REVIEW_REQUEST_JOB_TYPE, reviewRequestJobHandler } from "./review-request.job";
import { WORKFLOW_STEP_JOB_TYPE, workflowStepJobHandler } from "./workflow-step.job";
import { COMPLIANCE_EXPIRY_JOB_TYPE, complianceExpiryJobHandler } from "./compliance-expiry.job";
import { EXECUTIVE_REPORT_JOB_TYPE, executiveReportJobHandler } from "./executive-report.job";

/** Register every scheduled job handler. Called once at startup. */
export function bootstrapScheduledJobs(): void {
  registerJobHandler({
    jobType: REVIEW_REQUEST_JOB_TYPE,
    handler: reviewRequestJobHandler,
    maxAttempts: 3,
  });

  // A workflow step stays correct however late it runs — it re-reads the world before acting —
  // so the generic staleness guard is opted out. A workflow's own maxAgeMs bounds it instead.
  registerJobHandler({
    jobType: WORKFLOW_STEP_JOB_TYPE,
    handler: workflowStepJobHandler,
    maxAttempts: 3,
    maxStalenessMs: null,
  });

  registerJobHandler({
    jobType: COMPLIANCE_EXPIRY_JOB_TYPE,
    handler: complianceExpiryJobHandler,
    maxAttempts: 3,
    maxStalenessMs: null,
  });

  /**
   * The executive report re-reads every source at assembly time, so a late run is not a stale run —
   * but a *very* late one is the wrong document: a Monday brief delivered on Wednesday describes
   * Wednesday while claiming Monday's window. The generic staleness guard is therefore kept rather
   * than opted out, unlike the workflow step above.
   *
   * Registration is not scheduling. No `ScheduledJob` row of this type exists, and none may be
   * created while `executiveReportSchedule.status` is UNSET.
   */
  registerJobHandler({
    jobType: EXECUTIVE_REPORT_JOB_TYPE,
    handler: executiveReportJobHandler,
    maxAttempts: 3,
  });
}

export {
  REVIEW_REQUEST_JOB_TYPE,
  WORKFLOW_STEP_JOB_TYPE,
  COMPLIANCE_EXPIRY_JOB_TYPE,
  EXECUTIVE_REPORT_JOB_TYPE,
};
