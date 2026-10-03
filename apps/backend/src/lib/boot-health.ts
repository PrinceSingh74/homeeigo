import { incCounter } from "./metrics";
import { logger } from "./logger";

/**
 * Boot-time degradations that must not disappear into a log line.
 *
 * `maintenance.ts` starts several subsystems asynchronously after the HTTP server is already
 * accepting traffic. When one of those bootstraps fails (the workflow registry, for example) the
 * outbox and scheduled-job processors are deliberately not started — running them against an empty
 * registry would fail every step — but until now the only trace was a single `logger.error` at
 * boot. The process kept answering `/ready` with 200, so nothing external ever noticed that events
 * were being published and never delivered.
 *
 * This is the durable record of that state. `/ready` reports it and returns 503 while any
 * degradation is present, which is what turns a silent failure into a page.
 */

export type BootDegradation = {
  component: string;
  error: string;
  since: string;
  /** What the operator loses while the component is down. */
  impact: string;
};

const degradations = new Map<string, BootDegradation>();

export function markBootDegraded(component: string, error: unknown, impact: string): void {
  const message = error instanceof Error ? error.message : String(error);
  degradations.set(component, {
    component,
    error: message,
    since: new Date().toISOString(),
    impact,
  });
  incCounter("boot_degraded_total", { component });
  logger.error("boot_component_degraded", { component, error: message, impact });
}

/** Called when a component that failed at boot later recovers (retry succeeded). */
export function clearBootDegradation(component: string): void {
  if (degradations.delete(component)) {
    logger.info("boot_component_recovered", { component });
  }
}

export function getBootDegradations(): BootDegradation[] {
  return Array.from(degradations.values());
}

export function isBootDegraded(): boolean {
  return degradations.size > 0;
}

/** Test-only reset. */
export function __resetBootHealthForTests(): void {
  degradations.clear();
}
