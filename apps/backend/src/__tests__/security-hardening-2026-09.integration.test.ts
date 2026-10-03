import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import app from "../index";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  fixturePhone,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
  payWithRealWallet,
} from "./helpers/adversarial-fixtures";
import { OTPService } from "../services/otp.service";
import { partnerLifecycleService } from "../services/partner-lifecycle.service";
import { partnerSafetyService } from "../services/partner-safety.service";
import { rbacService } from "../services/rbac.service";
import { BookingStatus, PaymentStatus } from "@prisma/client";

/**
 * Clear the anti-flood gates in front of `sendOTP` before using it as a PRECONDITION.
 *
 * `otpService.sendOTP` is guarded twice — an atomic Redis limiter keyed on the phone hash, and a
 * count of unused OTPs for that phone in the last hour. Both are real controls and neither is what
 * these cases are testing: every one of them uses an OTP merely to reach the identity check that
 * follows.
 *
 * Under a full-suite run those gates trip, `sendOTP` returns `success: false`, and the case fails on
 * its FIRST line — so the security assertion underneath it never executes and the suite reports a
 * red security test for a rate limiter doing its job. A security suite that cries wolf is one people
 * learn to scroll past, which is the opposite of what it is for.
 */
async function clearOtpGates(phoneNumber: string) {
  const { userPiiService } = await import("../services/user-pii.service");
  const { resetRateLimitSmart } = await import("../middleware/rate-limit.middleware");
  const phoneHash = userPiiService.hashPhone(phoneNumber);
  await resetRateLimitSmart(`otp:send:${phoneHash}`).catch(() => undefined);
  await prisma.oTP.deleteMany({ where: { OR: [{ phoneHash }, { phoneNumber }] } }).catch(() => undefined);
}

/**
 * Negative tests for the controls hardened on 2026-09-15. Every case is a deliberate violation
 * that must be refused; the positive twin proves the legitimate path still works.
 */
const RUN = `sec-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let reachable = false;
const otpService = new OTPService(prisma);

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

beforeAll(async () => {
  reachable = await dbReachable();
  if (!reachable) return;
  ctx = await seedAdversarialFixtures(RUN);
}, 60_000);
afterAll(async () => {
  if (!reachable) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe("verify-otp binds the proven phone to the session user", () => {
  it("refuses to mint a session for another account named by email", async () => {
    if (!reachable) return;
    const attackerPhone = fixturePhone(RUN, "a"); // customerA's phone
    await clearOtpGates(attackerPhone);
    const sent = await otpService.sendOTP(attackerPhone);
    expect(sent.success).toBe(true);
    const otp = (sent as { devOtp?: string }).devOtp;
    expect(typeof otp).toBe("string");

    // customerB is the victim: their email, the attacker's proven phone + code.
    const res = await post("/api/auth/verify-otp", {
      phoneNumber: attackerPhone,
      otp,
      email: `adv-${RUN}-b@adv.test`,
      login: true,
      setAuthCookies: false,
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string; data?: unknown };
    expect(body.code).toBe("OTP_IDENTITY_MISMATCH");
    expect(body.data).toBeUndefined();

    const victim = await prisma.user.findUniqueOrThrow({ where: { id: ctx.customerB.id } });
    // The old code also flipped the victim's phone verification as a side effect.
    expect(victim.isPhoneVerified).toBe(true); // fixture already verified — must not be touched either way
  });

  it("refuses to mint a session for another account named by userId", async () => {
    if (!reachable) return;
    const attackerPhone = fixturePhone(RUN, "a");
    await clearOtpGates(attackerPhone);
    const sent = await otpService.sendOTP(attackerPhone);
    const otp = (sent as { devOtp?: string }).devOtp!;
    const res = await post("/api/auth/verify-otp", { phoneNumber: attackerPhone, otp, userId: ctx.customerB.id, login: true, setAuthCookies: false });
    expect(res.status).toBe(403);
  });

  it("send-otp ignores a client-supplied userId when binding the OTP row", async () => {
    if (!reachable) return;
    const attackerPhone = fixturePhone(RUN, "a");
    const res = await post("/api/auth/send-otp", { phoneNumber: attackerPhone, userId: ctx.customerB.id });
    expect(res.status).toBe(200);
    const row = await prisma.oTP.findFirst({ where: { phoneNumber: attackerPhone }, orderBy: { createdAt: "desc" } });
    expect(row?.userId === ctx.customerB.id).toBe(false);
  });

  it("still logs in the account that actually owns the phone", async () => {
    if (!reachable) return;
    const phone = fixturePhone(RUN, "a");
    await clearOtpGates(phone);
    const sent = await otpService.sendOTP(phone);
    const otp = (sent as { devOtp?: string }).devOtp!;
    const res = await post("/api/auth/verify-otp", { phoneNumber: phone, otp, login: true, setAuthCookies: false });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { userId?: string; accessToken?: string } };
    expect(body.data?.userId).toBe(ctx.customerA.id);
    expect(typeof body.data?.accessToken).toBe("string");
  });

  it("customer login creates an account for a new verified phone", async () => {
    if (!reachable) return;
    const phone = `+9198${`${Date.now()}`.slice(-8)}`;
    await clearOtpGates(phone);
    const sent = await otpService.sendOTP(phone);
    const otp = (sent as { devOtp?: string }).devOtp;
    expect(typeof otp).toBe("string");
    const res = await post(
      "/api/auth/verify-otp",
      { phoneNumber: phone, otp, login: true, setAuthCookies: false },
      { "X-Homigo-Audience": "customer" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { userId?: string; accessToken?: string; user?: { isPhoneVerified?: boolean } } };
    expect(typeof body.data?.userId).toBe("string");
    expect(typeof body.data?.accessToken).toBe("string");
    expect(body.data?.user?.isPhoneVerified).toBe(true);
    const created = await prisma.user.findUnique({ where: { id: body.data!.userId! } });
    expect(created?.role).toBe("CUSTOMER");
    await prisma.refreshToken.deleteMany({ where: { userId: created!.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: created!.id } }).catch(() => undefined);
  });
});

describe("partner lifecycle: partners can only pause/resume themselves", () => {
  it("a partner UNDER_REVIEW cannot resume to ACTIVE; an admin can", async () => {
    if (!reachable) return;
    await prisma.provider.update({ where: { id: ctx.providerId }, data: { lifecycleState: "UNDER_REVIEW" } });

    const asPartner = await partnerLifecycleService.transition({
      providerId: ctx.providerId,
      to: "ACTIVE",
      actorType: "PARTNER",
      actorId: ctx.providerId,
      reasonCode: "PARTNER_REQUEST",
      reasonText: "self resume",
    });
    expect("error" in asPartner && asPartner.error).toBe("FORBIDDEN_FOR_ACTOR");
    const still = await prisma.provider.findUniqueOrThrow({ where: { id: ctx.providerId }, select: { lifecycleState: true } });
    expect(still.lifecycleState).toBe("UNDER_REVIEW");

    const asAdmin = await partnerLifecycleService.transition({
      providerId: ctx.providerId,
      to: "ACTIVE",
      actorType: "ADMIN",
      actorId: ctx.superAdmin.id,
      reasonCode: "ADMIN_ACTION",
      reasonText: "cleared",
    });
    expect("error" in asAdmin && asAdmin.error).toBeFalsy();
    const after = await prisma.provider.findUniqueOrThrow({ where: { id: ctx.providerId }, select: { lifecycleState: true } });
    expect(after.lifecycleState).toBe("ACTIVE");
  });

  it("ACTIVE ↔ PAUSED self-service still works", async () => {
    if (!reachable) return;
    const pause = await partnerLifecycleService.transition({
      providerId: ctx.providerId, to: "PAUSED", actorType: "PARTNER", actorId: ctx.providerId, reasonCode: "PARTNER_REQUEST", reasonText: "break",
    });
    expect("error" in pause && pause.error).toBeFalsy();
    const resume = await partnerLifecycleService.transition({
      providerId: ctx.providerId, to: "ACTIVE", actorType: "PARTNER", actorId: ctx.providerId, reasonCode: "PARTNER_REQUEST", reasonText: "back",
    });
    expect("error" in resume && resume.error).toBeFalsy();
  });
});

describe("admin role grants", () => {
  it("nobody can grant a role to themselves, even a SUPER_ADMIN", async () => {
    if (!reachable) return;
    const superCtx = await rbacService.resolveAdminContext(ctx.superAdmin.id);
    expect(superCtx).not.toBeNull();
    const role = await prisma.adminRole.findFirstOrThrow({ where: { name: "SUPER_ADMIN" } });
    await expect(rbacService.grantRole(superCtx!, ctx.superAdmin.id, role.id)).rejects.toThrow("SELF_GRANT_FORBIDDEN");
  });

  it("a non-super admin cannot grant SUPER_ADMIN", async () => {
    if (!reachable) return;
    const financeCtx = await rbacService.resolveAdminContext(ctx.financeAdmin.id);
    expect(financeCtx).not.toBeNull();
    const role = await prisma.adminRole.findFirstOrThrow({ where: { name: "SUPER_ADMIN" } });
    // Either the permission gate (ADMIN_USERS/CREATE) or the escalation guard must refuse.
    await expect(rbacService.grantRole(financeCtx!, ctx.supportAdmin.id, role.id)).rejects.toThrow();
    const support = await prisma.adminUser.findFirst({ where: { userId: ctx.supportAdmin.id }, include: { role: true } });
    expect(support?.role.name === "SUPER_ADMIN").toBe(false);
  });

  it("only a SUPER_ADMIN may revoke a SUPER_ADMIN", async () => {
    if (!reachable) return;
    const superCtx = await rbacService.resolveAdminContext(ctx.superAdmin.id);
    const superRole = await prisma.adminRole.findFirstOrThrow({ where: { name: "SUPER_ADMIN" } });
    await prisma.user.update({ where: { id: ctx.customerB.id }, data: { role: "ADMIN" } });
    await rbacService.grantRole(superCtx!, ctx.customerB.id, superRole.id);
    const target = await prisma.adminUser.findFirstOrThrow({ where: { userId: ctx.customerB.id } });

    // Same permissions as a super (so ADMIN_USERS/DELETE passes), but not a SUPER_ADMIN by role.
    const impostor = { ...superCtx!, role: "OPERATIONS_ADMIN" as const };
    // Refused by the permission gate or, behind it, by the SUPER_ADMIN role guard — never allowed.
    await expect(rbacService.revokeRole(impostor, target.id)).rejects.toThrow(/Permission denied|SUPER_ADMIN_REVOKE_REQUIRES_SUPER_ADMIN/);
    expect((await prisma.adminUser.findUniqueOrThrow({ where: { id: target.id } })).isActive).toBe(true);

    await rbacService.revokeRole(superCtx!, target.id);
    expect((await prisma.adminUser.findUniqueOrThrow({ where: { id: target.id } })).isActive).toBe(false);
  });
});

describe("partner safety report cannot be attached to someone else's booking", () => {
  it("drops a foreign bookingId instead of persisting it", async () => {
    if (!reachable) return;
    // A booking that belongs to a different (non-existent-here) provider.
    const foreign = await prisma.booking.create({
      data: {
        bookingNumber: `SEC-${RUN}-F`,
        userId: ctx.customerB.id,
        providerId: null,
        serviceId: ctx.serviceId,
        addressId: ctx.addressBId,
        status: BookingStatus.PENDING,
        scheduledDate: new Date(Date.now() + 5 * 86_400_000),
        baseAmount: 500,
        finalAmount: 500,
        totalAmount: 500,
        paymentStatus: PaymentStatus.PENDING,
      },
    });
    // Paid through the real wallet checkout, not a hand-set "wallet" payment status.
    await payWithRealWallet(foreign.id, ctx.customerB.id);
    const incident = await partnerSafetyService.reportIssue({
      providerId: ctx.providerId,
      userId: ctx.vendorUserId,
      type: "THREAT",
      bookingId: foreign.id,
      notes: "not my booking",
    });
    const row = await prisma.partnerSafetyIncident.findFirstOrThrow({ where: { id: incident.id } });
    expect(row.bookingId).toBeNull();
  });
});
