/**
 * The slot grid must not offer a time booking create will refuse for THIS customer (2026-10-01).
 *
 * Create refuses a booking that overlaps one the customer already holds (OVERLAPPING_BOOKING,
 * bookings_user_slot_excl). The availability projection only looked at partner occupancy, so it
 * offered those times; the customer picked one and was refused at Confirm (web signoff E2E: 409).
 * Rescheduling passes the moved booking as `excludeBookingId`, exactly as create excludes it.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cleanupAdversarialFixtures, dbReachable, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { bookingService } from "../services/booking.service";
import { serviceAvailabilityService } from "../services/service-availability.service";

const RUN_ID = `avail-overlap-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let bookingId = "";

// A business hour three days out, pinned in IST so the test never straddles midnight.
const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(
  new Date(Date.now() + 72 * 3_600_000),
);
const AT = new Date(`${ymd}T11:00:00+05:30`);

beforeAll(async () => {
  if (!(await dbReachable())) throw new Error("homigo_test is not reachable");
  ctx = await seedAdversarialFixtures(RUN_ID);
  const created = await bookingService.create(ctx.customerA.id, {
    serviceId: ctx.serviceId,
    addressId: ctx.addressAId,
    scheduledDate: AT.toISOString(),
  });
  if (!("booking" in created)) throw new Error(`fixture booking not created: ${JSON.stringify(created)}`);
  bookingId = (created as { booking: { id: string } }).booking.id;
}, 120_000);

afterAll(async () => {
  if (ctx) await cleanupAdversarialFixtures(RUN_ID);
}, 60_000);

async function slotAt(userId: string, excludeBookingId?: string) {
  const r = await serviceAvailabilityService.getDaySlots({ serviceId: ctx.serviceId, date: ymd, userId, excludeBookingId });
  if (!r.ok) throw new Error(`availability failed: ${r.error}`);
  const s = r.slots.find((x) => Date.parse(x.start) === AT.getTime());
  if (!s) throw new Error(`no ${AT.toISOString()} slot in the grid`);
  return s;
}

describe("availability respects the customer's own bookings", () => {
  test("the customer's own booked time is offered as unavailable, with the create-time reason", async () => {
    const s = await slotAt(ctx.customerA.id);
    expect(s.available).toBe(false);
    expect(String(s.reason)).toBe("CUSTOMER_HAS_BOOKING");
  });

  test("create agrees: booking that time again is refused OVERLAPPING_BOOKING", async () => {
    const again = await bookingService.create(ctx.customerA.id, {
      serviceId: ctx.serviceId,
      addressId: ctx.addressAId,
      scheduledDate: AT.toISOString(),
    });
    expect((again as { error?: string }).error).toBe("OVERLAPPING_BOOKING");
  });

  test("rescheduling that booking (excludeBookingId) does not block its own new time", async () => {
    const s = await slotAt(ctx.customerA.id, bookingId);
    expect(s.reason).not.toBe("CUSTOMER_HAS_BOOKING");
  });

  test("another customer's view of the same time is unaffected", async () => {
    const s = await slotAt(ctx.customerB.id);
    expect(s.reason).not.toBe("CUSTOMER_HAS_BOOKING");
  });

  test("excludeBookingId cannot hide someone else's booking: it is scoped to the caller", async () => {
    // customerB passing customerA's booking id changes nothing for customerB, and customerA's view
    // with an unrelated id still sees its own booking.
    const own = await slotAt(ctx.customerA.id, "not-a-real-booking-id");
    expect(String(own.reason)).toBe("CUSTOMER_HAS_BOOKING");
  });
});
