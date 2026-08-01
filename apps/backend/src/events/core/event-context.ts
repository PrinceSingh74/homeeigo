import { AsyncLocalStorage } from "async_hooks";

export type EventTraceContext = {
  traceId?: string;
  correlationId?: string;
  causationId?: string;
  actorType?: "customer" | "partner" | "admin" | "system";
  actorId?: string;
};

const storage = new AsyncLocalStorage<EventTraceContext>();

export function runWithEventContext<T>(ctx: EventTraceContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getEventContext(): EventTraceContext {
  return storage.getStore() ?? {};
}

export function mergeEventContext(override?: Partial<EventTraceContext>): EventTraceContext {
  return { ...getEventContext(), ...override };
}

/** Bind HTTP request trace/correlation into async context for downstream event emission. */
export function bindEventContextFromRequest(input: {
  traceId: string;
  requestId: string;
  causationId?: string;
  actorType?: EventTraceContext["actorType"];
  actorId?: string;
}): void {
  storage.enterWith({
    traceId: input.traceId,
    correlationId: input.requestId,
    causationId: input.causationId,
    actorType: input.actorType,
    actorId: input.actorId,
  });
}

export function setCausationId(causationId: string): void {
  const current = getEventContext();
  storage.enterWith({ ...current, causationId });
}
