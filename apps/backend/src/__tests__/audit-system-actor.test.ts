import { describe, expect, it } from "bun:test";
import prisma from "../lib/prisma";
import { AuditLogService } from "../services/audit-log.service";

describe("audit survives a system actor that is not a user", () => {
  it("writes the row with a null FK and keeps the actor label", async () => {
    const event = `SYSTEM_ACTOR_AUDIT_${Date.now()}`;
    const before = await prisma.activityLog.count({ where: { action: event } });
    await AuditLogService.success(event as any, { userId: "ledger-reconciliation" });
    const rows = await prisma.activityLog.findMany({ where: { action: event } });
    expect(rows.length).toBe(before + 1);
    expect(rows[0]!.userId).toBeNull();
    expect(JSON.parse(rows[0]!.description ?? "{}").systemActor).toBe("ledger-reconciliation");
    await prisma.activityLog.deleteMany({ where: { action: event } });
  });
});
