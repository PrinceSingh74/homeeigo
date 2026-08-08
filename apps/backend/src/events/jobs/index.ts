import { registerJobHandler } from "../core/job-registry";
import { REVIEW_REQUEST_JOB_TYPE, reviewRequestJobHandler } from "./review-request.job";

/** Register every scheduled job handler. Called once at startup. */
export function bootstrapScheduledJobs(): void {
  registerJobHandler({
    jobType: REVIEW_REQUEST_JOB_TYPE,
    handler: reviewRequestJobHandler,
    maxAttempts: 3,
  });
}

export { REVIEW_REQUEST_JOB_TYPE };
