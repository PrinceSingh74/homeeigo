import crypto from "crypto";

export type TraceDomain =
  | "payment"
  | "webhook"
  | "booking"
  | "provider"
  | "finance"
  | "notification"
  | "auth";

export type SpanStatus = "ok" | "error";

export type SpanRecord = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  domain: TraceDomain;
  status: SpanStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  requestId?: string;
  userId?: string;
  bookingId?: string;
  paymentId?: string;
  metadata?: Record<string, unknown>;
};

const TRACE_HEADER = "traceparent";
const MAX_SPANS = 5000;
const spanBuffer: SpanRecord[] = [];
const domainCounters = new Map<string, number>();

function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString("hex");
}

/** Parse W3C traceparent or generate a new trace context. */
export function resolveTraceContext(request: Request): {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
} {
  const traceparent = request.headers.get(TRACE_HEADER);
  if (traceparent) {
    const parts = traceparent.trim().split("-");
    if (parts.length === 4 && parts[0] === "00") {
      const traceId = parts[1]!.slice(0, 32);
      const parentSpanId = parts[2]!.slice(0, 16);
      if (/^[0-9a-f]+$/i.test(traceId) && /^[0-9a-f]+$/i.test(parentSpanId)) {
        return { traceId, spanId: randomHex(8), parentSpanId };
      }
    }
  }
  return { traceId: randomHex(16), spanId: randomHex(8) };
}

export function formatTraceparent(traceId: string, spanId: string): string {
  return `00-${traceId.padStart(32, "0").slice(0, 32)}-${spanId.padStart(16, "0").slice(0, 16)}-01`;
}

function pushSpan(span: SpanRecord): void {
  spanBuffer.push(span);
  if (spanBuffer.length > MAX_SPANS) spanBuffer.shift();
  domainCounters.set(span.domain, (domainCounters.get(span.domain) ?? 0) + 1);
  if (process.env.OTEL_EXPORTER === "stdout" || process.env.NODE_ENV === "production") {
    console.log(JSON.stringify({ type: "otel_span", ...span }));
  }
}

export function startSpan(
  name: string,
  domain: TraceDomain,
  ctx: {
    traceId: string;
    spanId?: string;
    parentSpanId?: string;
    requestId?: string;
    userId?: string;
    bookingId?: string;
    paymentId?: string;
  },
): { end: (status?: SpanStatus, metadata?: Record<string, unknown>) => void } {
  const spanId = ctx.spanId ?? randomHex(8);
  const started = Date.now();
  return {
    end: (status = "ok", metadata) => {
      const endedAt = new Date().toISOString();
      pushSpan({
        traceId: ctx.traceId,
        spanId,
        parentSpanId: ctx.parentSpanId,
        name,
        domain,
        status,
        startedAt: new Date(started).toISOString(),
        endedAt,
        durationMs: Date.now() - started,
        requestId: ctx.requestId,
        userId: ctx.userId,
        bookingId: ctx.bookingId,
        paymentId: ctx.paymentId,
        metadata,
      });
    },
  };
}

export function recordDomainTrace(
  domain: TraceDomain,
  name: string,
  ctx: {
    traceId?: string;
    requestId?: string;
    userId?: string;
    bookingId?: string;
    paymentId?: string;
    status?: SpanStatus;
    metadata?: Record<string, unknown>;
  },
): void {
  const traceId = ctx.traceId ?? randomHex(16);
  const span = startSpan(name, domain, {
    traceId,
    requestId: ctx.requestId,
    userId: ctx.userId,
    bookingId: ctx.bookingId,
    paymentId: ctx.paymentId,
  });
  span.end(ctx.status ?? "ok", ctx.metadata);
}

export function getRecentSpans(limit = 100, domain?: TraceDomain): SpanRecord[] {
  const rows = domain ? spanBuffer.filter((s) => s.domain === domain) : spanBuffer;
  return rows.slice(-limit).reverse();
}

export function getTraceDomainCounts(): Record<string, number> {
  return Object.fromEntries(domainCounters);
}

export function getSpanBufferSize(): number {
  return spanBuffer.length;
}
