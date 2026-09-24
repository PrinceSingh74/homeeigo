import { CATEGORY_BY_ID, KIDS_GUIDANCE } from "@/lib/catalog/taxonomy";
import { RESPONSIBILITY_LABELS, SPARE_PARTS_LABELS } from "@/lib/catalog/pricing";
import type { Faq, ServiceView } from "@/lib/catalog/types";
import type { BackendServiceDetail } from "@/types/backend";

/**
 * Facts about the booking flow itself (all verifiable in the product):
 * start PIN, cancellation quote, reschedule, itemised checkout, weather surge.
 */
const BOOKING_FAQS: Faq[] = [
  {
    q: "What happens after I book?",
    a: "Your booking appears under Bookings straight away. Once a professional is assigned you can follow their arrival live, and you share a start PIN with them when they arrive.",
  },
  {
    q: "How is the final price calculated?",
    a: "The price is calculated on our servers from the option, quantity and add-ons you choose. Taxes, any visit fee, discounts and any demand or weather adjustment are itemised at checkout — you always see the final amount before paying.",
  },
  {
    q: "Can I reschedule or cancel?",
    a: "Yes, from Bookings. If a cancellation charge applies, it is shown to you before you confirm.",
  },
];

export const DETAILS_CONFIRMED_AT_BOOKING = "Details will be confirmed during booking.";

export type PolicyRow = { label: string; value: string };

export type ServiceDetailContent = {
  overview: string;
  /** null → nothing configured or approved: show DETAILS_CONFIRMED_AT_BOOKING. */
  scope: { includes: string[]; excludes: string[] } | null;
  prepare: string[];
  safety: string[];
  faqs: Faq[];
  /** Only rows with a real, customer-meaningful value. Empty → not specified. */
  policies: PolicyRow[];
  images: string[];
  cities: string[];
  rating: { value: number; count: number } | null;
  eligibility: string | null;
};

const nonEmpty = (xs: string[] | undefined | null) => (xs ?? []).map((x) => x.trim()).filter(Boolean);

/**
 * Detail content for one service, in strict order of authority:
 *   1. admin-configured backend content (includedServices / excludedServices /
 *      requirements / catalogConfig policies, preparation, safety notes, FAQs)
 *   2. catalogue fallback copy the business has explicitly approved
 *   3. "Details will be confirmed during booking" — never an invented claim.
 */
export function detailContent(svc: ServiceView, detail?: BackendServiceDetail | null): ServiceDetailContent {
  const cat = CATEGORY_BY_ID.get(svc.category)!;
  const def = svc.def;
  const cfg = detail?.catalogConfig ?? svc.config;

  const includes = nonEmpty(detail?.includedServices);
  const excludes = nonEmpty(detail?.excludedServices);
  let scope: ServiceDetailContent["scope"] = null;
  if (includes.length || excludes.length) scope = { includes, excludes };
  else if (def.fallbackApproved && (def.includes?.length || def.excludes?.length)) {
    scope = { includes: def.includes ?? [], excludes: def.excludes ?? [] };
  }

  const policies: PolicyRow[] = [];
  const mat = cfg?.materialPolicy ? RESPONSIBILITY_LABELS[cfg.materialPolicy] : null;
  const eq = cfg?.equipmentPolicy ? RESPONSIBILITY_LABELS[cfg.equipmentPolicy] : null;
  const parts = cfg?.sparePartsPolicy ? SPARE_PARTS_LABELS[cfg.sparePartsPolicy] : null;
  if (mat) policies.push({ label: svc.category === "beauty" ? "Products" : "Materials & products", value: mat });
  if (eq) policies.push({ label: "Tools & equipment", value: eq });
  if (parts) policies.push({ label: "Spare parts", value: parts });

  // Preparation: backend requirements → configured preparation. Never generic category guidance:
  // a prerequisite the backend did not configure is invented (Phase 06 — backend is the truth).
  const requirements = nonEmpty(detail?.requirements);
  const configured = nonEmpty(cfg?.preparation);
  const prepare = requirements.length ? requirements : configured;

  const reviews = detail?.reviewCount ?? 0;
  const rating = detail?.rating;
  const kids = svc.audiences.some((a) => a === "girls" || a === "boys");

  return {
    overview: detail?.detailedDescription?.trim() || svc.description,
    scope,
    prepare,
    safety: nonEmpty(cfg?.safetyNotes),
    faqs: [...(cfg?.faqs ?? []), ...(def.faqs ?? []), ...(cat.faqs ?? []), ...BOOKING_FAQS],
    policies,
    images: nonEmpty(detail?.images),
    cities: nonEmpty(detail?.availableCities),
    // Only a real aggregate from the ratings table — never a placeholder.
    rating: rating != null && rating > 0 && reviews > 0 ? { value: rating, count: reviews } : svc.rating,
    eligibility: cfg?.eligibility?.trim() || (kids ? KIDS_GUIDANCE : null),
  };
}

export const HOW_IT_WORKS = [
  { n: "01", title: "Select", body: "Choose the service and the option that fits your home." },
  { n: "02", title: "Schedule", body: "Pick a date and time slot, add instructions and pay securely." },
  { n: "03", title: "Professional arrives", body: "Track their arrival live and share your start PIN at the door." },
  { n: "04", title: "Service completed", body: "Check the work, then rate your experience." },
] as const;
