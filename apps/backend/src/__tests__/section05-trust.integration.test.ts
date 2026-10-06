import "../load-env";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  prisma,
  dbReachable,
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { complianceExpiryService } from "../services/compliance-expiry.service";
import { partnerSafetyService } from "../services/partner-safety.service";
import { partnerRiskService } from "../services/partner-risk.service";
import { bookingService } from "../services/booking.service";
import { evaluateExpiry } from "../lib/compliance-expiry";
import { collectForbiddenPartnerKeys } from "../lib/privacy-policy.engine";
import { BookingStatus } from "@prisma/client";

const RUN_ID = `s05-${Date.now().toString(36)}`;
let fixture: AdvCtx | undefined;
let dbOk = false;
let docId = "";

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  fixture = await seedAdversarialFixtures(RUN_ID);
}, 60_000);

afterAll(async () => {
  if (!dbOk || !fixture) return;
  await prisma.partnerSafetyIncident.deleteMany({ where: { providerId: fixture.providerId } });
  await prisma.partnerRiskSignal.deleteMany({ where: { providerId: fixture.providerId } });
  await prisma.partnerRiskProfile.deleteMany({ where: { providerId: fixture.providerId } });
  await prisma.partnerComplianceReminder.deleteMany({ where: { providerId: fixture.providerId } });
  await prisma.partnerComplianceRestriction.deleteMany({ where: { providerId: fixture.providerId } });
  await prisma.providerDocument.deleteMany({ where: { providerId: fixture.providerId } });
  await cleanupAdversarialFixtures(RUN_ID);
}, 60_000);

function useFixture(): AdvCtx | null {
  if (!dbOk || !fixture) {
    console.warn("SKIP: PostgreSQL unreachable");
    return null;
  }
  return fixture;
}

describe.serial("Section 05 trust integration", () => {
  test("expiry evaluation is idempotent across 10 runs", async () => {
    const ctx = useFixture();
    if (!ctx) return;
    const expiry = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
    const doc = await prisma.providerDocument.create({
      data: {
        providerId: ctx.providerId,
        documentType: "insurance",
        documentNumber: "POL-S05",
        documentUrl: "https://example.invalid/doc.pdf",
        expiryDate: expiry,
        isVerified: true,
      },
    });
    docId = doc.id;
    expect(evaluateExpiry(expiry).reminderWindow).toBe("D7");
    const loaded = await prisma.providerDocument.findUniqueOrThrow({
      where: { id: doc.id },
      include: { provider: { select: { userId: true, complianceRestricted: true } } },
    });
    for (let i = 0; i < 10; i++) {
      await complianceExpiryService.evaluateDocument(loaded);
    }
    const reminders = await prisma.partnerComplianceReminder.count({
      where: { documentId: doc.id, window: "D7" },
    });
    expect(reminders).toBe(1);
    const notes = await prisma.notification.count({
      where: { userId: ctx.vendorUserId, type: "COMPLIANCE_URGENT", referenceId: doc.id },
    });
    expect(notes).toBe(1);
  });

  test("expired document restricts without cancelling jobs", async () => {
    const ctx = useFixture();
    if (!ctx) return;
    await prisma.providerDocument.update({
      where: { id: docId },
      data: { expiryDate: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    const loaded = await prisma.providerDocument.findUniqueOrThrow({
      where: { id: docId },
      include: { provider: { select: { userId: true, complianceRestricted: true } } },
    });
    await complianceExpiryService.evaluateDocument(loaded);
    await complianceExpiryService.evaluateDocument(loaded);
    const provider = await prisma.provider.findUniqueOrThrow({
      where: { id: ctx.providerId },
      select: { complianceRestricted: true, isOnline: true },
    });
    expect(provider.complianceRestricted).toBe(true);
    expect(provider.isOnline).toBe(false);
    const restrictions = await prisma.partnerComplianceRestriction.count({
      where: { providerId: ctx.providerId, documentId: docId, active: true },
    });
    expect(restrictions).toBe(1);
  });

  test("SOS double tap creates one incident and one event", async () => {
    const ctx = useFixture();
    if (!ctx) return;
    const first = await partnerSafetyService.triggerSos({
      providerId: ctx.providerId,
      userId: ctx.vendorUserId,
      latitude: 28.4595,
      longitude: 77.0266,
    });
    const second = await partnerSafetyService.triggerSos({
      providerId: ctx.providerId,
      userId: ctx.vendorUserId,
      latitude: 28.46,
      longitude: 77.03,
    });
    expect(second.incident.id).toBe(first.incident.id);
    const count = await prisma.partnerSafetyIncident.count({
      where: { providerId: ctx.providerId, type: "SOS" },
    });
    expect(count).toBe(1);
    const events = await prisma.eventOutbox.count({
      where: { eventType: "homigo.partner.sos.created", aggregateId: ctx.providerId },
    });
    expect(events).toBe(1);
    expect(first.incident.latitude).not.toBeNull();
    await partnerSafetyService.assign(first.incident.id, ctx.superAdmin.id, ctx.superAdmin.id);
    await partnerSafetyService.acknowledge(first.incident.id, ctx.superAdmin.id);
    const resolved = await partnerSafetyService.resolve(first.incident.id, ctx.superAdmin.id, "Safe. False alarm drill.");
    expect(resolved?.status).toBe("RESOLVED");
    expect(resolved?.openIdempotencyKey).toBeNull();
    const detail = await partnerSafetyService.adminDetail(first.incident.id);
    expect(JSON.stringify(detail)).not.toMatch(/\+91[0-9]{10}/);
    expect(detail?.emergencyContact.phoneMasked ?? true).toBeTruthy();
  }, 60_000);

  test("risk evaluation is deterministic and concurrent-safe", async () => {
    const ctx = useFixture();
    if (!ctx) return;
    await Promise.all([
      partnerRiskService.recordSignal({
        providerId: ctx.providerId,
        type: "GPS_SPOOF",
        source: "test",
        severity: 50,
        confidence: 0.5,
        evidence: { test: true },
        fingerprint: `GPS_SPOOF:${ctx.providerId}:s05`,
      }),
      partnerRiskService.recordSignal({
        providerId: ctx.providerId,
        type: "GPS_SPOOF",
        source: "test",
        severity: 50,
        confidence: 0.5,
        evidence: { test: true },
        fingerprint: `GPS_SPOOF:${ctx.providerId}:s05`,
      }),
    ]);
    const detail = await partnerRiskService.detail(ctx.providerId);
    expect(detail.totalSignals).toBe(1);
    expect(detail.profile?.explanation).toBeTruthy();
    expect(detail.profile?.riskLevel).not.toBe("CRITICAL");
  });

  test("partner isolation: other provider cannot see this SOS", async () => {
    const ctx = useFixture();
    if (!ctx) return;
    const mine = await partnerSafetyService.partnerHistory(ctx.providerId);
    const other = await partnerSafetyService.partnerHistory("does-not-exist");
    expect(Array.isArray(mine)).toBe(true);
    expect(other).toEqual([]);
  });

  test("30-day reminder is idempotent and distinct from D7", async () => {
    const ctx = useFixture();
    if (!ctx) return;
    const expiry = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);
    expect(evaluateExpiry(expiry).reminderWindow).toBe("D30");
    const doc = await prisma.providerDocument.create({
      data: {
        providerId: ctx.providerId,
        documentType: "certification",
        documentNumber: "CERT-S05-D30",
        documentUrl: "https://example.invalid/cert.pdf",
        expiryDate: expiry,
        isVerified: true,
      },
    });
    const loaded = await prisma.providerDocument.findUniqueOrThrow({
      where: { id: doc.id },
      include: { provider: { select: { userId: true, complianceRestricted: true } } },
    });
    for (let i = 0; i < 10; i++) {
      await complianceExpiryService.evaluateDocument(loaded);
    }
    const reminders = await prisma.partnerComplianceReminder.count({
      where: { documentId: doc.id, window: "D30" },
    });
    expect(reminders).toBe(1);
    const notes = await prisma.notification.count({
      where: { userId: ctx.vendorUserId, type: "COMPLIANCE_REMINDER", referenceId: doc.id },
    });
    expect(notes).toBe(1);
  });

  test("document expiry can be set after upload", async () => {
    const ctx = useFixture();
    if (!ctx) return;
    const { documentUploadService } = await import("../services/document-upload.service");
    const created = await prisma.providerDocument.create({
      data: {
        providerId: ctx.providerId,
        documentType: "insurance",
        documentNumber: "POL-META",
        documentUrl: "https://example.invalid/meta.pdf",
        isVerified: false,
      },
    });
    const expiry = new Date("2026-12-01T00:00:00Z");
    const updated = await documentUploadService.setDocumentMeta(
      created.id,
      { userId: ctx.vendorUserId },
      { expiryDate: expiry, issuer: "Test Insurer" },
    );
    expect(updated.expiryDate?.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(updated.issuer).toBe("Test Insurer");
    await expect(
      documentUploadService.setDocumentMeta(created.id, { userId: "someone-else" }, { issuer: "Nope" }),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  test("partner GET booking history uses privacy engine, not full customer PII", async () => {
    const ctx = useFixture();
    if (!ctx) return;
    const booking = await prisma.booking.findFirst({
      where: { providerId: ctx.providerId, status: BookingStatus.COMPLETED },
    });
    expect(booking).toBeTruthy();
    const partnerView = await bookingService.getById(booking!.id, undefined, ctx.providerId);
    expect(partnerView).toBeTruthy();
    expect(collectForbiddenPartnerKeys(partnerView)).toEqual([]);
    expect(JSON.stringify(partnerView)).not.toMatch(/bankAccountNumber|riskScore|kycDocumentNumber/);
    // History stage (2026-10-06): once the job is over the partner keeps the first name only. The old
    // assertion compared the masked phone with `ctx.customerA.phoneNumber`, which is null for an
    // encrypted fixture, so it could not have caught a leaked number; the contract is stated directly.
    const historyCustomer = (partnerView as { customer?: { lastName?: string | null; profileImage?: string | null; phoneMasked?: string | null } }).customer;
    expect(historyCustomer?.phoneMasked ?? null).toBeNull();
    expect(historyCustomer?.lastName ?? null).toBeNull();
    expect(historyCustomer?.profileImage ?? null).toBeNull();
    expect((partnerView as { address?: { specialInstructions?: string | null } }).address?.specialInstructions ?? null).toBeNull();

    const customerView = await bookingService.getById(booking!.id, ctx.customerA.id);
    expect((customerView as { provider?: { id: string } | null }).provider?.id).toBe(ctx.providerId);
    expect((customerView as { customer?: unknown }).customer).toBeUndefined();
  });
});
