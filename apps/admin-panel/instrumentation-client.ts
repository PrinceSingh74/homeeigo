/** Next.js client instrumentation — loads the Sentry browser config + router transition tracing. */
import * as Sentry from "@sentry/nextjs";
import "./sentry.client.config";

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
