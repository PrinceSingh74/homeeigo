/**
 * Structured startup timeline — certification + on-device Metro diagnostics.
 * Records wall-clock timestamps, async step durations, and pending/rejected promises.
 */
import { addStartupBreadcrumb } from "@/lib/observability/sentry";

export type StartupMarker =
  | "APP_START"
  | "HYDRATION_START"
  | "HYDRATION_END"
  | "HYDRATION"
  | "BOOTSTRAP_START"
  | "BOOTSTRAP_END"
  | "SECURESTORE"
  | "TOKEN_CHECK"
  | "REFRESH"
  | "AUTH_READY"
  | "NAVIGATION_READY"
  | "HOME_RENDER"
  | "SPLASH_HIDE"
  | "INTERACTIVE"
  | "FONTS_READY";

export type AsyncStepStatus = "pending" | "resolved" | "rejected" | "timeout";

export type AsyncStep = {
  name: string;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  status: AsyncStepStatus;
  detail?: string;
};

export type BudgetViolation = {
  budget: string;
  name: string;
  budgetMs: number;
  actualMs: number;
};

/** Hard startup performance budgets — CI + on-device warnings when exceeded. */
export const STARTUP_BUDGETS_MS = {
  hydration: 500,
  secureStore: 1000,
  bootstrap: 5000,
  splashVisible: 1500,
  interactive: 2000,
} as const;

type TraceEntry = { marker: StartupMarker; at: number; detail?: string; sinceStartMs: number };

const appStartAt = Date.now();
const timeline: TraceEntry[] = [];
const asyncSteps = new Map<string, AsyncStep>();
const homeRenderListeners = new Set<() => void>();
const interactiveListeners = new Set<() => void>();

const g = globalThis as typeof globalThis & {
  __homigoStartupTimeline?: TraceEntry[];
  __homigoStartupAsyncSteps?: AsyncStep[];
  __homigoStartupBudgetViolations?: BudgetViolation[];
  __homigoStartupDiagnostics?: Record<string, unknown>;
};

function sinceStart(): number {
  return Date.now() - appStartAt;
}

export function startupMark(marker: StartupMarker, detail?: string): void {
  const entry: TraceEntry = { marker, at: Date.now(), detail, sinceStartMs: sinceStart() };
  timeline.push(entry);
  g.__homigoStartupTimeline = timeline;
  const suffix = detail ? ` ${detail}` : "";
  console.info(`[Homeeigo STARTUP] ${marker}${suffix} +${entry.sinceStartMs}ms`);
  addStartupBreadcrumb(marker, detail, entry.sinceStartMs);
  if (marker === "HOME_RENDER") {
    for (const listener of homeRenderListeners) listener();
  }
  if (marker === "INTERACTIVE") {
    for (const listener of interactiveListeners) listener();
  }
}

export function onHomeRender(listener: () => void): () => void {
  homeRenderListeners.add(listener);
  if (timeline.some((e) => e.marker === "HOME_RENDER")) listener();
  return () => homeRenderListeners.delete(listener);
}

/** Fires once when splash hides / app becomes interactive (home-render or fallback). */
export function onInteractive(listener: () => void): () => void {
  interactiveListeners.add(listener);
  if (timeline.some((e) => e.marker === "INTERACTIVE")) listener();
  return () => interactiveListeners.delete(listener);
}

export function startAsyncStep(name: string, detail?: string): void {
  const step: AsyncStep = { name, startedAt: Date.now(), status: "pending", detail };
  asyncSteps.set(name, step);
  g.__homigoStartupAsyncSteps = [...asyncSteps.values()];
  console.info(`[Homeeigo STARTUP] ASYNC_START ${name}${detail ? ` ${detail}` : ""} +${sinceStart()}ms`);
}

export function finishAsyncStep(
  name: string,
  status: Exclude<AsyncStepStatus, "pending">,
  detail?: string,
): void {
  const prev = asyncSteps.get(name);
  const finishedAt = Date.now();
  const step: AsyncStep = {
    name,
    startedAt: prev?.startedAt ?? finishedAt,
    finishedAt,
    durationMs: finishedAt - (prev?.startedAt ?? finishedAt),
    status,
    detail: detail ?? prev?.detail,
  };
  asyncSteps.set(name, step);
  g.__homigoStartupAsyncSteps = [...asyncSteps.values()];
  const dur = step.durationMs ?? 0;
  const flag =
    dur > STARTUP_BUDGETS_MS.bootstrap ? " SLOW" : dur > STARTUP_BUDGETS_MS.secureStore ? " WARN" : "";
  console.info(
    `[Homeeigo STARTUP] ASYNC_${status.toUpperCase()} ${name} ${dur}ms +${sinceStart()}ms${flag}`,
  );
}

/** Track a promise; never leaves startup profiler in "pending" forever. */
export function traceAsyncStep<T>(name: string, promise: Promise<T>, timeoutMs?: number): Promise<T> {
  startAsyncStep(name);
  let settled = false;
  const settle = (status: Exclude<AsyncStepStatus, "pending">, detail?: string) => {
    if (settled) return;
    settled = true;
    finishAsyncStep(name, status, detail);
  };

  const tracked = promise
    .then((value) => {
      settle("resolved");
      return value;
    })
    .catch((error: unknown) => {
      settle("rejected", error instanceof Error ? error.message : String(error));
      throw error;
    });

  if (timeoutMs != null) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    void Promise.race([
      tracked,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ])
      .catch(() => {
        if (!settled) settle("timeout", `${timeoutMs}ms`);
      })
      .finally(() => {
        if (timer) clearTimeout(timer);
      });
  }

  return tracked;
}

function markerSince(marker: StartupMarker): number | undefined {
  return timeline.find((e) => e.marker === marker)?.sinceStartMs;
}

function spanMs(start: StartupMarker, end: StartupMarker): number | undefined {
  const a = markerSince(start);
  const b = markerSince(end);
  if (a == null || b == null) return undefined;
  return b - a;
}

/** Check startup performance budgets against recorded timeline + async steps. */
export function checkStartupBudgets(): BudgetViolation[] {
  const violations: BudgetViolation[] = [];

  const hydrationMs = spanMs("HYDRATION_START", "HYDRATION_END") ?? markerSince("HYDRATION_END");
  if (hydrationMs != null && hydrationMs > STARTUP_BUDGETS_MS.hydration) {
    violations.push({
      budget: "hydration",
      name: "hydration",
      budgetMs: STARTUP_BUDGETS_MS.hydration,
      actualMs: hydrationMs,
    });
  }

  const secureStep = asyncSteps.get("securestore");
  if (secureStep?.durationMs != null && secureStep.durationMs > STARTUP_BUDGETS_MS.secureStore) {
    violations.push({
      budget: "secureStore",
      name: "securestore",
      budgetMs: STARTUP_BUDGETS_MS.secureStore,
      actualMs: secureStep.durationMs,
    });
  }

  const bootstrapMs = spanMs("BOOTSTRAP_START", "BOOTSTRAP_END") ?? markerSince("BOOTSTRAP_END");
  if (bootstrapMs != null && bootstrapMs > STARTUP_BUDGETS_MS.bootstrap) {
    violations.push({
      budget: "bootstrap",
      name: "bootstrap",
      budgetMs: STARTUP_BUDGETS_MS.bootstrap,
      actualMs: bootstrapMs,
    });
  }

  const splashMs = markerSince("SPLASH_HIDE");
  if (splashMs != null && splashMs > STARTUP_BUDGETS_MS.splashVisible) {
    violations.push({
      budget: "splashVisible",
      name: "splash_hide",
      budgetMs: STARTUP_BUDGETS_MS.splashVisible,
      actualMs: splashMs,
    });
  }

  const interactiveMs = markerSince("INTERACTIVE");
  if (interactiveMs != null && interactiveMs > STARTUP_BUDGETS_MS.interactive) {
    violations.push({
      budget: "interactive",
      name: "interactive",
      budgetMs: STARTUP_BUDGETS_MS.interactive,
      actualMs: interactiveMs,
    });
  }

  g.__homigoStartupBudgetViolations = violations;
  if (violations.length && __DEV__) {
    console.warn("[Homeeigo STARTUP] budget violations:", violations);
  }
  return violations;
}

export function getStartupTimeline(): readonly TraceEntry[] {
  return timeline;
}

export function getAsyncSteps(): readonly AsyncStep[] {
  return [...asyncSteps.values()];
}

export function getFlameTimeline(): string {
  const lines = timeline.map((e) => {
    const d = e.detail ? ` (${e.detail})` : "";
    return `${e.sinceStartMs}ms  ${e.marker}${d}`;
  });
  for (const step of asyncSteps.values()) {
    if (step.durationMs != null) {
      const slow = step.durationMs > STARTUP_BUDGETS_MS.bootstrap ? " ⚠ SLOW" : "";
      lines.push(`${step.durationMs}ms  ASYNC:${step.name} [${step.status}]${slow}`);
    } else if (step.status === "pending") {
      lines.push(`…     ASYNC:${step.name} [pending] ⚠ CRITICAL`);
    }
  }
  const violations = checkStartupBudgets();
  for (const v of violations) {
    lines.push(`⚠ BUDGET  ${v.name} ${v.actualMs}ms > ${v.budgetMs}ms`);
  }
  return lines.join("\n");
}

/** Device certification: dump structured diagnostics (Metro + `globalThis.__homigoStartupDiagnostics`). */
export function exportStartupDiagnostics(): Record<string, unknown> {
  const payload = {
    at: new Date().toISOString(),
    timeline: [...timeline],
    asyncSteps: [...asyncSteps.values()],
    violations: checkStartupBudgets(),
    flame: getFlameTimeline(),
  };
  g.__homigoStartupDiagnostics = payload;
  return payload;
}

export function resetStartupTimelineForTests(): void {
  timeline.length = 0;
  asyncSteps.clear();
  homeRenderListeners.clear();
  interactiveListeners.clear();
  g.__homigoStartupTimeline = timeline;
  g.__homigoStartupAsyncSteps = [];
  g.__homigoStartupBudgetViolations = [];
}

export const REQUIRED_STARTUP_MARKERS: readonly StartupMarker[] = [
  "APP_START",
  "HYDRATION",
  "BOOTSTRAP_START",
  "SECURESTORE",
  "TOKEN_CHECK",
  "REFRESH",
  "AUTH_READY",
  "NAVIGATION_READY",
  "HOME_RENDER",
  "SPLASH_HIDE",
] as const;

export function missingStartupMarkers(
  seen: Iterable<StartupMarker> = timeline.map((e) => e.marker),
): StartupMarker[] {
  const set = new Set(seen);
  return REQUIRED_STARTUP_MARKERS.filter((m) => !set.has(m));
}
