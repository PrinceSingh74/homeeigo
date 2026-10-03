/**
 * Static detector: configured service-domain fields must have a runtime consumer
 * or an explicit CONFIGURATION_ONLY_BY_DESIGN classification.
 *
 *   bun run scripts/audit-service-domain-runtime.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Status = "LIVE" | "CONFIGURATION_ONLY_BY_DESIGN" | "FAIL";

type Row = {
  field: string;
  configured: string;
  consumer: string;
  status: Status;
};

const root = join(import.meta.dir, "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function has(rel: string, needle: string) {
  return read(rel).includes(needle);
}

const rows: Row[] = [
  {
    field: "payment.walletAllowed",
    configured: "catalogConfig.payment",
    consumer: "wallet-checkout.service.ts assertWalletAllowed",
    status: has("src/services/wallet-checkout.service.ts", "assertWalletAllowed") ? "LIVE" : "FAIL",
  },
  {
    field: "payment.splitPaymentAllowed",
    configured: "catalogConfig.payment",
    consumer: "wallet-checkout.service.ts assertSplitAllowed",
    status: has("src/services/wallet-checkout.service.ts", "assertSplitAllowed") ? "LIVE" : "FAIL",
  },
  {
    field: "payment.couponAllowed",
    configured: "catalogConfig.payment",
    consumer: "booking-pricing.service.ts paymentCapabilities",
    status: has("src/services/booking-pricing.service.ts", "couponAvailable") ? "LIVE" : "FAIL",
  },
  {
    field: "payment.membershipAllowed",
    configured: "catalogConfig.payment",
    consumer: "booking-pricing.service.ts membershipAvailable",
    status: has("src/services/booking-pricing.service.ts", "membershipAvailable") ? "LIVE" : "FAIL",
  },
  {
    field: "matching.ratingWeight",
    configured: "catalogConfig.matching",
    consumer: "matching.service.ts applyMatchingWeights",
    status: has("src/services/matching.service.ts", "applyMatchingWeights") ? "LIVE" : "FAIL",
  },
  {
    field: "matching.skillWeight",
    configured: "catalogConfig.matching.skillWeight",
    consumer: "Eligibility uses providerRequirements.requiredSkills, not this numeric weight",
    status: "CONFIGURATION_ONLY_BY_DESIGN",
  },
  {
    field: "quality.proofRequired",
    configured: "catalogConfig.quality",
    consumer: "booking.service.ts complete qualityBlocksCompletion",
    status: has("src/services/booking.service.ts", "qualityBlocksCompletion") ? "LIVE" : "FAIL",
  },
  {
    field: "quality.checklist",
    configured: "catalogConfig.quality",
    consumer: "booking.service.ts complete QUALITY_CHECKLIST_REQUIRED",
    status: has("src/services/booking.service.ts", "qualityBlocksCompletion") ? "LIVE" : "FAIL",
  },
  {
    field: "quality.customerConfirmation",
    configured: "catalogConfig.quality",
    consumer: "Post-job Rating is the confirmation path; no second customer OTP at complete",
    status: "CONFIGURATION_ONLY_BY_DESIGN",
  },
  {
    field: "duration.totalSlotMin",
    configured: "catalogConfig.duration / estimatedDuration",
    consumer: "resolveSelection snapshot.durationMinutes (display + booking.estimatedDuration). Provider slot trigger remains scheduled ±30m",
    status: "CONFIGURATION_ONLY_BY_DESIGN",
  },
  {
    field: "payment.paymentTiming",
    configured: "catalogConfig.payment",
    consumer: "bookingRules.paymentRequiredBeforeDispatch already gates dispatch; paymentTiming enum is unused",
    status: "CONFIGURATION_ONLY_BY_DESIGN",
  },
  {
    field: "payment.invoiceRequired",
    configured: "catalogConfig.payment",
    consumer: "No invoice-required charge path in the existing payment engine",
    status: "CONFIGURATION_ONLY_BY_DESIGN",
  },
  {
    field: "availability.minimumLeadTimeMinutes",
    configured: "catalogConfig.availability",
    consumer: "booking-validation.service.ts validateService",
    status: has("src/services/booking-validation.service.ts", "minimumLeadTimeMinutes") ? "LIVE" : "FAIL",
  },
  {
    field: "quality.warrantyDays",
    configured: "catalogConfig.quality",
    consumer: "booking.service.ts complete warrantyWindow",
    status: has("src/services/booking.service.ts", "warrantyWindow") ? "LIVE" : "FAIL",
  },
  {
    field: "providerRequirements.requiredSkills",
    configured: "catalogConfig.providerRequirements",
    consumer: "matching.service.ts loadCandidates + booking-validation.service.ts",
    status: has("src/services/matching.service.ts", "requiredSkills") ? "LIVE" : "FAIL",
  },
  {
    field: "visibility.customerCatalog",
    configured: "CUSTOMER_CATALOG_WHERE",
    consumer: "catalog.service + service-recommendation + AI service-context",
    status:
      has("src/lib/service-domain.ts", "CUSTOMER_CATALOG_WHERE") &&
      has("src/services/service-recommendation.service.ts", "CUSTOMER_CATALOG_WHERE") &&
      has("src/ai/context/service-context.ts", "CUSTOMER_CATALOG_WHERE")
        ? "LIVE"
        : "FAIL",
  },
  {
    field: "visibility.partnerOperational",
    configured: "PARTNER_OPERATIONAL_WHERE",
    consumer: "catalog.partnerEligible + partnerOnboardingOptions + service-match siblings",
    status:
      has("src/lib/service-domain.ts", "PARTNER_OPERATIONAL_WHERE") &&
      has("src/services/catalog.service.ts", "PARTNER_OPERATIONAL_WHERE") &&
      has("src/lib/service-match.ts", "PARTNER_OPERATIONAL_WHERE")
        ? "LIVE"
        : "FAIL",
  },
  {
    field: "analytics.browse_variant_selected",
    configured: "not a HomigoEvent",
    consumer: "Checkout events stay write-path only; browse counters are service_view/search/quote",
    status: "CONFIGURATION_ONLY_BY_DESIGN",
  },
  {
    field: "quality.revisitEngine",
    configured: "quality.warrantyDays snapshot only",
    consumer: "No Warranty/Revisit domain. Window recorded at complete; claims/revisit assignment not built",
    status: "CONFIGURATION_ONLY_BY_DESIGN",
  },
];

const fails = rows.filter((r) => r.status === "FAIL");
const lines = [
  "# Service domain runtime audit",
  "",
  "| FIELD | CONFIGURED | RUNTIME CONSUMER | STATUS |",
  "|---|---|---|---|",
  ...rows.map((r) => `| ${r.field} | ${r.configured} | ${r.consumer} | ${r.status} |`),
  "",
];
process.stdout.write(lines.join("\n"));
if (fails.length) {
  process.stderr.write(`\nFAIL: ${fails.map((f) => f.field).join(", ")}\n`);
  process.exit(1);
}
