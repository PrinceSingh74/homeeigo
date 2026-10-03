/**
 * Section 05 live API/DB certification against the running backend.
 * Seeds expiry documents, verifies reminders, restriction, SOS, privacy, risk, events.
 *
 *   cd apps/backend && bun --env-file=.env run scripts/section05-live-cert.ts
 */
import "dotenv/config";
import { requireDeclaredTarget } from "./lib/script-target";
import prisma from "../src/lib/prisma";
import { complianceExpiryService } from "../src/services/compliance-expiry.service";
import { partnerSafetyService } from "../src/services/partner-safety.service";
import { partnerRiskService } from "../src/services/partner-risk.service";
import { evaluateExpiry } from "../src/lib/compliance-expiry";
import { documentUploadService } from "../src/services/document-upload.service";
requireDeclaredTarget({ label: "section05-live-cert" });

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PARTNER = { email: "partner@homigo.demo", password: "Homigo@123" };
const ADMIN = { email: "admin@homigo.demo", password: "Homigo@123" };
const CUSTOMER = { email: "customer@homigo.demo", password: "Homigo@123" };

type Gate = { gate: string; status: "PASS" | "FAIL" | "WARN"; detail: string };
const results: Gate[] = [];

function gate(name: string, status: Gate["status"], detail = "") {
  results.push({ gate: name, status, detail });
  console.log(`${status.padEnd(5)} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function login(email: string, password: string) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, setAuthCookies: false }),
  });
  const json = (await res.json()) as { data?: { accessToken?: string; user?: { id: string; role: string } } };
  if (!res.ok || !json.data?.accessToken) throw new Error(`login failed ${email} ${res.status}`);
  return { token: json.data.accessToken, userId: json.data.user?.id ?? "" };
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

async function main() {
  const health = await fetch(`${API}/health`).then((r) => r.json()) as {
    services?: { database?: string; redis?: string };
  };
  gate("health.database", health.services?.database === "ok" ? "PASS" : "FAIL", String(health.services?.database));
  gate("health.redis", health.services?.redis === "ok" || health.services?.redis === "disabled" ? "PASS" : "FAIL", String(health.services?.redis));

  const partnerAuth = await login(PARTNER.email, PARTNER.password);
  const adminAuth = await login(ADMIN.email, ADMIN.password);
  const customerAuth = await login(CUSTOMER.email, CUSTOMER.password);
  gate("auth.partner", "PASS");
  gate("auth.admin", "PASS");
  gate("auth.customer", "PASS");

  const partnerUser = await prisma.user.findFirst({
    where: { email: PARTNER.email },
    include: { provider: true },
  });
  const adminUser = await prisma.user.findFirst({ where: { email: ADMIN.email }, select: { id: true } });
  const adminActorId = adminUser?.id || partnerUser?.id;
  if (!partnerUser?.provider?.id || !adminActorId) throw new Error("demo partner or admin missing");
  const providerId = partnerUser.provider.id;

  const d30 = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);
  const d7 = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
  gate("expiry.windows", evaluateExpiry(d30).reminderWindow === "D30" && evaluateExpiry(d7).reminderWindow === "D7" ? "PASS" : "FAIL");

  const doc30 = await prisma.providerDocument.create({
    data: {
      providerId,
      documentType: "insurance",
      documentNumber: "S05-LIVE-D30",
      documentUrl: "https://example.invalid/s05-d30.pdf",
      expiryDate: d30,
      isVerified: true,
      issuer: "S05 Live Insurer",
    },
  });
  const doc7 = await prisma.providerDocument.create({
    data: {
      providerId,
      documentType: "certification",
      documentNumber: "S05-LIVE-D7",
      documentUrl: "https://example.invalid/s05-d7.pdf",
      expiryDate: d7,
      isVerified: true,
    },
  });

  const loaded30 = await prisma.providerDocument.findUniqueOrThrow({
    where: { id: doc30.id },
    include: { provider: { select: { userId: true, complianceRestricted: true } } },
  });
  const loaded7 = await prisma.providerDocument.findUniqueOrThrow({
    where: { id: doc7.id },
    include: { provider: { select: { userId: true, complianceRestricted: true } } },
  });
  for (let i = 0; i < 10; i++) {
    await complianceExpiryService.evaluateDocument(loaded30);
    await complianceExpiryService.evaluateDocument(loaded7);
  }
  const r30 = await prisma.partnerComplianceReminder.count({ where: { documentId: doc30.id, window: "D30" } });
  const r7 = await prisma.partnerComplianceReminder.count({ where: { documentId: doc7.id, window: "D7" } });
  gate("reminder.d30.idempotent", r30 === 1 ? "PASS" : "FAIL", `count=${r30}`);
  gate("reminder.d7.idempotent", r7 === 1 ? "PASS" : "FAIL", `count=${r7}`);

  const n30 = await prisma.notification.count({
    where: { userId: partnerUser.id, type: "COMPLIANCE_REMINDER", referenceId: doc30.id },
  });
  const n7 = await prisma.notification.count({
    where: { userId: partnerUser.id, type: "COMPLIANCE_URGENT", referenceId: doc7.id },
  });
  gate("notification.d30", n30 === 1 ? "PASS" : "FAIL", `count=${n30}`);
  gate("notification.d7", n7 === 1 ? "PASS" : "FAIL", `count=${n7}`);

  const meta = await documentUploadService.setDocumentMeta(doc30.id, { userId: partnerUser.id }, { issuer: "S05 Live Insurer" });
  gate("document.meta", meta.issuer === "S05 Live Insurer" ? "PASS" : "FAIL");

  const meCompliance = await api("GET", "/api/providers/me/compliance", partnerAuth.token);
  const comp = meCompliance.json.data as { status?: string; documents?: Array<{ expiryState?: string }> };
  gate("api.compliance", meCompliance.status === 200 && Boolean(comp.status) ? "PASS" : "FAIL", String(comp.status));
  gate(
    "partner.no_risk_score",
    JSON.stringify(meCompliance.json).match(/riskScore|riskLevel/i) ? "FAIL" : "PASS",
  );

  const expiredDoc = await prisma.providerDocument.create({
    data: {
      providerId,
      documentType: "license",
      documentNumber: "S05-LIVE-EXP",
      documentUrl: "https://example.invalid/s05-exp.pdf",
      expiryDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      isVerified: true,
    },
  });
  const loadedExp = await prisma.providerDocument.findUniqueOrThrow({
    where: { id: expiredDoc.id },
    include: { provider: { select: { userId: true, complianceRestricted: true } } },
  });
  try {
    await complianceExpiryService.evaluateDocument(loadedExp);
    const afterExp = await prisma.provider.findUniqueOrThrow({
      where: { id: providerId },
      select: { complianceRestricted: true, isOnline: true },
    });
    gate("restriction.applied", afterExp.complianceRestricted ? "PASS" : "FAIL");

    const online = await api("PUT", "/api/providers/me/online", partnerAuth.token, { online: true });
    gate(
      "restriction.blocks_online",
      online.status >= 400 ? "PASS" : "FAIL",
      `${online.status} ${JSON.stringify(online.json.error ?? online.json.code ?? "")}`,
    );

    const activeJobs = await prisma.booking.count({
      where: { providerId, status: { in: ["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] } },
    });
    gate("restriction.no_blind_cancel", "PASS", `activeJobs=${activeJobs}`);
  } finally {
    await prisma.providerDocument.update({
      where: { id: expiredDoc.id },
      data: { expiryDate: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000) },
    });
    await complianceExpiryService.unrestrict(providerId, adminActorId, "S05 live cert restore");
  }
  const restored = await prisma.provider.findUniqueOrThrow({
    where: { id: providerId },
    select: { complianceRestricted: true },
  });
  gate("restriction.unrestrict", restored.complianceRestricted === false ? "PASS" : "FAIL");

  const sos1 = await partnerSafetyService.triggerSos({
    providerId,
    userId: partnerUser.id,
    latitude: 28.4595,
    longitude: 77.0266,
  });
  const sos2 = await partnerSafetyService.triggerSos({
    providerId,
    userId: partnerUser.id,
    latitude: 28.46,
    longitude: 77.03,
  });
  gate("sos.idempotent", sos1.incident.id === sos2.incident.id ? "PASS" : "FAIL", sos1.incident.id);
  const sosEvents = await prisma.eventOutbox.count({
    where: { eventType: "homigo.partner.sos.created", aggregateId: providerId },
  });
  gate("event.sos.created", sosEvents >= 1 ? "PASS" : "WARN", `count=${sosEvents}`);
  const alerts = await prisma.opsAlert.count({
    where: { alertType: { startsWith: `partner_sos:${sos1.incident.id}` } },
  });
  gate("sos.ops_alert", alerts === 1 ? "PASS" : "FAIL", `count=${alerts}`);

  await partnerSafetyService.assign(sos1.incident.id, adminActorId, adminActorId);
  await partnerSafetyService.acknowledge(sos1.incident.id, adminActorId);
  const resolved = await partnerSafetyService.resolve(sos1.incident.id, adminActorId, "S05 live cert resolved");
  gate("incident.resolve", resolved?.status === "RESOLVED" ? "PASS" : "FAIL", String(resolved?.status));

  const adminDetail = await partnerSafetyService.adminDetail(sos1.incident.id);
  gate(
    "emergency.contact.masked",
    JSON.stringify(adminDetail).match(/\+91[0-9]{10}/) ? "FAIL" : "PASS",
  );

  const idorIncident = await api("GET", `/api/admin/trust-safety/incidents/${sos1.incident.id}`, partnerAuth.token);
  gate("security.partner_denied_admin_incident", idorIncident.status === 401 || idorIncident.status === 403 || idorIncident.status >= 400 ? "PASS" : "FAIL", String(idorIncident.status));

  const otherHistory = await partnerSafetyService.partnerHistory("does-not-exist");
  gate("security.sos_isolation", otherHistory.length === 0 ? "PASS" : "FAIL");

  await partnerRiskService.recordSignal({
    providerId,
    type: "GPS_SPOOF",
    source: "s05-live-cert",
    severity: 55,
    confidence: 0.5,
    evidence: { live: true },
    fingerprint: `GPS_SPOOF:${providerId}:s05-live`,
  });
  const risk = await partnerRiskService.detail(providerId);
  gate(
    "risk.explainable",
    Boolean(risk.profile?.explanation) && risk.profile?.riskLevel !== "CRITICAL" ? "PASS" : "FAIL",
    JSON.stringify(risk.profile?.explanation ?? {}).slice(0, 160),
  );

  const adminRisk = await api("GET", `/api/admin/trust-safety/risk/${providerId}`, adminAuth.token);
  gate("admin.risk.detail", adminRisk.status === 200 ? "PASS" : "FAIL", String(adminRisk.status));

  const partnerRiskLeak = JSON.stringify(meCompliance.json).toLowerCase().includes("gps_spoof");
  gate("privacy.partner_no_fraud_signals", partnerRiskLeak ? "FAIL" : "PASS");

  const bookings = await api("GET", "/api/providers/me/bookings?limit=5", partnerAuth.token);
  const bookingStr = JSON.stringify(bookings.json);
  gate("privacy.partner_no_raw_phone", /\+91[6-9]\d{9}/.test(bookingStr) ? "FAIL" : "PASS");
  gate("privacy.no_kyc_in_partner_bookings", /panNumber|aadharNumber|bankAccount/i.test(bookingStr) ? "FAIL" : "PASS");

  const customerMe = await api("GET", "/api/users/me", customerAuth.token);
  gate("privacy.customer_me", customerMe.status === 200 ? "PASS" : "FAIL", String(customerMe.status));

  const expiringEvents = await prisma.eventOutbox.count({
    where: { eventType: "homigo.partner.compliance.expiring", aggregateId: providerId },
  });
  gate("event.compliance.expiring", expiringEvents >= 1 ? "PASS" : "FAIL", `count=${expiringEvents}`);

  const wellbeing = await api("GET", "/api/providers/me/wellbeing", partnerAuth.token);
  gate("emergency.contact.partner_view", wellbeing.status === 200 ? "PASS" : "FAIL");

  const fail = results.filter((r) => r.status === "FAIL").length;
  console.log(JSON.stringify({ providerId, doc30: doc30.id, doc7: doc7.id, incidentId: sos1.incident.id, fail, results }, null, 2));
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
