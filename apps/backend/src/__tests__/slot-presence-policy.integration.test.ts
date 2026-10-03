/**
 * One live-presence rule for a customer-chosen partner, in the grid AND at create (2026-10-01).
 *
 * The documented rule (lib/scheduled-offer-presence): a job within 24 h needs the partner's app live
 * (fresh heartbeat + location); an appointment further out is offered from their saved base. Dispatch
 * and accept already applied it. Direct-assign create (and admin reassign, case re-offer) did not — the
 * flag defaulted to "required", so a booking a week out was refused because the chosen partner's phone
 * was not pinging at that moment — while the slot grid ignored presence altogether and offered slots
 * create then refused. Now create applies the horizon, and the grid projects it as PARTNER_OFFLINE.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { bookingService } from "../services/booking.service";
import { serviceAvailabilityService } from "../services/service-availability.service";
import { partnerOperationsService } from "../services/partner-operations.service";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  heartbeatFresh,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";

const RUN_ID = `slot-presence-${Date.now().toString(36)}`;
let ctx: AdvCtx;

beforeAll(async () => {
  if (!(await dbReachable())) throw new Error("homigo_test is not reachable");
  ctx = await seedAdversarialFixtures(RUN_ID);
});
afterAll(async () => {
  if (ctx) await cleanupAdversarialFixtures(RUN_ID);
});

/** The partner's app last pinged six hours ago: online toggle on, presence stale. */
async function stalePresence() {
  const old = new Date(Date.now() - 6 * 3_600_000);
  await prisma.partnerPresence.update({ where: { providerId: ctx.providerId }, data: { lastHeartbeatAt: old, lastLocationAt: old } });
  await prisma.provider.update({ where: { id: ctx.providerId }, data: { isOnline: true } });
}

/** YYYY-MM-DD of `daysAhead` in IST, and an instant two hours before that day starts (IST). */
function dayAhead(daysAhead: number): { date: string; dayStart: Date } {
  const ist = new Date(Date.now() + 5.5 * 3_600_000 + daysAhead * 86_400_000);
  const date = ist.toISOString().slice(0, 10);
  return { date, dayStart: new Date(`${date}T00:00:00+05:30`) };
}

async function grid(date: string, now: Date) {
  const r = await serviceAvailabilityService.getDaySlots({
    serviceId: ctx.serviceId,
    date,
    userId: ctx.customerA.id,
    addressId: ctx.addressAId,
    providerId: ctx.providerId,
    now,
  });
  if (!("slots" in r)) throw new Error(`availability refused: ${JSON.stringify(r).slice(0, 200)}`);
  return r.slots;
}

describe("a customer-chosen partner whose app is not live", () => {
  test("grid: slots beyond 24 h stay bookable; the same slots seen from inside 24 h are PARTNER_OFFLINE", async () => {
    await stalePresence();
    const { date, dayStart } = dayAhead(6);
    const far = await grid(date, new Date(dayStart.getTime() - 5 * 86_400_000));
    const near = await grid(date, new Date(dayStart.getTime() - 2 * 3_600_000));
    // Positive control: the partner really has bookable slots that day when presence is not required.
    expect(far.some((s) => s.available)).toBe(true);
    expect(far.some((s) => s.reason === "PARTNER_OFFLINE")).toBe(false);
    const nearOpen = near.filter((s) => s.available);
    expect(nearOpen.every((s) => new Date(s.start).getTime() - (dayStart.getTime() - 2 * 3_600_000) > 24 * 3_600_000)).toBe(true);
    expect(near.some((s) => s.reason === "PARTNER_OFFLINE")).toBe(true);
  });

  test("create: a slot six days out is booked with them (was refused STALE_PRESENCE)", async () => {
    await stalePresence();
    const { date, dayStart } = dayAhead(6);
    const open = (await grid(date, new Date())).find((s) => s.available);
    expect(open).toBeDefined();
    const created = await bookingService.create(ctx.customerA.id, {
      serviceId: ctx.serviceId,
      addressId: ctx.addressAId,
      scheduledDate: open!.start,
      providerId: ctx.providerId,
    });
    expect("booking" in created ? "booked" : JSON.stringify(created)).toBe("booked");
    expect(dayStart).toBeDefined();
  });

  test("create gate: inside 24 h the same partner is refused for stale presence, and accepted once live", async () => {
    await stalePresence();
    const soon = new Date(Date.now() + 2 * 3_600_000);
    const check = () =>
      prisma.$transaction(async (tx) =>
        partnerOperationsService.assertOfferEligible(tx as unknown as Prisma.TransactionClient, ctx.providerId, {
          latitude: 28.62,
          longitude: 77.37,
          scheduledDate: soon,
        }),
      );
    expect(["STALE_PRESENCE", "STALE_LOCATION"]).toContain(String(await check()));
    await heartbeatFresh(ctx);
    const live = await check();
    expect(live === "STALE_PRESENCE" || live === "STALE_LOCATION").toBe(false);
  });

  test("toggled offline: every slot is PARTNER_OFFLINE, matching create's OFFLINE refusal", async () => {
    await prisma.provider.update({ where: { id: ctx.providerId }, data: { isOnline: false } });
    try {
      const { date, dayStart } = dayAhead(6);
      const slots = await grid(date, new Date(dayStart.getTime() - 5 * 86_400_000));
      expect(slots.some((s) => s.available)).toBe(false);
      expect(slots.some((s) => s.reason === "PARTNER_OFFLINE")).toBe(true);
    } finally {
      await prisma.provider.update({ where: { id: ctx.providerId }, data: { isOnline: true } });
    }
  });
});
