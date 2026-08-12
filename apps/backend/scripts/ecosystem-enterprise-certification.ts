/**
 * Full ecosystem runtime certification — real DB, Redis, HTTP APIs. No mocks.
 *
 *   bun --env-file=.env run scripts/ecosystem-enterprise-certification.ts
 */
import "../src/load-env";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import prisma from "../src/lib/prisma";
import { assignmentEngine } from "../src/services/assignment-engine.service";
import { bearer, fixturePhone } from "../src/__tests__/helpers/adversarial-fixtures";
import { smokeReq, smokeLogin, DEFAULT_BASE } from "./smoke-lib";
import { ensureDir, pruneStaleEvidence } from "./lib/safe-fs";
import {
  cleanupEcoCertFixtures,
  renderCleanupMarkdown,
  type CleanupResult,
  type EcoCertFixtures,
} from "./lib/ecosystem-cert-cleanup";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const OUT_DIR = join(REPO, "homigo-mobile", ".certification-evidence");
const OUT_MD = join(REPO, "homigo-mobile", "ecosystem-enterprise-certification.md");
const CLEANUP_MD = join(REPO, "homigo-mobile", "ecosystem-cleanup-certification.md");

const BASE = process.env.API_URL ?? DEFAULT_BASE;
const PROM = process.env.PROMETHEUS_URL ?? "http://localhost:9090";
const GRAFANA = process.env.GRAFANA_URL ?? "http://localhost:3004";
const RUN_ID = `eco-${Date.now().toString(36)}`;

type Step = {
  id: string;
  label: string;
  ok: boolean;
  blocked?: boolean;
  detail: string;
  evidence?: Record<string, unknown>;
};

const steps: Step[] = [];

function record(step: Omit<Step, "ok"> & { ok: boolean }) {
  steps.push(step);
  const tag = step.blocked ? "BLOCKED" : step.ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${step.id}: ${step.detail}`);
}

async function prepareEvidenceDir() {
  const ensured = await ensureDir(OUT_DIR, { log: true, label: "OUT_DIR" });
  const pruned = await pruneStaleEvidence(OUT_DIR);
  console.log(`[cert] evidence dir action=${ensured.action} pruned=${pruned} stale file(s)`);
  return ensured;
}

async function main() {
  await prepareEvidenceDir();
  console.log(`\n=== Ecosystem Enterprise Certification (${RUN_ID}) ===\n`);

  // ── Infrastructure ──
  const health = await smokeReq(BASE, "/health");
  record({
    id: "infra_backend",
    label: "Backend",
    ok: health.status === 200 && (health.body.services as { database?: string })?.database === "ok",
    detail: `GET /health → ${health.status} db=${(health.body.services as { database?: string })?.database ?? "?"}`,
    evidence: { body: health.body },
  });

  const ready = await smokeReq(BASE, "/ready");
  const checks = ready.body.checks as Record<string, { status?: string }> | undefined;
  record({
    id: "infra_postgresql",
    label: "PostgreSQL",
    ok: ready.status === 200 && checks?.database?.status === "healthy",
    detail: `ready.database=${checks?.database?.status ?? "unknown"} latencyMs=${(checks?.database as { latencyMs?: number })?.latencyMs}`,
  });

  record({
    id: "infra_redis",
    label: "Redis",
    ok: ready.status === 200 && checks?.redis?.status === "healthy",
    detail: `ready.redis=${checks?.redis?.status ?? "unknown"} topology=${(checks?.redis as { topology?: string })?.topology ?? "?"}`,
  });

  // ── Setup fixtures (real rows, cleaned up at end) ──
  const passwordHash = await Bun.password.hash("Eco@123", { algorithm: "bcrypt", cost: 4 });
  const service = await prisma.service.create({
    data: {
      name: `Eco Service ${RUN_ID}`,
      slug: `eco-svc-${RUN_ID}`,
      description: "Ecosystem cert",
      category: "cleaning",
      basePrice: 750,
      estimatedDuration: 60,
      isActive: true,
    },
  });
  const customer = await prisma.user.create({
    data: {
      email: `eco-cust-${RUN_ID}@homigo.test`,
      phoneNumber: fixturePhone(RUN_ID, "cust"),
      firstName: "Eco",
      lastName: "Customer",
      password: passwordHash,
      role: "CUSTOMER",
      isEmailVerified: true,
      walletBalance: 5000,
    },
  });
  const address = await prisma.address.create({
    data: {
      userId: customer.id,
      label: "Home",
      addressLine1: "12 Test Lane",
      city: "Mumbai",
      state: "MH",
      zipCode: "400001",
      latitude: 19.076,
      longitude: 72.8777,
    },
  });
  const vendorUser = await prisma.user.create({
    data: {
      email: `eco-prov-${RUN_ID}@homigo.test`,
      phoneNumber: fixturePhone(RUN_ID, "prov"),
      firstName: "Eco",
      lastName: "Partner",
      password: passwordHash,
      role: "VENDOR",
      isEmailVerified: true,
    },
  });
  const provider = await prisma.provider.create({
    data: {
      userId: vendorUser.id,
      isActive: true,
      isApproved: true,
      isOnline: true,
      serviceCategories: [service.id],
      walletBalance: 0,
    },
  });
  await prisma.location.create({
    data: { providerId: provider.id, latitude: 19.0765, longitude: 72.878 },
  });

  const customerToken = bearer(customer);
  const partnerToken = bearer(vendorUser);

  let bookingId = "";
  let providerWalletBefore = 0;
  let cleanupResult: CleanupResult = { ok: true, steps: [], remaining: {}, transactional: true };

  const fixtures: EcoCertFixtures = {
    runId: RUN_ID,
    serviceId: service.id,
    customerId: customer.id,
    vendorUserId: vendorUser.id,
    providerId: provider.id,
    addressId: address.id,
  };

  try {
    // 1. Booking creation (mobile customer API path)
    const scheduled = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const createRes = await smokeReq(BASE, "/api/bookings", {
      method: "POST",
      headers: { Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({ serviceId: service.id, addressId: address.id, scheduledDate: scheduled }),
    });
    bookingId =
      ((createRes.body.data as Record<string, unknown>)?.booking as { id?: string })?.id ??
      (createRes.body.data as { id?: string })?.id ??
      "";
    record({
      id: "booking_creation",
      label: "Booking creation",
      ok: (createRes.status === 200 || createRes.status === 201) && !!bookingId,
      detail: `POST /api/bookings → ${createRes.status} id=${bookingId.slice(0, 12) || "none"}`,
      evidence: { bookingId, status: (createRes.body.data as { booking?: { status?: string } })?.booking?.status },
    });

    const jobBefore = await prisma.assignmentJob.findFirst({ where: { bookingId } });

    // 2. Partner assignment
    const queue = await assignmentEngine.processQueue();
    const attempt = await prisma.assignmentAttempt.findFirst({
      where: { job: { bookingId } },
      orderBy: { dispatchedAt: "desc" },
    });
    record({
      id: "partner_assignment",
      label: "Partner assignment",
      ok: !!jobBefore && !!attempt && ["DISPATCHED", "ACCEPTED", "PENDING"].includes(jobBefore.status),
      detail: `job=${jobBefore?.status ?? "none"} attempts=${attempt ? 1 : 0} dispatchedTo=${attempt?.providerId?.slice(0, 10) ?? "none"} target=${provider.id.slice(0, 10)}`,
      evidence: { jobId: jobBefore?.id, attemptId: attempt?.id, matchedTarget: attempt?.providerId === provider.id },
    });

    // 3. Partner acceptance (partner API path)
    const acceptRes = await smokeReq(BASE, `/api/bookings/${bookingId}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${partnerToken}` },
      body: JSON.stringify({ eta: 25 }),
    });
    const bAccepted = await prisma.booking.findUnique({ where: { id: bookingId } });
    record({
      id: "partner_acceptance",
      label: "Partner acceptance",
      ok: acceptRes.status === 200 && bAccepted?.providerId === provider.id && !!bAccepted?.acceptedAt,
      detail: `POST accept → ${acceptRes.status} status=${bAccepted?.status} acceptedAt=${bAccepted?.acceptedAt ? "set" : "null"}`,
    });

    // Start job for tracking
    await smokeReq(BASE, `/api/bookings/${bookingId}/start`, {
      method: "POST",
      headers: { Authorization: `Bearer ${partnerToken}` },
      body: JSON.stringify({ latitude: 19.0765, longitude: 72.878 }),
    });

    // 4. Tracking updates
    const trackRes = await smokeReq(BASE, "/api/tracking/location", {
      method: "POST",
      headers: { Authorization: `Bearer ${partnerToken}` },
      body: JSON.stringify({
        bookingId,
        latitude: 19.077,
        longitude: 72.879,
        speed: 12,
        heading: 90,
      }),
    });
    const tracking = await prisma.tracking.findUnique({ where: { bookingId } });
    record({
      id: "tracking_updates",
      label: "Tracking updates",
      ok: trackRes.status === 200 && !!tracking && tracking.status !== "NOT_STARTED",
      detail: `POST /api/tracking/location → ${trackRes.status} trackingStatus=${tracking?.status ?? "none"}`,
      evidence: { lastUpdateAt: tracking?.lastUpdateAt },
    });

    providerWalletBefore = (await prisma.provider.findUnique({ where: { id: provider.id } }))?.walletBalance ?? 0;

    // 5. Completion
    const completeRes = await smokeReq(BASE, `/api/bookings/${bookingId}/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${partnerToken}` },
      body: JSON.stringify({ latitude: 19.076, longitude: 72.8777, notes: "eco-cert" }),
    });
    const bDone = await prisma.booking.findUnique({ where: { id: bookingId } });
    record({
      id: "completion",
      label: "Completion",
      ok: completeRes.status === 200 && bDone?.status === "COMPLETED" && !!bDone?.completedAt,
      detail: `POST complete → ${completeRes.status} status=${bDone?.status}`,
    });

    // 6. Wallet credit (provider)
    const providerAfter = await prisma.provider.findUnique({ where: { id: provider.id } });
    const earning = await prisma.earning.findUnique({ where: { bookingId } });
    const walletDelta = (providerAfter?.walletBalance ?? 0) - providerWalletBefore;
    record({
      id: "wallet_credit",
      label: "Wallet credit",
      ok: walletDelta > 0 && !!earning && earning.netEarning > 0,
      detail: `provider wallet Δ₹${walletDelta.toFixed(2)} earning=₹${earning?.netEarning ?? 0}`,
      evidence: { earningId: earning?.id, journalCheck: "see ledger" },
    });

    // 7. Settlement — verify settlement infrastructure + any linked settlements
    const settlementCount = await prisma.paymentSettlement.count();
    const settledPayments = await prisma.payment.count({
      where: { status: "SUCCESS", settlementId: { not: null } },
    });
    const successPayments = await prisma.payment.count({ where: { status: "SUCCESS" } });
    record({
      id: "settlement_creation",
      label: "Settlement creation",
      ok: settlementCount > 0 || settledPayments > 0,
      blocked: settlementCount === 0 && successPayments > 0,
      detail:
        settlementCount > 0
          ? `payment_settlements=${settlementCount} linkedPayments=${settledPayments}/${successPayments}`
          : `no settlement rows (SUCCESS payments=${successPayments}) — Razorpay settlement sync not run for this booking`,
      evidence: { settlementCount, settledPayments, successPayments },
    });

    // 8. Analytics event (mobile ux-signals path)
    const uxRes = await smokeReq(BASE, "/api/ux-signals", {
      method: "POST",
      body: JSON.stringify({
        signal: "startup_interactive",
        value: 1850,
        platform: "android",
        version: "1.0.0",
        device_type: "android",
        route: "mobile",
      }),
    });
    record({
      id: "analytics_event",
      label: "Analytics event",
      ok: uxRes.status === 200 || uxRes.status === 201 || uxRes.status === 204,
      detail: `POST /api/ux-signals → ${uxRes.status}`,
    });

    // Admin panel API (backend route used by admin UI)
    const adminEmail = "admin@homigo.demo";
    const adminPassword = "Homigo@123";
    const adminLogin = await smokeLogin(BASE, adminEmail, adminPassword);
    let adminOk = false;
    if (adminLogin.token) {
      const adminBookings = await smokeReq(BASE, `/api/admin/bookings?limit=5`, {
        headers: { Authorization: `Bearer ${adminLogin.token}` },
      });
      const adminAnalytics = await smokeReq(BASE, `/api/admin/analytics`, {
        headers: { Authorization: `Bearer ${adminLogin.token}` },
      });
      adminOk = adminBookings.status === 200 && adminAnalytics.status === 200;
      record({
        id: "admin_panel_api",
        label: "Admin Panel",
        ok: adminOk,
        detail: `admin bookings=${adminBookings.status} analytics=${adminAnalytics.status}`,
        blocked: !adminOk,
        evidence: { bookingsStatus: adminBookings.status, analyticsStatus: adminAnalytics.status },
      });
    } else {
      record({
        id: "admin_panel_api",
        label: "Admin Panel",
        ok: false,
        blocked: true,
        detail: `admin login failed status=${adminLogin.status}`,
      });
    }

    // Partner panel API
    const partnerBookings = await smokeReq(BASE, "/api/providers/me/bookings", {
      headers: { Authorization: `Bearer ${partnerToken}` },
    });
    const partnerList = (partnerBookings.body.data as { bookings?: { id: string }[] })?.bookings ?? [];
    record({
      id: "partner_panel_api",
      label: "Partner Panel",
      ok: partnerBookings.status === 200,
      detail: `GET /api/providers/me/bookings → ${partnerBookings.status} count=${partnerList.length}`,
      evidence: {
        count: Array.isArray((partnerBookings.body.data as { bookings?: unknown[] })?.bookings)
          ? (partnerBookings.body.data as { bookings: unknown[] }).bookings.length
          : null,
      },
    });

    // Customer mobile API read-back
    const mobileBooking = await smokeReq(BASE, `/api/bookings/${bookingId}`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const found = mobileBooking.status === 200 && !!(mobileBooking.body.data as { booking?: { id: string } })?.booking?.id;
    record({
      id: "customer_mobile_api",
      label: "Customer Mobile",
      ok: found,
      detail: `GET /api/bookings/${bookingId.slice(0, 8)}… → ${mobileBooking.status}`,
    });

    // 9. Prometheus metrics
    const metricsRes = await fetch(`${BASE}/metrics`);
    const metricsBody = await metricsRes.text();
    const hasBookingMetric = /booking_created_total|booking_completed_total/.test(metricsBody);
    const hasBizGauge = /biz_gmv_inr|biz_orders_today/.test(metricsBody);
    record({
      id: "prometheus_metrics",
      label: "Prometheus metrics",
      ok: metricsRes.ok && metricsBody.length > 500 && hasBookingMetric,
      detail: `GET /metrics ${metricsBody.length}B bookingMetrics=${hasBookingMetric} bizGauges=${hasBizGauge}`,
      evidence: {
        sample: metricsBody.split("\n").filter((l) => /booking_|biz_/.test(l)).slice(0, 6),
      },
    });

    // Prometheus server scrape target
    let promTargetUp = false;
    try {
      const promQ = await fetch(`${PROM}/api/v1/query?query=up{job%3D%22homigo-backend%22}`);
      const promJ = (await promQ.json()) as { data?: { result?: unknown[] } };
      promTargetUp = (promJ.data?.result?.length ?? 0) > 0;
    } catch {
      /* */
    }
    record({
      id: "prometheus_scrape",
      label: "Prometheus scrape",
      ok: promTargetUp,
      blocked: !promTargetUp,
      detail: promTargetUp ? `Prometheus sees homigo-backend target up` : `Prometheus target homigo-backend not up at ${PROM}`,
    });

    // 10. Grafana visibility
    let grafanaOk = false;
    let dashboardCount = 0;
    try {
      const gh = await fetch(`${GRAFANA}/api/health`);
      const gDash = await fetch(`${GRAFANA}/api/search?type=dash-db`, {
        headers: { Authorization: "Basic " + Buffer.from("admin:homigo_admin").toString("base64") },
      });
      if (gh.ok && gDash.ok) {
        const dashboards = (await gDash.json()) as unknown[];
        dashboardCount = dashboards.length;
        grafanaOk = dashboardCount > 0;
      }
    } catch {
      /* */
    }
    record({
      id: "grafana_visibility",
      label: "Grafana visibility",
      ok: grafanaOk,
      blocked: !grafanaOk,
      detail: grafanaOk
        ? `Grafana ${GRAFANA} healthy dashboards=${dashboardCount}`
        : `Grafana not reachable or no dashboards at ${GRAFANA}`,
      evidence: { dashboardCount },
    });
  } finally {
    console.log("\n=== Ecosystem Fixture Cleanup ===\n");
    cleanupResult = await cleanupEcoCertFixtures(prisma, { ...fixtures, bookingId: bookingId || undefined });
    record({
      id: "fixture_cleanup",
      label: "Fixture cleanup",
      ok: cleanupResult.ok,
      detail: cleanupResult.ok
        ? `removed ${cleanupResult.steps.reduce((n, s) => n + s.deleted, 0)} rows across ${cleanupResult.steps.length} tables`
        : `cleanup failed: ${cleanupResult.error ?? "fixture rows remain"}`,
      evidence: { steps: cleanupResult.steps, remaining: cleanupResult.remaining, error: cleanupResult.error },
    });
    await prisma.$disconnect();
  }

  const corePass = steps.filter((s) =>
    [
      "booking_creation",
      "partner_assignment",
      "partner_acceptance",
      "tracking_updates",
      "completion",
      "wallet_credit",
      "analytics_event",
      "prometheus_metrics",
    ].includes(s.id),
  );
  const certSteps = steps.filter((s) => s.id !== "fixture_cleanup");
  const overallOk = corePass.every((s) => s.ok) && certSteps.every((s) => s.ok);
  const cleanupOk = cleanupResult.ok;
  const blocked = certSteps.filter((s) => s.blocked);
  const failed = certSteps.filter((s) => !s.ok);

  const result = {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    base: BASE,
    overallStatus: overallOk && failed.length === 0 ? "PASS" : blocked.some((s) => s.blocked) ? "BLOCKED" : "FAIL",
    cleanupStatus: cleanupOk ? "PASS" : "FAIL",
    summary: {
      total: certSteps.length,
      passed: certSteps.filter((s) => s.ok).length,
      failed: failed.length,
      blocked: blocked.length,
    },
    cleanup: cleanupResult,
    steps,
  };

  writeFileSync(join(OUT_DIR, "ecosystem-enterprise.json"), JSON.stringify(result, null, 2));
  writeFileSync(OUT_MD, renderMarkdown(result));
  writeFileSync(CLEANUP_MD, renderCleanupMarkdown(cleanupResult, { ...fixtures, bookingId: bookingId || undefined }, RUN_ID));
  console.log(`\nEvidence → ${join(OUT_DIR, "ecosystem-enterprise.json")}`);
  console.log(`Report  → ${OUT_MD}`);
  console.log(`Cleanup → ${CLEANUP_MD}`);
  console.log(`\nOverall: ${result.overallStatus} (${result.summary.passed}/${result.summary.total} passed)`);
  console.log(`Cleanup: ${result.cleanupStatus}\n`);
  if (!overallOk) process.exit(2);
  if (!cleanupOk) process.exit(4);
  process.exit(0);
}

function renderMarkdown(result: {
  generatedAt: string;
  runId: string;
  base: string;
  overallStatus: string;
  summary: { total: number; passed: number; failed: number; blocked: number };
  steps: Step[];
}) {
  const lines = [
    "# Ecosystem Enterprise Certification",
    "",
    `**Run ID:** ${result.runId}`,
    `**Certified at:** ${result.generatedAt}`,
    `**Backend:** ${result.base}`,
    `**Evidence:** \`homigo-mobile/.certification-evidence/ecosystem-enterprise.json\``,
    "",
    "## Executive summary",
    "",
    `| Verdict | **${result.overallStatus}** |`,
    `| Passed | ${result.summary.passed} / ${result.summary.total} |`,
    `| Failed | ${result.summary.failed} |`,
    `| Blocked | ${result.summary.blocked} |`,
    "",
    "## Runtime chain",
    "",
    "| Step | Component | Status | Detail |",
    "|------|-----------|--------|--------|",
  ];

  for (const s of result.steps) {
    const status = s.blocked && !s.ok ? "BLOCKED" : s.ok ? "PASS" : "FAIL";
    lines.push(`| ${s.id} | ${s.label} | **${status}** | ${s.detail.replace(/\|/g, "\\|")} |`);
  }

  lines.push(
    "",
    "## Verification checklist (mission scope)",
    "",
    "| # | Flow | Status |",
    "|---|------|--------|",
  );

  const map: Record<string, string> = {
    booking_creation: "1. Booking creation",
    partner_assignment: "2. Partner assignment",
    partner_acceptance: "3. Partner acceptance",
    tracking_updates: "4. Tracking updates",
    completion: "5. Completion",
    wallet_credit: "6. Wallet credit",
    settlement_creation: "7. Settlement creation",
    analytics_event: "8. Analytics event",
    prometheus_metrics: "9. Prometheus metrics",
    grafana_visibility: "10. Grafana visibility",
  };

  for (const s of result.steps) {
    const label = map[s.id];
    if (!label) continue;
    const status = s.blocked && !s.ok ? "BLOCKED" : s.ok ? "PASS" : "FAIL";
    lines.push(`| ${label} | **${status}** |`);
  }

  lines.push(
    "",
    "## Operator re-run",
    "",
    "```powershell",
    "cd apps/backend",
    "bun --env-file=.env run scripts/ecosystem-enterprise-certification.ts",
    "```",
    "",
    "Requires: backend on :3000, PostgreSQL + Redis healthy, optional Prometheus :9090 + Grafana :3004.",
    "",
  );

  return lines.join("\n");
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(3);
});
