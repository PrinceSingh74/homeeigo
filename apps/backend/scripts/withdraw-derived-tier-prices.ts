/**
 * Withdraw script-derived package tier prices (owner decision 2026-09-21).
 *
 * The Basic/Premium tier columns (services.min_price / max_price) of the live catalogue were produced
 * by formulas (scripts/seed-popular-services.ts: maxPrice = round(base × 1.6); a July backfill used
 * 1.5×), not set per service by the business. The owner chose to stop selling them until real prices
 * are supplied: each service keeps only its base price.
 *
 * Goes through the NORMAL admin update path (catalogService.update): version bump, immutable version
 * row, audit record with before/after and reason. Writes an evidence file with every previous value so
 * the change can be reversed exactly. Historical bookings are untouched (they carry their own snapshot).
 *
 *   bun --env-file=.env run scripts/withdraw-derived-tier-prices.ts                      # dry run
 *   bun --env-file=.env run scripts/withdraw-derived-tier-prices.ts --apply --reason "…"  # apply
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import prisma from "../src/lib/prisma";
import { catalogService } from "../src/services/catalog.service";
import { isCommercialOrigin } from "../src/lib/service-domain";

const apply = process.argv.includes("--apply");
const reasonIdx = process.argv.indexOf("--reason");
const reason = reasonIdx > 0 ? process.argv[reasonIdx + 1]?.trim() : undefined;
const db = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "?";

if (apply && !reason) {
  console.error("refusing: --apply requires --reason \"<why>\" (recorded in the audit trail)");
  process.exit(2);
}
console.log(`[withdraw-tiers] target database: ${db} · mode: ${apply ? "APPLY" : "dry run"}`);

const candidates = (
  await prisma.service.findMany({
    where: { isActive: true },
    select: { id: true, serviceCode: true, basePrice: true, minPrice: true, maxPrice: true, version: true, dataOrigin: true },
    orderBy: { serviceCode: "asc" },
  })
).filter(
  (s) => isCommercialOrigin(s.dataOrigin) && ((s.maxPrice ?? s.basePrice) !== s.basePrice || (s.minPrice ?? s.basePrice) !== s.basePrice),
);

const evidence: Array<Record<string, unknown>> = [];
for (const s of candidates) {
  const row = { serviceCode: s.serviceCode, basePrice: s.basePrice, before: { minPrice: s.minPrice, maxPrice: s.maxPrice, version: s.version } };
  if (!apply) {
    console.log(`  would set ${s.serviceCode}: min ${s.minPrice} → ${s.basePrice}, max ${s.maxPrice} → ${s.basePrice}`);
    evidence.push(row);
    continue;
  }
  const r = await catalogService.update(
    s.id,
    { minPrice: s.basePrice, maxPrice: s.basePrice, expectedVersion: s.version, changeReason: reason },
    undefined,
  );
  if ("error" in r && r.error) {
    console.error(`  FAILED ${s.serviceCode}: ${r.error} ${"message" in r ? r.message : ""}`);
    evidence.push({ ...row, error: r.error });
    continue;
  }
  console.log(`  withdrawn ${s.serviceCode}: v${s.version} → v${r.service.version}`);
  evidence.push({ ...row, after: { minPrice: r.service.minPrice, maxPrice: r.service.maxPrice, version: r.service.version } });
}

if (apply) {
  const dir = join(import.meta.dir, "..", "..", "..", "docs", "operations", "evidence");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `tier-price-withdrawal-${db}-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(file, JSON.stringify({ database: db, reason, appliedAt: new Date().toISOString(), services: evidence }, null, 2));
  console.log(`[withdraw-tiers] evidence → ${file}`);
}
console.log(`[withdraw-tiers] ${candidates.length} service(s) ${apply ? "processed" : "would change"}`);
await prisma.$disconnect();
process.exit(evidence.some((e) => "error" in e) ? 1 : 0);
