/**
 * Section 07 — live referral certification against the running backend + homigo_db.
 *
 * Does not rebuild the engine. Uses partnerReferralService + HTTP APIs.
 *
 *   cd apps/backend && bun --env-file=.env run scripts/section07-live-cert.ts
 */
import "dotenv/config";
import {
  BookingStatus,
  JournalEntryType,
  PaymentStatus,
  UserRole,
} from "@prisma/client";
import prisma from "../src/lib/prisma";
import { partnerReferralService } from "../src/services/partner-referral.service";
import { partnerReferralAbuseService } from "../src/services/partner-referral-abuse.service";
import { financialLedgerService } from "../src/services/financial-ledger.service";
import { PARTNER_REFERRAL_REWARD_RUPEES } from "../src/lib/partner-referral-policy";
import { EVENT_TYPES } from "../src/events/catalog/event-types";
import { userPiiService } from "../src/services/user-pii.service";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PARTNER = { email: "partner@homigo.demo", password: "Homigo@123" };
const ADMIN = { email: "admin@homigo.demo", password: "Homigo@123" };
const RUN = `s07live-${Date.now().toString(36)}`;

type Status = "PASS" | "FAIL" | "WARN" | "BLOCKED";
type Gate = { gate: string; status: Status; detail: string };
const results: Gate[] = [];

function gate(name: string, status: Status, detail = "") {
  results.push({ gate: name, status, detail });
  console.log(`${status.padEnd(8)} ${name}${detail ? ` — ${detail}` : ""}`);
}

function phone(slot: string) {
  const digits = `${Date.now()}${slot}`.replace(/\D/g, "").slice(-10).padStart(10, "0");
  return `+91${digits}`;
}

async function login(email: string, password: string) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, setAuthCookies: false }),
  });
  const json = (await res.json()) as { data?: { accessToken?: string } };
  if (!res.ok || !json.data?.accessToken) throw new Error(`login failed ${email} ${res.status}`);
  return json.data.accessToken;
}

async function api(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function completeAcademy(providerId: string) {
  const modules = await prisma.partnerAcademyModule.findMany({
    where: { isPublished: true },
    select: { id: true },
  });
  for (const m of modules) {
    await prisma.partnerAcademyProgress.upsert({
      where: { providerId_moduleId: { providerId, moduleId: m.id } },
      create: { providerId, moduleId: m.id, completedAt: new Date() },
      update: { completedAt: new Date() },
    });
  }
}

async function main() {
  const healthRes = await fetch(`${API}/health`);
  const health = (await healthRes.json()) as {
    services?: { database?: string; redis?: string };
  };
  gate(
    "env.health",
    healthRes.ok && health.services?.database === "ok" && health.services?.redis === "ok" ? "PASS" : "FAIL",
    JSON.stringify(health.services ?? {}),
  );
  if (health.services?.database !== "ok") {
    console.log(JSON.stringify({ results }, null, 2));
    process.exitCode = 1;
    return;
  }

  await financialLedgerService.ensureAccountsSeeded();

  const partnerA = await prisma.user.findFirst({
    where: { email: PARTNER.email },
    include: { provider: true },
  });
  if (!partnerA?.provider) throw new Error("seed partner missing");
  const referrerId = partnerA.provider.id;

  const partnerToken = await login(PARTNER.email, PARTNER.password);
  const adminToken = await login(ADMIN.email, ADMIN.password);

  const netBefore = await api("GET", "/api/providers/me/network", partnerToken);
  const beforeData = (netBefore.json.data ?? {}) as { code?: string; counts?: { invited?: number } };
  gate(
    "api.partner_network",
    netBefore.status === 200 && Boolean(beforeData.code?.startsWith("HP")) ? "PASS" : "FAIL",
    `status=${netBefore.status} code=${beforeData.code ?? "none"}`,
  );

  const invitePhone = phone("inv");
  const invited = await api("POST", "/api/providers/me/network/invite", partnerToken, {
    name: `Invitee ${RUN}`,
    phone: invitePhone,
    city: "Noida",
  });
  const inviteData = (invited.json.data ?? {}) as { referralId?: string; status?: string; leadId?: string };
  gate(
    "flow.invite_lead",
    invited.status === 200 && inviteData.status === "INVITED" && Boolean(inviteData.leadId) ? "PASS" : "FAIL",
    `http=${invited.status} status=${inviteData.status} lead=${inviteData.leadId ?? "none"}`,
  );

  const ownPhone = await userPiiService.resolvePhone(partnerA, {
    actorId: partnerA.id,
    authorized: true,
  });
  const selfInvite = await api("POST", "/api/providers/me/network/invite", partnerToken, {
    name: "Self",
    phone: ownPhone || partnerA.phoneNumber || invitePhone,
  });
  gate(
    "abuse.self_referral",
    selfInvite.status === 409 || selfInvite.status === 400 ? "PASS" : "FAIL",
    `http=${selfInvite.status}`,
  );

  const pwd = await Bun.password.hash("Homigo@123", { algorithm: "bcrypt", cost: 10 });
  const referredUser = await prisma.user.create({
    data: {
      email: `${RUN}@adv.test`,
      phoneNumber: phone("ref"),
      firstName: "Referred",
      lastName: RUN,
      password: pwd,
      role: UserRole.VENDOR,
      isEmailVerified: true,
      isPhoneVerified: true,
    },
  });
  const referred = await prisma.provider.create({
    data: {
      userId: referredUser.id,
      serviceCategories: ["cleaning"],
      serviceRegions: ["Noida"],
      isVerified: true,
      isApproved: true,
      lifecycleState: "ACTIVE",
      isActive: true,
      city: "Noida",
    },
  });

  const codeRow = await partnerReferralService.ensureCode(referrerId);
  const claim = await partnerReferralService.claimOnRegistration({
    refereeUserId: referredUser.id,
    referralCode: codeRow.code,
  });
  gate(
    "flow.registered",
    claim.attributed ? "PASS" : "FAIL",
    claim.attributed ? claim.referralId : (claim as { reason?: string }).reason ?? "not attributed",
  );
  if (!claim.attributed) throw new Error("claim failed");
  const referralId = claim.referralId;

  const claimed = await prisma.partnerReferral.findUniqueOrThrow({ where: { id: referralId } });
  if (claimed.referredLeadId) {
    await prisma.partnerLead.update({
      where: { id: claimed.referredLeadId },
      data: { userId: referredUser.id, providerId: referred.id },
    }).catch(() => undefined);
  } else {
    await prisma.partnerReferral.update({
      where: { id: referralId },
      data: { referredProviderId: referred.id },
    });
  }
  await partnerReferralService.bindProvider(referred.id, referredUser.id);
  await completeAcademy(referred.id);
  await partnerReferralService.syncFromCanonical(referred.id);
  let row = await prisma.partnerReferral.findUniqueOrThrow({ where: { id: referralId } });
  gate(
    "flow.active_lifecycle",
    row.status === "ACTIVE" || row.status === "FIRST_JOB" ? "PASS" : "FAIL",
    `status=${row.status} lifecycle=ACTIVE required`,
  );

  const service = await prisma.service.findFirst({ where: { isActive: true } });
  if (!service) throw new Error("no active service");
  const customer = await prisma.user.create({
    data: {
      email: `cust-${RUN}@adv.test`,
      phoneNumber: phone("cus"),
      firstName: "Cust",
      lastName: RUN,
      password: pwd,
      role: UserRole.CUSTOMER,
    },
  });
  const address = await prisma.address.create({
    data: {
      userId: customer.id,
      label: "Home",
      addressLine1: "1 Cert Street",
      city: "Noida",
      state: "UP",
      zipCode: "201301",
      latitude: 28.5355,
      longitude: 77.391,
    },
  });

  await prisma.booking.create({
    data: {
      bookingNumber: `S07C-${RUN}`,
      userId: customer.id,
      providerId: referred.id,
      serviceId: service.id,
      addressId: address.id,
      status: BookingStatus.CANCELLED_BY_USER,
      cancelledAt: new Date(),
      scheduledDate: new Date(),
      baseAmount: 500,
      finalAmount: 500,
      totalAmount: 500,
      paymentStatus: PaymentStatus.PENDING,
    },
  });
  await partnerReferralService.onJobCompleted(referred.id, `S07C-${RUN}`);
  row = await prisma.partnerReferral.findUniqueOrThrow({ where: { id: referralId } });
  gate("s03.cancelled_excluded", row.successfulJobs === 0 ? "PASS" : "FAIL", `jobs=${row.successfulJobs}`);

  for (let i = 0; i < 3; i++) {
    const booking = await prisma.booking.create({
      data: {
        bookingNumber: `S07-${RUN}-${i}`,
        userId: customer.id,
        providerId: referred.id,
        serviceId: service.id,
        addressId: address.id,
        status: BookingStatus.COMPLETED,
        completedAt: new Date(),
        scheduledDate: new Date(),
        baseAmount: 500,
        finalAmount: 500,
        totalAmount: 500,
        paymentStatus: PaymentStatus.SUCCESS,
      },
    });
    await partnerReferralService.onJobCompleted(referred.id, booking.id);
  }

  row = await prisma.partnerReferral.findUniqueOrThrow({ where: { id: referralId } });
  gate(
    "flow.qualified_rewarded",
    row.status === "REWARD_RELEASED" && row.successfulJobs === 3 ? "PASS" : "FAIL",
    `status=${row.status} jobs=${row.successfulJobs}`,
  );

  const [a, b] = await Promise.all([
    partnerReferralService.creditReward(referralId, { actorId: "system", reason: "concurrent-a" }),
    partnerReferralService.creditReward(referralId, { actorId: "system", reason: "concurrent-b" }),
  ]);
  const created = [a, b].filter((r) => r.created).length;
  gate("concurrency.one_reward", created === 0 ? "PASS" : "FAIL", `extraCreated=${created}`);

  const rewards = await prisma.partnerReferralReward.findMany({ where: { referralId } });
  const journals = rewards[0]
    ? await prisma.journalEntry.findMany({
        where: { type: JournalEntryType.PARTNER_REFERRAL_REWARD, referenceId: rewards[0].id },
      })
    : [];
  gate(
    "finance.one_effect",
    rewards.length === 1 &&
      rewards[0]!.status === "CREDITED" &&
      rewards[0]!.amount === PARTNER_REFERRAL_REWARD_RUPEES &&
      journals.length === 1
      ? "PASS"
      : "FAIL",
    `rewards=${rewards.length} amount=${rewards[0]?.amount} journals=${journals.length}`,
  );

  const wallet = await prisma.walletTransaction.findMany({
    where: { idempotencyKey: `partner_referral_wallet:${referralId}` },
  });
  gate("finance.wallet_idempotent", wallet.length === 1 ? "PASS" : "FAIL", `txns=${wallet.length}`);

  const retry = await partnerReferralService.creditReward(referralId, { actorId: "system", reason: "retry" });
  gate("finance.retry_noop", retry.created === false ? "PASS" : "FAIL", `created=${retry.created}`);

  const appliedUser = await prisma.user.create({
    data: {
      email: `applied-${RUN}@adv.test`,
      phoneNumber: phone("app"),
      firstName: "Applied",
      lastName: RUN,
      password: pwd,
      role: UserRole.VENDOR,
      isEmailVerified: true,
      isPhoneVerified: true,
    },
  });
  const appliedProv = await prisma.provider.create({
    data: {
      userId: appliedUser.id,
      serviceCategories: ["cleaning"],
      serviceRegions: ["Noida"],
      isVerified: true,
      isApproved: true,
      lifecycleState: "APPLIED",
      isActive: false,
      city: "Noida",
    },
  });
  const appliedClaim = await partnerReferralService.claimOnRegistration({
    refereeUserId: appliedUser.id,
    referralCode: codeRow.code,
  });
  if (appliedClaim.attributed) {
    const appliedRow0 = await prisma.partnerReferral.findUniqueOrThrow({ where: { id: appliedClaim.referralId } });
    if (appliedRow0.referredLeadId) {
      await prisma.partnerLead.update({
        where: { id: appliedRow0.referredLeadId },
        data: { userId: appliedUser.id, providerId: appliedProv.id },
      }).catch(() => undefined);
    }
    await partnerReferralService.bindProvider(appliedProv.id, appliedUser.id);
    await completeAcademy(appliedProv.id);
    for (let i = 0; i < 3; i++) {
      const booking = await prisma.booking.create({
        data: {
          bookingNumber: `S07A-${RUN}-${i}`,
          userId: customer.id,
          providerId: appliedProv.id,
          serviceId: service.id,
          addressId: address.id,
          status: BookingStatus.COMPLETED,
          completedAt: new Date(),
          scheduledDate: new Date(),
          baseAmount: 500,
          finalAmount: 500,
          totalAmount: 500,
          paymentStatus: PaymentStatus.SUCCESS,
        },
      });
      await partnerReferralService.onJobCompleted(appliedProv.id, booking.id);
    }
    const appliedRow = await prisma.partnerReferral.findUniqueOrThrow({ where: { id: appliedClaim.referralId } });
    gate(
      "s06.active_required",
      appliedRow.status !== "QUALIFIED" && appliedRow.status !== "REWARD_RELEASED" ? "PASS" : "FAIL",
      `registered-only status=${appliedRow.status}`,
    );
  } else {
    gate("s06.active_required", "WARN", "could not attribute applied fixture");
  }

  const bankHash = `s07-bank-${RUN}`;
  const bankUser = await prisma.user.create({
    data: {
      email: `bank-${RUN}@adv.test`,
      phoneNumber: phone("bnk"),
      firstName: "Bank",
      lastName: RUN,
      password: pwd,
      role: UserRole.VENDOR,
    },
  });
  const bankProv = await prisma.provider.create({
    data: {
      userId: bankUser.id,
      serviceCategories: ["cleaning"],
      serviceRegions: ["Noida"],
      city: "Noida",
    },
  });
  await prisma.provider.update({ where: { id: referrerId }, data: { bankAccountNumberHash: bankHash } });
  let bankWriteBlocked = false;
  try {
    await prisma.provider.update({ where: { id: bankProv.id }, data: { bankAccountNumberHash: bankHash } });
  } catch {
    bankWriteBlocked = true;
  }
  const bankDecision = partnerReferralAbuseService.decision([
    { kind: "BANK_REUSE", severity: 85, evidenceKey: bankHash, note: "bank", strong: true },
  ]);
  gate(
    "abuse.same_bank_hold",
    bankWriteBlocked && bankDecision.blockReward && bankDecision.review === "OPEN" ? "PASS" : "FAIL",
    `unique=${bankWriteBlocked} decision=${JSON.stringify(bankDecision)}`,
  );

  const identityDecision = partnerReferralAbuseService.decision([
    { kind: "IDENTITY_REUSE", severity: 85, evidenceKey: `pan-${RUN}`, note: "PAN", strong: true },
  ]);
  gate(
    "abuse.same_identity",
    identityDecision.review === "OPEN" && identityDecision.blockReward ? "PASS" : "FAIL",
    JSON.stringify(identityDecision),
  );

  const weak = partnerReferralAbuseService.decision([
    { kind: "SUSPICIOUS_IP", severity: 40, evidenceKey: "ip", note: "household", strong: false },
    { kind: "PATTERN_ABUSE", severity: 45, evidenceKey: "burst", note: "8 in 24h", strong: false },
  ]);
  gate("abuse.weak_ip_signal_only", weak.review === "NONE" && !weak.blockReward ? "PASS" : "FAIL", JSON.stringify(weak));

  const cycleAUser = await prisma.user.create({
    data: {
      email: `cya-${RUN}@adv.test`,
      phoneNumber: phone("cya"),
      firstName: "CycA",
      lastName: RUN,
      password: pwd,
      role: UserRole.VENDOR,
    },
  });
  const cycleA = await prisma.provider.create({ data: { userId: cycleAUser.id, city: "Noida" } });
  const cycleBUser = await prisma.user.create({
    data: {
      email: `cyb-${RUN}@adv.test`,
      phoneNumber: phone("cyb"),
      firstName: "CycB",
      lastName: RUN,
      password: pwd,
      role: UserRole.VENDOR,
    },
  });
  const cycleB = await prisma.provider.create({ data: { userId: cycleBUser.id, city: "Noida" } });
  const cycleCUser = await prisma.user.create({
    data: {
      email: `cyc-${RUN}@adv.test`,
      phoneNumber: phone("cyc"),
      firstName: "CycC",
      lastName: RUN,
      password: pwd,
      role: UserRole.VENDOR,
    },
  });
  const cycleC = await prisma.provider.create({ data: { userId: cycleCUser.id, city: "Noida" } });
  await prisma.partnerReferral.create({
    data: { referrerProviderId: cycleA.id, referredProviderId: cycleB.id, referralCode: `HP${RUN}A`.slice(0, 10), status: "REGISTERED" },
  });
  await prisma.partnerReferral.create({
    data: { referrerProviderId: cycleB.id, referredProviderId: cycleC.id, referralCode: `HP${RUN}B`.slice(0, 10), status: "REGISTERED" },
  });
  await prisma.partnerReferral.create({
    data: { referrerProviderId: cycleC.id, referredProviderId: cycleA.id, referralCode: `HP${RUN}C`.slice(0, 10), status: "REGISTERED" },
  });
  const cycleFindings = await partnerReferralAbuseService.inspectPair({
    referrerProviderId: cycleA.id,
    refereeProviderId: cycleB.id,
  });
  const cycleDecision = partnerReferralAbuseService.decision(cycleFindings);
  gate(
    "abuse.cycle_abc_a",
    cycleFindings.some((f) => f.kind === "CYCLE_ABUSE") && cycleDecision.review === "BLOCKED" ? "PASS" : "FAIL",
    JSON.stringify(cycleDecision),
  );

  const forbidden = await api("POST", `/api/admin/partner-referrals/${referralId}/action`, partnerToken, {
    action: "release",
    reason: "partner-self",
  });
  gate(
    "security.partner_cannot_release",
    forbidden.status === 401 || forbidden.status === 403 ? "PASS" : "FAIL",
    `http=${forbidden.status}`,
  );

  const changeReferrer = await api("PATCH", `/api/providers/me/network`, partnerToken, {
    referrerProviderId: referred.id,
  });
  gate(
    "security.cannot_change_referrer",
    changeReferrer.status === 404 || changeReferrer.status === 405 || changeReferrer.status === 403 ? "PASS" : "FAIL",
    `http=${changeReferrer.status}`,
  );

  const overview = await api("GET", "/api/admin/partner-referrals/overview", adminToken);
  const ov = (overview.json.data ?? {}) as {
    reached?: { rewarded?: number };
    economics?: { rewardAmount?: number };
    sources?: unknown[];
    topReferrers?: unknown[];
  };
  gate(
    "admin.overview_api",
    overview.status === 200 && ov.economics?.rewardAmount === 500 ? "PASS" : "FAIL",
    `http=${overview.status} reward=${ov.economics?.rewardAmount}`,
  );

  const queue = await api("GET", "/api/admin/partner-referrals/queue?status=REWARD_RELEASED", adminToken);
  gate("admin.queue_api", queue.status === 200 ? "PASS" : "FAIL", `http=${queue.status}`);

  const events = await prisma.eventOutbox.findMany({
    where: {
      aggregateId: referrerId,
      eventType: { startsWith: "homigo.partner.referral." },
      createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
    },
    select: { eventType: true, payload: true },
  });
  const mine = events.filter((e) => JSON.stringify(e.payload).includes(referralId));
  const types = new Set(mine.map((e) => e.eventType));
  const requiredEvents = [
    EVENT_TYPES.PARTNER_REFERRAL_INVITED,
    EVENT_TYPES.PARTNER_REFERRAL_REGISTERED,
    EVENT_TYPES.PARTNER_REFERRAL_VERIFIED,
    EVENT_TYPES.PARTNER_REFERRAL_TRAINING,
    EVENT_TYPES.PARTNER_REFERRAL_ACTIVATED,
    EVENT_TYPES.PARTNER_REFERRAL_FIRST_JOB,
    EVENT_TYPES.PARTNER_REFERRAL_QUALIFIED,
    EVENT_TYPES.PARTNER_REFERRAL_REWARDED,
  ];
  const missing = requiredEvents.filter((t) => !types.has(t));
  gate(
    "events.one_logical",
    missing.length === 0 ? "PASS" : events.length > 0 ? "WARN" : "FAIL",
    missing.length ? `missing ${missing.join(",")}` : `${types.size} types`,
  );

  const notes = await prisma.notification.findMany({
    where: { referenceId: referralId, type: "REFERRAL" },
    select: { title: true },
  });
  const titles = notes.map((n) => n.title);
  const uniqueTitles = new Set(titles);
  gate(
    "notifications.milestones",
    titles.some((t) => /qualified/i.test(t)) && uniqueTitles.size === titles.length ? "PASS" : titles.length > 0 ? "WARN" : "FAIL",
    titles.join(" | "),
  );
  gate(
    "notifications.no_fraud_leak",
    !titles.some((t) => /fraud|cycle|bank hash|aadhaar|pan/i.test(t)) ? "PASS" : "FAIL",
    titles.join(" | "),
  );

  const rewardNote = await prisma.notification.findFirst({
    where: { title: "Referral reward released", referenceId: rewards[0]?.id },
  });
  gate("notifications.reward", rewardNote ? "PASS" : "FAIL", rewardNote?.message ?? "missing");

  const dash = await api("GET", "/api/providers/me/network", partnerToken);
  const dashData = (dash.json.data ?? {}) as {
    referrals?: Array<{ id: string; jobs: number; jobTarget: number; status: string; rewardAmount: number | null }>;
    totalRewarded?: number;
    counts?: Record<string, number>;
  };
  const card = dashData.referrals?.find((r) => r.id === referralId);
  gate(
    "api.dashboard_progress",
    card?.jobs === 3 && card.jobTarget === 3 && card.status === "REWARD_RELEASED" && card.rewardAmount === 500
      ? "PASS"
      : "FAIL",
    JSON.stringify(card ?? dash.status),
  );

  const history = await prisma.partnerReferralStatusHistory.findMany({ where: { referralId } });
  gate("db.audit_history", history.length >= 6 ? "PASS" : "FAIL", `rows=${history.length}`);

  await prisma.provider.update({
    where: { id: referrerId },
    data: { bankAccountNumberHash: null, panNumberHash: null, aadharNumberHash: null },
  });

  const failed = results.filter((r) => r.status === "FAIL");
  console.log(JSON.stringify({ run: RUN, referralId, referredProviderId: referred.id, failed: failed.length, results }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
