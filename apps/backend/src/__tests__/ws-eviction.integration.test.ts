import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { AssignmentJobStatus, BookingStatus, PaymentStatus } from "@prisma/client";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
  payWithRealWallet,
} from "./helpers/adversarial-fixtures";
import { roomManager, WS_CLOSE_FORBIDDEN, WS_CLOSE_UNAUTHORIZED, type WSConnection } from "../lib/websocket";
import { partnerLifecycleService } from "../services/partner-lifecycle.service";
import { tokenRevocationService } from "../services/token-revocation.service";
import { rbacService } from "../services/rbac.service";
import { assignmentEngine } from "../services/assignment-engine.service";

/**
 * A socket admitted at T0 must lose its rooms when the grant behind it is withdrawn. Each case opens
 * a fake connection exactly as a route would (userId + close handle), fires the real state transition,
 * and asserts the socket was closed with the code the clients act on.
 */
const RUN = `wsev-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let reachable = false;

function fakeConn(userId: string, rooms: string[]) {
  const closed: Array<{ code: number; reason: string }> = [];
  const c: WSConnection = {
    userId,
    userType: "vendor",
    connectionId: `c_${RUN}_${Math.random().toString(36).slice(2)}`,
    connectedAt: new Date(),
    lastPing: new Date(),
    rooms: new Set(),
    jti: `jti_${Math.random().toString(36).slice(2)}`,
    send: () => undefined,
    close: (code, reason) => closed.push({ code, reason }),
  };
  for (const r of rooms) roomManager.addToRoom(r, c);
  return { c, closed };
}
const settle = () => new Promise((r) => setTimeout(r, 150));

beforeAll(async () => {
  reachable = await dbReachable();
  if (!reachable) return;
  ctx = await seedAdversarialFixtures(RUN);
}, 60_000);
afterAll(async () => {
  if (!reachable) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe("live sockets follow authorization", () => {
  it("a rejected offer drops the partner from the booking rooms but keeps their notifications socket", async () => {
    if (!reachable) return;
    const booking = await prisma.booking.create({
      data: {
        bookingNumber: `WSEV-${RUN}-rej`,
        userId: ctx.customerA.id,
        providerId: ctx.providerId,
        serviceId: ctx.serviceId,
        addressId: ctx.addressAId,
        status: BookingStatus.PENDING,
        scheduledDate: new Date(Date.now() + 2 * 86_400_000),
        baseAmount: 500,
        finalAmount: 500,
        totalAmount: 500,
        paymentStatus: PaymentStatus.PENDING,
      },
    });
    // Paid through the real wallet checkout, not a hand-set "wallet" payment status.
    await payWithRealWallet(booking.id, ctx.customerA.id);
    await prisma.assignmentJob.create({
      data: { bookingId: booking.id, status: AssignmentJobStatus.PENDING, currentProviderId: ctx.providerId },
    });
    const bookingSock = fakeConn(ctx.vendorUserId, [`booking:${booking.id}`]);
    const trackingSock = fakeConn(ctx.vendorUserId, [`tracking:${booking.id}`]);
    const notifSock = fakeConn(ctx.vendorUserId, [`user:${ctx.vendorUserId}`]);
    const customerSock = fakeConn(ctx.customerA.id, [`booking:${booking.id}`]);

    await assignmentEngine.onProviderRejected(booking.id, ctx.providerId, "busy");
    await settle();

    expect(bookingSock.closed).toEqual([{ code: WS_CLOSE_FORBIDDEN, reason: "offer_rejected" }]);
    expect(trackingSock.closed).toEqual([{ code: WS_CLOSE_FORBIDDEN, reason: "offer_rejected" }]);
    expect(notifSock.closed).toEqual([]);
    expect(customerSock.closed).toEqual([]);
    expect(roomManager.getRoom(`booking:${booking.id}`).has(customerSock.c)).toBe(true);
    roomManager.removeAllRooms(notifSock.c);
    roomManager.removeAllRooms(customerSock.c);
  });

  it("suspension closes every socket of the partner; review alone does not", async () => {
    if (!reachable) return;
    const a = fakeConn(ctx.vendorUserId, [`user:${ctx.vendorUserId}`]);
    const b = fakeConn(ctx.vendorUserId, [`earnings:${ctx.providerId}`]);

    const review = await partnerLifecycleService.transition({
      providerId: ctx.providerId, to: "UNDER_REVIEW", actorType: "ADMIN", actorId: ctx.superAdmin.id, reasonCode: "ADMIN_ACTION", reasonText: "check",
    });
    expect("error" in review && review.error).toBeFalsy();
    expect(a.closed).toEqual([]);

    const suspend = await partnerLifecycleService.transition({
      providerId: ctx.providerId, to: "SUSPENDED", actorType: "ADMIN", actorId: ctx.superAdmin.id, reasonCode: "ADMIN_ACTION", reasonText: "fraud",
    });
    expect("error" in suspend && suspend.error).toBeFalsy();
    expect(a.closed).toEqual([{ code: WS_CLOSE_FORBIDDEN, reason: "partner_suspended" }]);
    expect(b.closed).toEqual([{ code: WS_CLOSE_FORBIDDEN, reason: "partner_suspended" }]);
    expect(roomManager.getUserConnections(ctx.vendorUserId).size).toBe(0);
  });

  it("revoking all tokens closes the user's sockets with 4401 so clients re-authenticate", async () => {
    if (!reachable) return;
    const s = fakeConn(ctx.customerA.id, [`user:${ctx.customerA.id}`]);
    await tokenRevocationService.revokeAllUserTokens(ctx.customerA.id, "MANUAL_REVOCATION", ctx.customerA.id);
    expect(s.closed).toEqual([{ code: WS_CLOSE_UNAUTHORIZED, reason: "session_revoked" }]);
  });

  it("an admin role grant closes the target's sockets so admin rooms are re-evaluated on reconnect", async () => {
    if (!reachable) return;
    const superCtx = await rbacService.resolveAdminContext(ctx.superAdmin.id);
    expect(superCtx).not.toBeNull();
    const financeRole = await prisma.adminRole.findUniqueOrThrow({ where: { name: "FINANCE_ADMIN" } });
    const s = fakeConn(ctx.supportAdmin.id, [`user:${ctx.supportAdmin.id}`, "admin:notifications"]);
    await rbacService.grantRole(superCtx!, ctx.supportAdmin.id, financeRole.id);
    expect(s.closed).toEqual([{ code: WS_CLOSE_FORBIDDEN, reason: "role_changed" }]);
    expect(roomManager.getRoom("admin:notifications").has(s.c)).toBe(false);
  });
});
