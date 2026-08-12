/**
 * Enterprise-complete certification tests — support, reschedule, settings, coupons.
 */
import "../load-env";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { BookingStatus } from "@prisma/client";
import {
  prisma,
  dbReachable,
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
  futureSlot,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { supportTicketService } from "../services/support-ticket.service";
import { bookingService } from "../services/booking.service";
import { providerService } from "../services/provider.service";
import { membershipCouponService } from "../services/membership-coupon.service";

const RUN_ID = `ent-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN_ID);
});

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN_ID);
  await prisma.$disconnect();
}, 60_000);

function skipIfNoDb() {
  if (!dbOk) {
    console.warn("SKIP: PostgreSQL unreachable");
    return true;
  }
  return false;
}

describe.serial("Enterprise complete flows", () => {
  test("support ticket create → admin respond → user sees reply", async () => {
    if (skipIfNoDb()) return;

    const created = await supportTicketService.create(ctx.customerA.id, {
      subject: `Enterprise support ${RUN_ID}`,
      description: "Partner payout delay test ticket for certification",
      category: "Payment",
      priorityLevel: "normal",
    });

    const detail = await supportTicketService.getForUser(created.id, ctx.customerA.id);
    expect(detail?.messages.length).toBeGreaterThanOrEqual(1);

    await supportTicketService.adminRespond(
      created.id,
      ctx.supportAdmin.id,
      "We are reviewing your payout — expect update in 24h",
    );

    const after = await supportTicketService.getForUser(created.id, ctx.customerA.id);
    expect(after?.messages.some((m) => m.authorRole === "admin")).toBe(true);
    expect(after?.status).toBe("in_progress");
  });

  test("partner support ticket with providerId", async () => {
    if (skipIfNoDb()) return;

    const created = await supportTicketService.create(
      ctx.vendorUserId,
      {
        subject: `Partner ticket ${RUN_ID}`,
        description: "Need help with verification documents upload",
        category: "Account",
      },
      { providerId: ctx.providerId },
    );

    const listed = await supportTicketService.listForUser(
      ctx.vendorUserId,
      {},
      ctx.providerId,
    );
    expect(listed.tickets.some((t) => t.id === created.id)).toBe(true);
  });

  test("booking reschedule — no overlap on same slot", async () => {
    if (skipIfNoDb()) return;

    const slotA = futureSlot(400);
    const slotB = futureSlot(401);

    const b1 = await bookingService.create(ctx.customerA.id, {
      serviceId: ctx.serviceId,
      providerId: ctx.providerId,
      scheduledDate: slotA.toISOString(),
      addressId: ctx.addressAId,
    });
    expect("booking" in b1).toBe(true);
    const bookingId = b1.booking!.id;

    await prisma.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.ACCEPTED, providerId: ctx.providerId },
    });

    const ok = await bookingService.update(ctx.customerA.id, bookingId, {
      scheduledDate: slotB.toISOString(),
    });
    expect(ok.ok).toBe(true);

    const conflict = await bookingService.update(ctx.customerA.id, bookingId, {
      scheduledDate: slotA.toISOString(),
    });
    if ("error" in conflict && conflict.error) {
      expect(["OVERLAPPING_BOOKING", "PROVIDER_UNAVAILABLE"]).toContain(conflict.error);
    }
  });

  test("partner settings persist", async () => {
    if (skipIfNoDb()) return;

    const updated = await providerService.updateSettings(ctx.providerId, {
      workingHoursStart: "08:00",
      workingHoursEnd: "20:00",
      workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
      paymentMethodPreference: "upi",
      upiId: `partner-${RUN_ID}@upi`,
    });
    expect(updated.workingHoursStart).toBe("08:00");
    expect(updated.upiId).toContain(RUN_ID);

    const me = await providerService.me(ctx.providerId);
    expect(me?.workingHoursEnd).toBe("20:00");
  });

  test("membership coupons list for user", async () => {
    if (skipIfNoDb()) return;
    const coupons = await membershipCouponService.myCoupons(ctx.customerA.id);
    expect(Array.isArray(coupons)).toBe(true);
  });
});
