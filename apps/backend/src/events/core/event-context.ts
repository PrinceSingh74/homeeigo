import { AsyncLocalStorage } from "async_hooks";

export type EventActorType = "customer" | "partner" | "admin" | "system";

export type EventTraceContext = {
  traceId?: string;
  /** HTTP request id; also used as the business correlation id unless a journey overrides it. */
  requestId?: string;
  correlationId?: string;
  causationId?: string;
  actorType?: EventActorType;
  actorId?: string;
  partnerId?: string;
  bookingId?: string;
  eventId?: string;
  deviceId?: string;
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

/** Replace the ALS store with a merged snapshot. Safe no-op fields stay in place. */
export function bindEventContext(override: Partial<EventTraceContext>): EventTraceContext {
  const next = { ...getEventContext(), ...override };
  storage.enterWith(next);
  return next;
}

/** Bind HTTP request trace/correlation into async context for downstream event emission. */
export function bindEventContextFromRequest(input: {
  traceId: string;
  requestId: string;
  causationId?: string;
  actorType?: EventActorType;
  actorId?: string;
  partnerId?: string;
  bookingId?: string;
  deviceId?: string;
}): void {
  storage.enterWith({
    traceId: input.traceId,
    requestId: input.requestId,
    correlationId: input.requestId,
    causationId: input.causationId,
    actorType: input.actorType,
    actorId: input.actorId,
    partnerId: input.partnerId,
    bookingId: input.bookingId,
    deviceId: input.deviceId,
  });
}

export function setCausationId(causationId: string): void {
  bindEventContext({ causationId });
}

export function bindActorContext(input: {
  actorId: string;
  actorType: EventActorType;
  partnerId?: string;
}): void {
  bindEventContext({
    actorId: input.actorId,
    actorType: input.actorType,
    ...(input.partnerId ? { partnerId: input.partnerId } : {}),
  });
}
