import { registerJobHandler } from "../core/job-registry";
import { REVIEW_REQUEST_JOB_TYPE, reviewRequestJobHandler } from "./review-request.job";
import { WORKFLOW_STEP_JOB_TYPE, workflowStepJobHandler } from "./workflow-step.job";

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
}

export { REVIEW_REQUEST_JOB_TYPE, WORKFLOW_STEP_JOB_TYPE };
