/**
 * `AuditLogService.drain()` — a one-shot script can wait for the fire-and-forget audit writes of
 * its last change before it disconnects. Found in the 2026-09-28 closure rehearsal: the content
 * apply wrote 25 service versions and 24 enterprise audit rows, because the client was closed
 * while the 25th write was in flight.
 */
import { describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import { AuditLogService } from "../services/audit-log.service";

describe("audit drain", () => {
  test("every audit write started before drain() is persisted when drain() resolves", async () => {
    const traceIds = Array.from({ length: 5 }, (_, i) => `drain-test-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`);
    for (const traceId of traceIds) void AuditLogService.record("ADMIN_ACTION", "success", { traceId, reason: "audit drain test" });
    const left = await AuditLogService.drain(20_000);
    expect(left).toBe(0);
    // Read immediately — no sleep: drain() is the only thing that makes this deterministic.
    const rows = await prisma.enterpriseAuditLog.count({ where: { traceId: { in: traceIds } } });
    expect(rows).toBe(traceIds.length);
    await prisma.enterpriseAuditLog.deleteMany({ where: { traceId: { in: traceIds } } }).catch(() => {});
  });

  test("drain() with nothing in flight resolves at once", async () => {
    const t = performance.now();
    expect(await AuditLogService.drain(5_000)).toBe(0);
    expect(performance.now() - t).toBeLessThan(1_000);
  });
});
