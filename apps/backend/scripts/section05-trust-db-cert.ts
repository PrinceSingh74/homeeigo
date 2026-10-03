/**
 * Section 05 trust DB cert (avoids bun:test segfault on integration file).
 * Usage: bun --env-file=.env.test run scripts/section05-trust-db-cert.ts
 */
import "../src/load-env";
import { BookingStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { complianceExpiryService } from "../src/services/compliance-expiry.service";
import { partnerSafetyService } from "../src/services/partner-safety.service";
import { partnerRiskService } from "../src/services/partner-risk.service";
import { bookingService } from "../src/services/booking.service";
import { evaluateExpiry } from "../src/lib/compliance-expiry";
import { collectForbiddenPartnerKeys } from "../src/lib/privacy-policy.engine";
import {
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
  fixturePhone,
} from "../src/__tests__/helpers/adversarial-fixtures";

const RUN_ID = `s05-${Date.now().toString(36)}`;
let failed = 0;

function gate(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const ctx = await seedAdversarialFixtures(RUN_ID);

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
  const loaded = await prisma.providerDocument.findUniqueOrThrow({
    where: { id: doc.id },
    include: { provider: { select: { userId: true, complianceRestricted: true } } },
  });
  for (let i = 0; i < 10; i++) await complianceExpiryService.evaluateDocument(loaded);
  const reminders = await prisma.partnerComplianceReminder.count({ where: { documentId: doc.id } });
  gate("trust.expiry_idempotent", reminders === 1, `reminders=${reminders}`);

  const sos1 = await partnerSafetyService.triggerSos({
    providerId: ctx.providerId,
    userId: ctx.vendorUserId,
    latitude: 28.6,
    longitude: 77.3,
  });
  const sos2 = await partnerSafetyService.triggerSos({
    providerId: ctx.providerId,
    userId: ctx.vendorUserId,
    latitude: 28.6,
    longitude: 77.3,
  });
  gate("trust.sos_idempotent", sos1.incident.id === sos2.incident.id);

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
  gate("trust.risk_dedup", detail.totalSignals === 1);
  gate("trust.risk_explainable", Boolean(detail.profile?.explanation));

  const booking = await prisma.booking.findFirst({
    where: { providerId: ctx.providerId, status: BookingStatus.COMPLETED },
  });
  gate("trust.fixture_booking", Boolean(booking));
  if (booking) {
    const partnerView = await bookingService.getById(booking.id, undefined, ctx.providerId);
    const rawPhone = ctx.customerA.phoneNumber ?? fixturePhone(RUN_ID, "a");
    gate("trust.privacy_no_forbidden", collectForbiddenPartnerKeys(partnerView).length === 0);
    gate(
      "trust.pii_masked",
      Boolean(partnerView.customer?.phoneMasked) &&
        partnerView.customer?.phoneMasked !== rawPhone &&
        !JSON.stringify(partnerView).includes(rawPhone),
    );
  }

  const otherHistory = await partnerSafetyService.partnerHistory("does-not-exist");
  gate("trust.partner_isolation", Array.isArray(otherHistory) && otherHistory.length === 0);

  await prisma.partnerSafetyIncident.deleteMany({ where: { providerId: ctx.providerId } });
  await prisma.partnerRiskSignal.deleteMany({ where: { providerId: ctx.providerId } });
  await prisma.partnerRiskProfile.deleteMany({ where: { providerId: ctx.providerId } });
  await prisma.partnerComplianceReminder.deleteMany({ where: { providerId: ctx.providerId } });
  await prisma.providerDocument.deleteMany({ where: { providerId: ctx.providerId } });
  await cleanupAdversarialFixtures(RUN_ID);
  await prisma.$disconnect();

  console.log(failed === 0 ? "\nSECTION 05 TRUST DB CERT: FULL PASS" : `\nSECTION 05 TRUST DB CERT: FAIL (${failed})`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
