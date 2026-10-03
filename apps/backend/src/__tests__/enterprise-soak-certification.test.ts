/**
 * Adversarial enterprise soak certification — attack existing flows at volume.
 * No feature building; execution-only evidence for enterprise-soak-certification.md
 */
import "../load-env";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { AssignmentAttemptStatus } from "@prisma/client";
import { BookingStatus, MembershipCouponStatus } from "@prisma/client";
import fs from "fs";
import path from "path";
import {
  prisma,
  dbReachable,
  seedAdversarialFixtures,
  heartbeatFresh,
  cleanupAdversarialFixtures,
  deleteBookingsForUsers,
  bearer,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { bookingService } from "../services/booking.service";
import { supportTicketService } from "../services/support-ticket.service";
import { providerService } from "../services/provider.service";
import { bookingPricingService } from "../services/booking-pricing.service";
import { roomManager, type WSConnection } from "../lib/websocket";
import { pushToUser } from "../services/notification-hub";
import app from "../index";

const RUN_ID = `soak-${Date.now().toString(36)}`;
const DOCS = path.join(import.meta.dir, "../../docs/enterprise-soak-certification.md");

type Verdict = "PASS" | "FAIL" | "NOT PROVEN";
type SoakRow = {
  scenario: string;
  verdict: Verdict;
  evidence: string;
  metrics?: Record<string, number | string>;
};

const results: SoakRow[] = [];

function record(scenario: string, verdict: Verdict, evidence: string, metrics?: Record<string, number | string>) {
  results.push({ scenario, verdict, evidence, metrics });
}

let ctx: AdvCtx;
let dbOk = false;
let soakCouponId: string | null = null;
let soakCouponCode: string | null = null;

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN_ID);

  await prisma.provider.update({
    where: { id: ctx.providerId },
    data: {
      workingHoursStart: "00:00",
      workingHoursEnd: "23:59",
      workingDays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      isOnline: true,
      /**
       * The platform's maximum concurrent-job capacity, stated rather than inherited.
       *
       * `assertOfferEligible` counts every booking in a concurrent status toward
       * `maxConcurrentJobs`, which the fixture sets to 4. Scenarios here seed batches of accepted
       * bookings on one partner, so the fifth was refused with PROVIDER_UNAVAILABLE and the
       * scenario failed before exercising anything it was written to test. 20 is the ceiling
       * `providers_max_concurrent_jobs_range` enforces in the database.
       */
      maxConcurrentJobs: 20,
    },
  });
  await deleteBookingsForUsers([ctx.customerA.id, ctx.customerB.id]);

  const code = `SOAK${RUN_ID.replace(/[^a-z0-9]/gi, "").slice(0, 12).toUpperCase()}`;
  const coupon = await prisma.membershipCoupon.create({
    data: {
      code,
      name: `Soak coupon ${RUN_ID}`,
      status: MembershipCouponStatus.ACTIVE,
      discountPct: 15,
      perUserLimit: 200,
      maxRedemptions: 500,
    },
  });
  soakCouponId = coupon.id;
  soakCouponCode = coupon.code;
});

afterAll(async () => {
  if (soakCouponId) {
    await prisma.membershipCouponRedemption.deleteMany({ where: { couponId: soakCouponId } });
    await prisma.membershipCoupon.deleteMany({ where: { id: soakCouponId } });
  }
  if (dbOk) {
    const tag = `adv-${RUN_ID}`;
    const users = await prisma.user.findMany({
      where: { email: { contains: tag } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    if (userIds.length) {
      await prisma.supportTicketMessage.deleteMany({
        where: { ticket: { OR: [{ userId: { in: userIds } }, { providerId: ctx?.providerId }] } },
      });
      await prisma.supportTicket.deleteMany({
        where: { OR: [{ userId: { in: userIds } }, { providerId: ctx?.providerId }] },
      });
    }
    await cleanupAdversarialFixtures(RUN_ID);
  }

  const lines = [
    "# Enterprise Soak Certification",
    "",
    `**Executed:** ${new Date().toISOString()}`,
    `**Run ID:** \`${RUN_ID}\``,
    `**Command:** \`bun test src/__tests__/enterprise-soak-certification.test.ts\``,
    "",
    "| # | Scenario | Verdict | Evidence |",
    "|---|----------|---------|----------|",
    ...results.map((r, i) => {
      const m = r.metrics ? ` ${JSON.stringify(r.metrics)}` : "";
      return `| ${i + 1} | ${r.scenario} | **${r.verdict}** | ${r.evidence}${m} |`;
    }),
    "",
    "## E2E flow chains",
    "",
    results
      .filter((r) => r.scenario.includes("chain") || r.scenario.includes("Playwright"))
      .map((r) => `- ${r.scenario}: **${r.verdict}**`)
      .join("\n") || "- (see table above)",
    "",
  ];
  fs.writeFileSync(DOCS, lines.join("\n"));
}, 300_000);

/** Booking window is max 30 days ahead — keep soak slots inside validation limit. */
function soakSlot(hoursFromNow: number): Date {
  const capped = Math.min(hoursFromNow, 29 * 24 - 2);
  const d = new Date(Date.now() + capped * 3_600_000);
  d.setMinutes(0, 0, 0);
  return d;
}

function skipIfNoDb() {
  if (!dbOk) {
    record("database", "NOT PROVEN", "PostgreSQL unreachable");
    return true;
  }
  return false;
}

/**
 * Free the partner's concurrent-job capacity before a scenario that needs to create bookings.
 *
 * `assertOfferEligible` counts every booking in a concurrent status toward `maxConcurrentJobs`, with
 * NO time bound — so accepted bookings accumulate across the scenarios in this serial file and the
 * partner reaches capacity partway through, after which every later `bookingService.create` returns
 * PROVIDER_UNAVAILABLE. Scenario 6 then measured zero coupon-discounted bookings and read as a
 * coupon defect; scenario 9 never got its booking at all.
 *
 * Completing them is the lifecycle transition that frees capacity in production too, so the state
 * this produces is one the platform actually reaches.
 */
/**
 * Make the partner dispatchable again: fresh presence AND free capacity.
 *
 * Direct booking fails closed without a recent heartbeat — `PRESENCE_FRESH_SEC` is 30 seconds, and
 * this file runs a dozen scenarios over several minutes, so the heartbeat `seedAdversarialFixtures`
 * leaves behind has long expired by the later ones. Measured at the failure point: currentJobs 0,
 * sentOffers 0, no nearby booking, partner online — capacity and slots were both fine and the
 * refusal was DIRECT_ASSIGN_BLOCKED on stale presence.
 */
async function readyProvider() {
  await heartbeatFresh(ctx);
  await releaseProviderCapacity();
}

async function releaseProviderCapacity() {
  await prisma.booking.updateMany({
    where: {
      providerId: ctx.providerId,
      status: { in: [BookingStatus.ACCEPTED, BookingStatus.ASSIGNED] },
    },
    data: { status: BookingStatus.COMPLETED, completedAt: new Date() },
  });
  /**
   * Unanswered offers hold capacity too — `computeCapacity` adds `reservedOffers` to `currentJobs`,
   * and earlier scenarios dispatch far more offers than anyone answers. Timing them out is what
   * happens to an ignored offer in production; leaving them SENT would keep the partner at capacity
   * forever on a purely synthetic backlog.
   */
  await prisma.assignmentAttempt.updateMany({
    where: { providerId: ctx.providerId, status: AssignmentAttemptStatus.SENT },
    data: { status: AssignmentAttemptStatus.TIMEOUT, respondedAt: new Date() },
  });
}

async function seedAcceptedBooking(hoursFromNow: number) {
  const slot = soakSlot(hoursFromNow);
  const created = await bookingService.create(ctx.customerA.id, {
    serviceId: ctx.serviceId,
    providerId: ctx.providerId,
    scheduledDate: slot.toISOString(),
    addressId: ctx.addressAId,
  });
  if (!("booking" in created) || !created.booking) {
    throw new Error(`booking create failed: ${JSON.stringify(created)}`);
  }
  await prisma.booking.update({
    where: { id: created.booking.id },
    data: { status: BookingStatus.ACCEPTED },
  });
  return { id: created.booking.id, slot };
}

describe.serial("Enterprise soak — adversarial certification", () => {
  test("1 — 100 sequential customer reschedules", async () => {
    if (skipIfNoDb()) return;
    const { id } = await seedAcceptedBooking(72);
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < 100; i++) {
      const slot = soakSlot(74 + i * 2);
      const r = await bookingService.update(ctx.customerA.id, id, {
        scheduledDate: slot.toISOString(),
      });
      if ("ok" in r && r.ok) ok++;
      else fail++;
    }
    const row = await prisma.booking.findUniqueOrThrow({ where: { id } });
    const pass = ok === 100;
    record(
      "100 Customer Reschedules",
      pass ? "PASS" : "FAIL",
      pass ? "100/100 sequential reschedules succeeded" : `${ok}/100 ok, ${fail} failed`,
      { ok, fail, finalSlot: row.scheduledDate.toISOString() },
    );
    expect(ok).toBe(100);
  }, 180_000);

  test("2 — 100 concurrent reschedules (10 bookings × 10 parallel)", async () => {
    if (skipIfNoDb()) return;
    const bookings: Array<{ id: string; slot: Date }> = [];
    for (let i = 0; i < 10; i++) {
      bookings.push(await seedAcceptedBooking(100 + i * 20));
    }
    const tasks = bookings.flatMap((b, bi) =>
      Array.from({ length: 10 }, (_, j) => {
        const slot = soakSlot(102 + bi * 20 + j * 2);
        return bookingService
          .update(ctx.customerA.id, b.id, { scheduledDate: slot.toISOString() })
          .catch((e) => ({ error: String(e) }));
      }),
    );
    const outcomes = await Promise.all(tasks);
    const ok = outcomes.filter((o) => o && typeof o === "object" && "ok" in o && o.ok).length;
    const poolErrors = outcomes.filter(
      (o) => o && typeof o === "object" && "error" in o && String(o.error).includes("too many clients"),
    ).length;
    const rows = await prisma.booking.findMany({ where: { id: { in: bookings.map((b) => b.id) } } });
    const corrupt = rows.filter((r) => !r.scheduledDate).length;
    const pass = ok >= 50 && corrupt === 0 && poolErrors === 0;
    record(
      "100 Concurrent Reschedules",
      pass ? "PASS" : "FAIL",
      `${ok}/100 succeeded; ${corrupt} corrupt; ${poolErrors} connection-pool errors`,
      { ok, corrupt, poolErrors, total: 100 },
    );
    if (poolErrors > 0) {
      record(
        "ADVERSARIAL: DB connection pool under 100 parallel reschedules",
        "FAIL",
        `${poolErrors} requests hit P2037 too many clients`,
      );
    }
    expect(corrupt).toBe(0);
  }, 180_000);

  test("3 — 50 partner support tickets", async () => {
    if (skipIfNoDb()) return;
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      const t = await supportTicketService.create(
        ctx.vendorUserId,
        {
          subject: `Soak partner ticket ${i} ${RUN_ID}`,
          description: `Adversarial soak ticket body ${i} — minimum length met`,
          category: "Payout",
          priorityLevel: i % 3 === 0 ? "high" : "normal",
        },
        { providerId: ctx.providerId },
      );
      ids.push(t.id);
    }
    const listed = await supportTicketService.listForUser(ctx.vendorUserId, { limit: "60" }, ctx.providerId);
    const found = ids.filter((id) => listed.tickets.some((t) => t.id === id)).length;
    const pass = ids.length === 50 && found === 50;
    record(
      "50 Partner Support Tickets",
      pass ? "PASS" : "FAIL",
      `created=${ids.length} visible=${found}`,
      { created: ids.length, visible: found },
    );
    expect(found).toBe(50);
  }, 240_000);

  test("4 — 50 admin replies + customer/partner visibility", async () => {
    if (skipIfNoDb()) return;
    const customerTicket = await supportTicketService.create(ctx.customerA.id, {
      subject: `Soak customer ${RUN_ID}`,
      description: "Customer soak ticket for admin reply chain verification",
      category: "Billing",
    });
    const partnerTicket = await supportTicketService.create(
      ctx.vendorUserId,
      {
        subject: `Soak partner reply ${RUN_ID}`,
        description: "Partner soak ticket for admin reply chain verification",
        category: "Account",
      },
      { providerId: ctx.providerId },
    );

    const ticketIds = [customerTicket.id, partnerTicket.id];
    for (let i = 2; i < 50; i++) {
      const t = await supportTicketService.create(ctx.customerA.id, {
        subject: `Soak bulk ${i} ${RUN_ID}`,
        description: `Bulk admin reply soak ticket number ${i} for certification`,
        category: "Other",
      });
      ticketIds.push(t.id);
    }

    let replies = 0;
    for (const id of ticketIds) {
      const r = await supportTicketService.adminRespond(
        id,
        ctx.supportAdmin.id,
        `Admin soak reply ${RUN_ID} for ticket ${id.slice(-6)}`,
      );
      if (r) replies++;
    }

    const custView = await supportTicketService.getForUser(customerTicket.id, ctx.customerA.id);
    const partnerView = await supportTicketService.getForUser(
      partnerTicket.id,
      ctx.vendorUserId,
      ctx.providerId,
    );
    const custAdminMsg = custView?.messages.some((m) => m.authorRole === "admin") ?? false;
    const partnerAdminMsg = partnerView?.messages.some((m) => m.authorRole === "admin") ?? false;

    const pass = replies === 50 && custAdminMsg && partnerAdminMsg;
    record(
      "50 Admin Replies",
      pass ? "PASS" : "FAIL",
      `replies=${replies}/50 customerSeesAdmin=${custAdminMsg} partnerSeesAdmin=${partnerAdminMsg}`,
      { replies, custAdminMsg: custAdminMsg ? 1 : 0, partnerAdminMsg: partnerAdminMsg ? 1 : 0 },
    );
    record(
      "chain: Customer → Ticket → Admin Reply → Customer View",
      custAdminMsg ? "PASS" : "FAIL",
      custAdminMsg ? "admin message in customer thread" : "admin message missing",
    );
    record(
      "chain: Partner → Ticket → Admin Reply → Partner View",
      partnerAdminMsg ? "PASS" : "FAIL",
      partnerAdminMsg ? "admin message in partner thread" : "admin message missing",
    );
    expect(replies).toBe(50);
    expect(custAdminMsg).toBe(true);
    expect(partnerAdminMsg).toBe(true);
  }, 360_000);

  test("5 — 50 ticket escalations", async () => {
    if (skipIfNoDb()) return;
    const ids: string[] = [];
    let createErrors = 0;
    for (let i = 0; i < 50; i++) {
      try {
        const t = await supportTicketService.create(ctx.customerA.id, {
          subject: `Escalate soak ${i} ${RUN_ID}`,
          description: "Ticket for escalation soak — adversarial certification run",
          category: "Urgent",
        });
        ids.push(t.id);
      } catch {
        createErrors++;
      }
    }
    let escalated = 0;
    for (const id of ids) {
      const r = await supportTicketService.adminEscalate(id, ctx.supportAdmin.id, `Escalate ${RUN_ID}`);
      if (r) escalated++;
    }
    const high = await prisma.supportTicket.count({
      where: { id: { in: ids }, priorityLevel: "HIGH" },
    });
    const pass = ids.length === 50 && escalated === 50 && high === 50;
    record(
      "50 Ticket Escalations",
      pass ? "PASS" : "FAIL",
      `created=${ids.length}/50 createErrors=${createErrors} escalated=${escalated} priorityHigh=${high}`,
      { created: ids.length, createErrors, escalated, high },
    );
    if (createErrors > 0) {
      record(
        "ADVERSARIAL: ticket_number collision under burst create",
        "FAIL",
        `${createErrors} P2002 unique constraint failures on ticket_number`,
      );
    }
    expect(pass).toBe(true);
  }, 240_000);

  test("5b — concurrent ticket create: one number per ticket, no P2002 leak", async () => {
    if (skipIfNoDb()) return;
    const settled = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        supportTicketService.create(ctx.customerA.id, {
          subject: `Concurrent soak ${i} ${RUN_ID}`,
          description: "Concurrent ticket_number certification",
          category: "Urgent",
        }),
      ),
    );
    const ok = settled.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<{ id: string; ticketNumber: string }>).value);
    const failed = settled.filter((r) => r.status === "rejected");
    const numbers = ok.map((t) => t.ticketNumber);
    const unique = new Set(numbers);
    record(
      "Concurrent ticket create",
      ok.length === 20 && unique.size === 20 && failed.length === 0 ? "PASS" : "FAIL",
      `created=${ok.length}/20 uniqueNumbers=${unique.size} rejected=${failed.length}`,
      { created: ok.length, unique: unique.size, rejected: failed.length },
    );
    expect(failed.length).toBe(0);
    expect(ok.length).toBe(20);
    expect(unique.size).toBe(20);
  }, 60_000);

  test("6 — 50 membership coupon applications (quote + booking discount)", async () => {
    if (skipIfNoDb()) return;
    if (!soakCouponCode) throw new Error("coupon missing");
    await readyProvider();

    let quotesOk = 0;
    for (let i = 0; i < 50; i++) {
      const q = await bookingPricingService.quote({
        userId: ctx.customerA.id,
        serviceId: ctx.serviceId,
        couponCode: soakCouponCode,
      });
      if (q.ok && q.breakdown.campaignDiscount > 0) quotesOk++;
    }

    let bookingsOk = 0;
    for (let i = 0; i < 10; i++) {
      const slot = soakSlot(520 + i * 12);
      const created = await bookingService.create(ctx.customerA.id, {
        serviceId: ctx.serviceId,
        providerId: ctx.providerId,
        scheduledDate: slot.toISOString(),
        addressId: ctx.addressAId,
        couponCode: soakCouponCode,
      });
      if ("booking" in created && created.booking) {
        const row = await prisma.booking.findUnique({ where: { id: created.booking.id } });
        if (row && row.campaignDiscount > 0) bookingsOk++;
      }
    }

    const redemptions = await prisma.membershipCouponRedemption.count({
      where: { couponId: soakCouponId!, userId: ctx.customerA.id },
    });

    const pass = quotesOk === 50 && bookingsOk >= 9 && redemptions >= 9;
    record(
      "50 Membership Coupon Applications",
      pass ? "PASS" : "FAIL",
      `quotesWithDiscount=${quotesOk}/50 bookingsDiscounted=${bookingsOk}/10 redemptions=${redemptions}`,
      { quotesOk, bookingsOk, redemptions },
    );
    record(
      "chain: Membership Coupon → Checkout → Discount → Payment",
      bookingsOk >= 9 ? "PASS" : "FAIL",
      `${bookingsOk}/10 bookings created with campaignDiscount > 0`,
    );
    record(
      "chain: Membership Coupon → Invoice",
      "NOT PROVEN",
      "Invoice generation not asserted in soak run (no invoice row check)",
    );
    expect(quotesOk).toBe(50);
    expect(bookingsOk).toBeGreaterThanOrEqual(9);
  }, 180_000);

  test("7 — 50 partner settings updates", async () => {
    if (skipIfNoDb()) return;
    let ok = 0;
    for (let i = 0; i < 50; i++) {
      const start = `${String(7 + (i % 3)).padStart(2, "0")}:00`;
      const end = `${String(18 + (i % 2)).padStart(2, "0")}:00`;
      const r = await providerService.updateSettings(ctx.providerId, {
        workingHoursStart: start,
        workingHoursEnd: end,
        workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri"].slice(0, 3 + (i % 3)),
        paymentMethodPreference: i % 2 === 0 ? "upi" : "bank_transfer",
        upiId: `soak-${RUN_ID}-${i}@upi`,
      });
      if (r && r.workingHoursStart === start) ok++;
    }
    const me = await providerService.me(ctx.providerId);
    const pass = ok === 50;
    record(
      "50 Settings Updates",
      pass ? "PASS" : "FAIL",
      `${ok}/50 updates persisted; final hours ${me?.workingHoursStart}-${me?.workingHoursEnd}`,
      { ok },
    );
    expect(ok).toBe(50);
    // Restore a full working window so later soak cases are not blocked by the last
    // of the 50 settings writes (narrow days/hours are leftover test state, not product).
    // Restore the exact beforeAll window (00:00-23:59). A narrower restore made later
    // soak cases wall-clock dependent: soakSlot(320) lands at a different hour-of-day on
    // every run, so a 06:00-23:00 window intermittently rejected the seed booking with
    // BOOKING_DETAILS_INVALID -> VALIDATION_ERROR.
    await providerService.updateSettings(ctx.providerId, {
      workingHoursStart: "00:00",
      workingHoursEnd: "23:59",
      workingDays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      paymentMethodPreference: "upi",
      upiId: `soak-${RUN_ID}-restore@upi`,
    });
  }, 120_000);

  test("8 — WebSocket delivery to connected partner", async () => {
    if (skipIfNoDb()) return;
    const received: string[] = [];
    const conn: WSConnection = {
      userId: ctx.vendorUserId,
      userType: "vendor",
      connectionId: `soak-ws-${RUN_ID}`,
      connectedAt: new Date(),
      lastPing: new Date(),
      rooms: new Set(),
      send: (msg: string) => {
        received.push(msg);
      },
    };
    roomManager.addToRoom(`user:${ctx.vendorUserId}`, conn);

    pushToUser(
      ctx.vendorUserId,
      {
        eventId: `evt-${RUN_ID}`,
        timestamp: new Date().toISOString(),
        type: "notification.created",
        title: "Soak WS test",
        message: "WebSocket delivery certification",
      },
    );

    const pass = received.length >= 1;
    record(
      "WebSocket Delivery",
      pass ? "PASS" : "FAIL",
      pass ? `${received.length} message(s) delivered to mock WS connection` : "no WS payload received",
      { delivered: received.length },
    );
    roomManager.removeAllRooms(conn);
    expect(received.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  test("9 — HTTP chain: reschedule → partner notification → admin booking list", async () => {
    if (skipIfNoDb()) return;
    await readyProvider();
    const { id } = await seedAcceptedBooking(320);
    const newSlot = soakSlot(322);

    const beforeNotif = await prisma.notification.count({
      where: { userId: ctx.vendorUserId, title: "Booking rescheduled" },
    });

    const putRes = await app.handle(
      new Request(`http://localhost/api/bookings/${id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${bearer(ctx.customerA)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scheduledDate: newSlot.toISOString() }),
      }),
    );
    expect(putRes.status).toBe(200);

    const afterNotif = await prisma.notification.count({
      where: { userId: ctx.vendorUserId, title: "Booking rescheduled" },
    });

    const adminRes = await app.handle(
      new Request(`http://localhost/api/admin/bookings?search=${id}&limit=5`, {
        headers: { Authorization: `Bearer ${bearer(ctx.superAdmin)}` },
      }),
    );
    const adminJson = (await adminRes.json()) as {
      success: boolean;
      data?: { bookings?: Array<{ id: string; scheduledDate: string }> };
    };
    const adminSees =
      adminRes.status === 200 &&
      adminJson.data?.bookings?.some((b) => b.id === id) === true;

    const row = await prisma.booking.findUniqueOrThrow({ where: { id } });
    const slotOk = Math.abs(row.scheduledDate.getTime() - newSlot.getTime()) < 60_000;
    const notifOk = afterNotif > beforeNotif;

    const pass = putRes.ok && slotOk && notifOk && adminSees;
    record(
      "chain: Customer → Reschedule → Partner Notification → Admin Visibility",
      pass ? "PASS" : "FAIL",
      `http=${putRes.status} slotOk=${slotOk} notifDelta=${afterNotif - beforeNotif} adminSees=${adminSees}`,
    );
    expect(slotOk).toBe(true);
    expect(notifOk).toBe(true);
  }, 60_000);

  test("10 — HTTP chain: customer support ticket via API", async () => {
    if (skipIfNoDb()) return;
    const createRes = await app.handle(
      new Request("http://localhost/api/support/tickets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer(ctx.customerA)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subject: `HTTP soak ${RUN_ID}`,
          description: "HTTP adversarial support ticket create and admin respond chain",
          category: "Billing",
        }),
      }),
    );
    const created = (await createRes.json()) as { success: boolean; data?: { ticket?: { id: string } } };
    expect(createRes.status).toBe(200);
    const ticketId = created.data?.ticket?.id;
    expect(ticketId).toBeTruthy();

    await supportTicketService.adminRespond(ticketId!, ctx.supportAdmin.id, "HTTP soak admin reply");

    const viewRes = await app.handle(
      new Request(`http://localhost/api/support/tickets/${ticketId}`, {
        headers: { Authorization: `Bearer ${bearer(ctx.customerA)}` },
      }),
    );
    const view = (await viewRes.json()) as {
      data?: { ticket?: { messages?: Array<{ authorRole: string }> } };
    };
    const seesAdmin = view.data?.ticket?.messages?.some((m) => m.authorRole === "admin") ?? false;
    record(
      "HTTP Customer support ticket chain",
      seesAdmin ? "PASS" : "FAIL",
      seesAdmin ? "customer API shows admin reply" : "admin reply not visible",
    );
    expect(seesAdmin).toBe(true);
  }, 60_000);

  test("11 — Playwright E2E (external)", async () => {
    record(
      "Playwright End-to-End",
      "NOT PROVEN",
      "Deferred to separate playwright run (see certification doc appendix)",
    );
  });
});
