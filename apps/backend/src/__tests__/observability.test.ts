import { describe, expect, test } from "bun:test";
import {
  resolveTraceContext,
  formatTraceparent,
  recordDomainTrace,
  getRecentSpans,
  getTraceDomainCounts,
} from "../lib/tracing";
import { encodeCursor, decodeCursor, buildCursorResult } from "../lib/cursor-pagination";
import { normalizeRoute } from "../lib/metrics";

describe("tracing", () => {
  test("generates trace context when header absent", () => {
    const req = new Request("http://localhost/health");
    const ctx = resolveTraceContext(req);
    expect(ctx.traceId.length).toBeGreaterThan(0);
    expect(ctx.spanId.length).toBeGreaterThan(0);
  });

  test("parses W3C traceparent header", () => {
    const traceId = "a".repeat(32);
    const parentSpan = "b".repeat(16);
    const req = new Request("http://localhost/health", {
      headers: { traceparent: `00-${traceId}-${parentSpan}-01` },
    });
    const ctx = resolveTraceContext(req);
    expect(ctx.traceId).toBe(traceId);
    expect(ctx.parentSpanId).toBe(parentSpan);
  });

  test("formatTraceparent produces valid header", () => {
    const header = formatTraceparent("abc", "def");
    expect(header.startsWith("00-")).toBe(true);
  });

  test("records domain spans", () => {
    const before = getTraceDomainCounts().payment ?? 0;
    recordDomainTrace("payment", "test_payment", { requestId: "req_1", paymentId: "pay_1" });
    expect(getTraceDomainCounts().payment).toBe(before + 1);
    expect(getRecentSpans(5).length).toBeGreaterThan(0);
  });
});

describe("cursor pagination", () => {
  test("encodes and decodes cursor", () => {
    const createdAt = new Date("2026-06-08T12:00:00.000Z");
    const cursor = encodeCursor("abc123", createdAt);
    const decoded = decodeCursor(cursor);
    expect(decoded?.id).toBe("abc123");
    expect(decoded?.createdAt.toISOString()).toBe(createdAt.toISOString());
  });

  test("buildCursorResult signals hasMore", () => {
    const rows = [
      { id: "3", createdAt: new Date("2026-06-08T03:00:00Z") },
      { id: "2", createdAt: new Date("2026-06-08T02:00:00Z") },
      { id: "1", createdAt: new Date("2026-06-08T01:00:00Z") },
    ];
    const page = buildCursorResult(rows, 2);
    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).not.toBeNull();
  });
});

describe("metrics route normalization", () => {
  test("collapses id segments", () => {
    expect(normalizeRoute("/api/bookings/clxyz1234567890abcdefghij")).toBe("/api/bookings/:id");
    expect(normalizeRoute("/health")).toBe("/health");
  });
});
