/**
 * Pass 10 — support admin notification fan-out regression.
 * Proves cap ≤ SUPPORT_NOTIFY_CAP even when AdminUser pool ≫ 25 (measured 422+ on homigo_test).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import {
  SUPPORT_NOTIFY_CAP,
  supportTicketService,
} from "../services/support-ticket.service";

const RUN = `fanout_${Date.now().toString(36)}`;

describe("support notify fan-out (pool storm regression)", () => {
  let customerId: string;
  let supportAdminId: string;
  let eligibleAdminCount = 0;

  beforeAll(async () => {
    const customer = await prisma.user.findFirst({
      where: { role: "CUSTOMER", isActive: true },
      select: { id: true },
    });
    const admin = await prisma.user.findFirst({
      where: {
        role: "ADMIN",
        adminProfile: {
          isActive: true,
          role: { name: { in: ["SUPER_ADMIN", "SUPPORT_ADMIN", "OPERATIONS_ADMIN"] } },
        },
      },
      select: { id: true },
    });
    if (!customer || !admin) {
      throw new Error("fan-out fixture: need customer + support-capable admin");
    }
    customerId = customer.id;
    supportAdminId = admin.id;

    eligibleAdminCount = await prisma.adminUser.count({
      where: {
        isActive: true,
        role: {
          OR: [
            { name: "SUPER_ADMIN" },
            { name: "OPERATIONS_ADMIN" },
            { name: "SUPPORT_ADMIN" },
            { permissions: { some: { resource: "DISPUTES", action: "READ" } } },
          ],
        },
      },
    });
  }, 60_000);

  test("SUPPORT_NOTIFY_CAP is finite and ≤ 25", () => {
    expect(SUPPORT_NOTIFY_CAP).toBeGreaterThan(0);
    expect(SUPPORT_NOTIFY_CAP).toBeLessThanOrEqual(25);
  });

  test("AdminUser schema has lastLogin and no updatedAt", async () => {
    const sample = await prisma.adminUser.findFirst({
      select: { id: true, lastLogin: true, grantedAt: true },
    });
    expect(sample).toBeTruthy();
    // Runtime guard: ordering by nonexistent updatedAt must throw (Run B discard root cause).
    let threw = false;
    try {
      await prisma.adminUser.findMany({
        take: 1,
        orderBy: { updatedAt: "desc" } as never,
      });
    } catch (err) {
      threw = true;
      expect(String(err)).toMatch(/Unknown argument `updatedAt`|Unknown arg|updatedAt/i);
    }
    expect(threw).toBe(true);
  });

  test(
    "adminRespond never fans out past SUPPORT_NOTIFY_CAP even with large AdminUser pool",
    async () => {
      expect(eligibleAdminCount).toBeGreaterThan(0);

      const ticket = await supportTicketService.create(customerId, {
        subject: `Fan-out cap ${RUN}`,
        description: "Prove notification fan-out is capped under large AdminUser tables",
        category: "Billing",
      });

      // create() now awaits notify — baseline includes ≤ CAP support-queue rows.
      const beforeSupport = await prisma.notification.count({
        where: {
          referenceId: ticket.id,
          referenceType: "support_ticket",
          type: "SYSTEM",
          title: { startsWith: "Support queue" },
        },
      });
      expect(beforeSupport).toBeLessThanOrEqual(SUPPORT_NOTIFY_CAP);

      const started = Date.now();
      const updated = await supportTicketService.adminRespond(
        ticket.id,
        supportAdminId,
        `Fan-out proof ${RUN}`,
      );
      const elapsedMs = Date.now() - started;
      expect(updated).toBeTruthy();

      const afterSupport = await prisma.notification.count({
        where: {
          referenceId: ticket.id,
          referenceType: "support_ticket",
          type: "SYSTEM",
          title: { startsWith: "Support queue" },
        },
      });
      const delta = afterSupport - beforeSupport;

      expect(delta).toBeLessThanOrEqual(SUPPORT_NOTIFY_CAP);
      expect(delta).toBeGreaterThan(0);
      if (eligibleAdminCount > SUPPORT_NOTIFY_CAP) {
        /**
         * The cap is a per-event property, so it has to be asserted on the DELTA.
         *
         * This previously compared the ticket's CUMULATIVE count against the eligible admin count,
         * which silently assumed the ticket had been fanned out to exactly once. It has not:
         * `create` notifies the queue and `adminRespond` notifies it again, so a ticket that has
         * never exceeded the cap still holds 2 × 25 = 50 rows. The assertion passed only while the
         * database happened to contain more than fifty eligible admins, and began failing the
         * moment the test database was rebuilt with 32 — a property of the fixture, not of the cap.
         */
        expect(delta).toBeLessThan(eligibleAdminCount);
      }
      expect(elapsedMs).toBeLessThan(60_000);
    },
    120_000,
  );

  test("findMany take never exceeds SUPPORT_NOTIFY_CAP for notify query shape", async () => {
    const rows = await prisma.adminUser.findMany({
      where: {
        isActive: true,
        role: {
          OR: [
            { name: "SUPER_ADMIN" },
            { name: "OPERATIONS_ADMIN" },
            { name: "SUPPORT_ADMIN" },
            { permissions: { some: { resource: "DISPUTES", action: "READ" } } },
          ],
        },
      },
      select: { userId: true, lastLogin: true },
      orderBy: { lastLogin: "desc" },
      take: SUPPORT_NOTIFY_CAP,
    });
    expect(rows.length).toBeLessThanOrEqual(SUPPORT_NOTIFY_CAP);
    if (rows.length >= 2) {
      const times = rows.map((r) => (r.lastLogin ? r.lastLogin.getTime() : 0));
      for (let i = 1; i < times.length; i++) {
        expect(times[i]!).toBeLessThanOrEqual(times[i - 1]!);
      }
    }
  });
});
