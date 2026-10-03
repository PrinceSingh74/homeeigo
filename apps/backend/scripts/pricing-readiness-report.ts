/**
 * Pricing readiness report — READ-ONLY. For every service: is it customer-visible, is it priced from
 * authoritative configuration (through the real resolver), and which business inputs are absent.
 *
 *   bun --env-file=.env run scripts/pricing-readiness-report.ts            # markdown
 *   bun --env-file=.env run scripts/pricing-readiness-report.ts --json     # machine-readable
 *   ... --fail-on-incomplete   # exit 1 if any customer-bookable service is not price-complete (CI gate)
 *
 * Never writes. Never invents a value: an empty field is reported as missing.
 */
import prisma from "../src/lib/prisma";
import { loadHydratedCatalog } from "../src/lib/service-catalog-store";
import { TAX_POLICY } from "../src/lib/pricing-policy";
import { assertBookable, assertCustomerSellable, isCommercialOrigin, isServiceCustomerVisible, pricingReadiness } from "../src/lib/service-domain";

type Row = {
  serviceCode: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  state: "FIXTURE" | "UNAVAILABLE" | "COMPLETE" | "INCOMPLETE";
  customerVisible: boolean;
  bookable: boolean;
  lifecycle: string;
  pricingModel: string;
  basePrice: number;
  premiumTierPrice: number | null;
  variants: number;
  variantRequired: boolean;
  addons: "own" | "shared";
  quantityRule: string | null;
  durationMinutes: number;
  partnerSlotPolicy: string;
  tax: string;
  missing: string[];
  businessInputsAbsent: string[];
};

const json = process.argv.includes("--json");
const failOnIncomplete = process.argv.includes("--fail-on-incomplete");

const db = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "?";
const services = await prisma.service.findMany({
  orderBy: [{ category: "asc" }, { slug: "asc" }],
  include: { taxonomyCategory: { select: { slug: true } }, taxonomySubcategory: { select: { slug: true } } },
});

const rows: Row[] = [];
for (const s of services) {
  const cfg = await loadHydratedCatalog(s);
  const visible = isServiceCustomerVisible(s, cfg);
  const pr = pricingReadiness(s, cfg);
  // What a CUSTOMER can actually book: the same two gates the quote applies.
  const bookable = assertCustomerSellable(s, cfg).ok && assertBookable(s, cfg).ok;
  const variants = (cfg?.variants ?? []).filter((v) => v.active);
  const q = cfg?.quantity && cfg.quantity.type !== "NONE" ? cfg.quantity : null;
  const state: Row["state"] = !isCommercialOrigin(s.dataOrigin)
    ? "FIXTURE"
    : !visible || cfg?.comingSoon
      ? "UNAVAILABLE"
      : pr.ok
        ? "COMPLETE"
        : "INCOMPLETE";
  const businessInputsAbsent: string[] = [];
  if (state === "COMPLETE" || state === "INCOMPLETE") {
    if ((s.maxPrice ?? s.basePrice) <= s.basePrice && !variants.length && !q) businessInputsAbsent.push("premium/package tier prices (only the base price is sold)");
    if (!variants.length) businessInputsAbsent.push("variants (none configured)");
    if (!q && ["hourly", "per-unit", "per-seat", "area"].includes(s.pricingModel)) businessInputsAbsent.push(`quantity rule for pricing model "${s.pricingModel}"`);
    if (!pr.ok) businessInputsAbsent.push(...pr.missing.map((m) => `pricing: ${m}`));
  }
  rows.push({
    serviceCode: s.serviceCode,
    name: s.displayName ?? s.name,
    category: s.taxonomyCategory?.slug ?? null,
    subcategory: s.taxonomySubcategory?.slug ?? null,
    state,
    customerVisible: visible,
    bookable,
    lifecycle: s.lifecycleStatus,
    pricingModel: s.pricingModel,
    basePrice: s.basePrice,
    premiumTierPrice: s.maxPrice != null && s.maxPrice > s.basePrice ? s.maxPrice : null,
    variants: variants.length,
    variantRequired: cfg?.variantRequired === true,
    addons: cfg?.addons ? "own" : "shared",
    quantityRule: q ? `${q.type} ${q.min}–${q.max} step ${q.step ?? 1}${q.unitPrice != null ? ` @ ₹${q.unitPrice}` : ""}` : null,
    durationMinutes: s.estimatedDuration,
    partnerSlotPolicy: s.partnerSlotPolicy,
    tax: `${TAX_POLICY.mode} ${TAX_POLICY.rateBps / 100}%`,
    missing: pr.ok ? [] : pr.missing,
    businessInputsAbsent,
  });
}
await prisma.$disconnect();

const unsafe = rows.filter((r) => r.bookable && r.state !== "COMPLETE");
const summary = {
  database: db,
  generatedAt: new Date().toISOString(),
  total: rows.length,
  byState: rows.reduce<Record<string, number>>((m, r) => ((m[r.state] = (m[r.state] ?? 0) + 1), m), {}),
  bookableButNotPriceComplete: unsafe.length,
};

if (json) {
  console.log(JSON.stringify({ summary, rows }, null, 2));
} else {
  console.log(`# Pricing readiness — ${summary.database} — ${summary.generatedAt}\n`);
  console.log(`States: ${JSON.stringify(summary.byState)} · bookable-but-not-price-complete: **${summary.bookableButNotPriceComplete}**\n`);
  console.log("| code | name | category | state | bookable | model | base ₹ | premium ₹ | variants | quantity | missing |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows.filter((x) => x.state !== "FIXTURE")) {
    console.log(
      `| ${r.serviceCode} | ${r.name} | ${r.category ?? "-"} | ${r.state} | ${r.bookable ? "yes" : "no"} | ${r.pricingModel} | ${r.basePrice} | ${r.premiumTierPrice ?? "-"} | ${r.variants} | ${r.quantityRule ?? "-"} | ${r.missing.join("; ") || "-"} |`,
    );
  }
  console.log(`\nFixture/test rows (never customer-facing): ${rows.filter((x) => x.state === "FIXTURE").length}`);
}
if (failOnIncomplete && unsafe.length > 0) {
  console.error(`FAIL: ${unsafe.length} bookable service(s) are not price-complete: ${unsafe.map((r) => r.serviceCode).join(", ")}`);
  process.exit(1);
}
