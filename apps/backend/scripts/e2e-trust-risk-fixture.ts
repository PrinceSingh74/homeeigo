/**
 * Deterministic trust & safety fixture for the admin E2E (apps/admin-panel/e2e/section05-trust.spec.ts).
 *
 * The spec needs a partner risk profile in MONITOR review with an explainable signal. On a long-lived
 * database that came from the section05 live certification; a freshly seeded disposable database has
 * none, so the test failed on data ("need a MONITOR risk profile from live cert"). This script does not
 * fabricate a profile: it records ONE synthetic GPS_SPOOF signal through partnerRiskService.recordSignal —
 * the same entry point the real detectors use — and lets the risk service compute the profile, exactly as
 * the certification did (same severity / confidence).
 *
 * Provenance: the signal names `source: "e2e-fixture"` and carries `evidence.fixture = true`, on the
 * FIXTURE-origin demo partner, in a test database only.
 *
 *   bun --env-file=.env.test run scripts/e2e-trust-risk-fixture.ts
 *
 * Declared target (scripts/lib/script-target.ts): refuses any non-test database — there is deliberately
 * no live use for this script, so `--allow-live` is refused here too.
 */
import prisma from "../src/lib/prisma";
import { partnerRiskService } from "../src/services/partner-risk.service";
import { requireDeclaredTarget } from "./lib/script-target";

async function main() {
  const target = requireDeclaredTarget({ label: "e2e-trust-risk-fixture" });
  if (target.live) {
    console.error("[e2e-trust-risk-fixture] REFUSING: this fixture never runs against a live database");
    process.exit(2);
  }
  const partner = await prisma.provider.findFirst({
    where: { user: { email: "partner@homigo.demo" } },
    select: { id: true, user: { select: { dataOrigin: true } } },
  });
  if (!partner) throw new Error("demo partner partner@homigo.demo not found — run the seeds first");

  await partnerRiskService.recordSignal({
    providerId: partner.id,
    type: "GPS_SPOOF",
    source: "e2e-fixture",
    severity: 55,
    confidence: 0.5,
    evidence: { fixture: true, purpose: "admin trust & safety E2E" },
    fingerprint: `GPS_SPOOF:${partner.id}:e2e-fixture`,
  });
  const risk = await partnerRiskService.detail(partner.id);
  const p = risk.profile as { riskLevel?: string; reviewStatus?: string } | null | undefined;
  console.log(JSON.stringify({ providerId: partner.id, origin: partner.user.dataOrigin, riskLevel: p?.riskLevel, reviewStatus: p?.reviewStatus }));
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
