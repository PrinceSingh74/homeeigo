import { incCounter, observeHist, setGauge } from "./metrics";

/** Phase 6A automation counters. Label cardinality is deliberately bounded to workflow + reason. */

export function recordWorkflowStarted(workflowId: string): void {
  incCounter("automation_workflows_started_total", { workflow: workflowId });
}

export function recordWorkflowCompleted(workflowId: string): void {
  incCounter("automation_workflows_completed_total", { workflow: workflowId });
}

export function recordWorkflowFailed(workflowId: string, reason: string): void {
  incCounter("automation_workflows_failed_total", { workflow: workflowId, reason });
}

export function recordWorkflowSkipped(workflowId: string, reason: string): void {
  incCounter("automation_workflows_skipped_total", { workflow: workflowId, reason });
}

export function recordStepExecuted(workflowId: string, stepType: string, outcome: string): void {
  incCounter("automation_steps_executed_total", { workflow: workflowId, step_type: stepType, outcome });
}

export function recordConditionFailed(workflowId: string, reason: string): void {
  incCounter("automation_condition_failed_total", { workflow: workflowId, reason });
}

export function recordStepFailed(workflowId: string, stepType: string): void {
  incCounter("automation_steps_failed_total", { workflow: workflowId, step_type: stepType });
}

export function recordStepLatency(seconds: number, workflowId: string): void {
  observeHist("automation_latency_ms", seconds, { workflow: workflowId });
}

export function setActiveInstances(count: number): void {
  setGauge("automation_active_instances", count);
}
