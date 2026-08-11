import prisma from "../../lib/prisma";
import {
  CONTEXT_FIELD_ALLOWLIST,
  CONTEXT_LIMITS,
  enforceContextBudget,
  pickAllowed,
  type ContextScope,
  type ContextSection,
} from "./context-policy";
import type { AiIntent } from "../intent/intent-classifier";

export type ServiceContextInput = {
  message: string;
  intent: AiIntent;
  scope: ContextScope;
  city?: string;
};

export type ServiceContextResult = {
  /** Rendered context, already budget-bounded. Empty when the scope allows nothing. */
  content: string;
  /** Sections actually included — surfaced for audit and debugging. */
  sections: string[];
  /** Sections dropped by the budget, so silent truncation is visible. */
  dropped: string[];
  /** Catalogue rows the model was shown; the route uses these to keep CTAs real. */
  services: Array<{ id: string; name: string; category: string; basePrice: number }>;
};

/**
 * Maps free text to catalogue categories.
 *
 * Deliberately generous on Hinglish and colloquial spellings — a customer typing
 * "kitchen safai" or "a/c service" must reach the same categories an English speaker does,
 * or the model gets an empty catalogue and invents services that do not exist.
 */
const CATEGORY_HINTS: Array<[RegExp, string[]]> = [
  [/kitchen|chimney|safai|clean\w*|jhaadu|sofa|carpet|bathroom|deep\s*clean/i, ["cleaning", "home-cleaning"]],
  [/plumb\w*|tap|leak|pipe|nal|drain|toilet/i, ["plumbing"]],
  [/electric\w*|wiring|switch|fan|light|bijli|mcb/i, ["electrical"]],
  [/ac\b|a\/c|air\s*condition\w*|cooling|hvac/i, ["ac-repair", "appliance-repair"]],
  [/fridge|refrigerat\w*|washing\s*machine|microwave|geyser|appliance/i, ["appliance-repair"]],
  [/carpent\w*|furniture|door|wood|almirah/i, ["carpentry"]],
  [/paint\w*|whitewash|putty/i, ["painting"]],
  [/pest|cockroach|termite|mosquito|keeda/i, ["pest-control"]],
  [/salon|saloon|spa|haircut|beauty|massage|grooming/i, ["salon", "beauty"]],
];

function inferCategories(message: string): string[] {
  const matched = new Set<string>();
  for (const [pattern, categories] of CATEGORY_HINTS) {
    if (pattern.test(message)) categories.forEach((c) => matched.add(c));
  }
  return [...matched];
}

/**
 * Builds the minimal context for a customer service question.
 *
 * Only what the policy permits is queried — an unauthorised section is never fetched, not
 * merely filtered afterwards, so a policy mistake cannot become a data leak in a log or a
 * timing signal. Every row is reduced to its allowlisted fields before rendering.
 */
/**
 * The real category list, for redirects.
 *
 * Telling the model only "no match" leaves it to guess what we *do* offer — it suggested
 * plumbing and electrical, neither of which is in this catalogue. Supplying the actual
 * categories keeps the redirect as grounded as the recommendation.
 */
async function activeCategories(city?: string): Promise<string[]> {
  const rows = await prisma.service.groupBy({
    by: ["category"],
    where: {
      isActive: true,
      ...(city ? { OR: [{ availableCities: { isEmpty: true } }, { availableCities: { has: city } }] } : {}),
    },
  });
  return rows.map((r) => r.category).sort();
}

export async function buildServiceContext(input: ServiceContextInput): Promise<ServiceContextResult> {
  const { scope, message, city } = input;
  const sections: ContextSection[] = [];
  const services: ServiceContextResult["services"] = [];

  if (scope.serviceCatalog) {
    const categories = inferCategories(message);

    // A specific request that matches no category must produce "we do not offer that",
    // never the whole catalogue. Dropping the filter here meant "rocket launch service"
    // was answered with eight cleaning services — exactly the invented-offer failure the
    // grounding exists to prevent. A GENERAL turn is different: a small popular sample is
    // a reasonable answer to "hello".
    const targeted = input.intent === "SERVICE_SEARCH" || input.intent === "PRICING_INQUIRY";
    if (targeted && categories.length === 0) {
      sections.push({
        name: "service_catalog_empty",
        priority: 100,
        content:
          `No HOMIGO service matches this request${city ? ` in ${city}` : ""}. Do not invent services or promise availability; say it is not currently offered.`,
      });
    }

    const rows = targeted && categories.length === 0 ? [] : await prisma.service.findMany({
      where: {
        isActive: true,
        ...(categories.length > 0 ? { category: { in: categories } } : {}),
        // Serviceability is modelled positively in this catalogue: `availableCities` lists
        // where a service runs, and an empty list means everywhere. A negated `has` filter
        // is deliberately avoided — Prisma turns `NOT { has }` into a predicate that also
        // excludes rows with an empty array, which silently emptied the whole catalogue.
        ...(city && scope.serviceability
          ? { OR: [{ availableCities: { isEmpty: true } }, { availableCities: { has: city } }] }
          : {}),
      },
      select: {
        id: true,
        name: true,
        category: true,
        basePrice: true,
        minPrice: true,
        maxPrice: true,
        estimatedDuration: true,
        availableCities: true,
        unavailableCities: true,
      },
      orderBy: [{ isPopular: "desc" }, { popularity: "desc" }],
      // Over-fetch so the explicit-exclusion pass below cannot leave us short.
      take: CONTEXT_LIMITS.maxCatalogItems * 3,
    });

    // Explicit exclusions applied in-process, for the same Prisma reason as above.
    const eligible = (city
      ? rows.filter((row) => !row.unavailableCities.includes(city))
      : rows
    ).slice(0, CONTEXT_LIMITS.maxCatalogItems);

    for (const row of eligible) {
      services.push({ id: row.id, name: row.name, category: row.category, basePrice: row.basePrice });
    }

    if (eligible.length > 0) {
      const lines = eligible.map((row) => {
        const base = pickAllowed(
          { ...row, durationMinutes: row.estimatedDuration },
          CONTEXT_FIELD_ALLOWLIST.service,
        );
        // Pricing is a separate scope: a customer who only asked "do you clean kitchens"
        // gets the catalogue without a price the model might present as a firm quote.
        const price = scope.pricing
          ? ` — from ₹${row.minPrice ?? row.basePrice}${row.maxPrice ? ` to ₹${row.maxPrice}` : ""}`
          : "";
        return `- ${base.name} (${base.category}, ~${row.estimatedDuration} min)${price}`;
      });
      sections.push({
        name: "service_catalog",
        priority: 100,
        content: `HOMIGO services available${city ? ` in ${city}` : ""}:\n${lines.join("\n")}`,
      });
    }

    if (eligible.length === 0 && !sections.some((sec) => sec.name === "service_catalog_empty")) {
      // An explicit "nothing matched" beats an absent section: without it the model fills
      // the gap with services HOMIGO does not offer.
      sections.push({
        name: "service_catalog_empty",
        priority: 100,
        content:
          `No HOMIGO service matches this request${city ? ` in ${city}` : ""}. Do not invent services or promise availability; say it is not currently offered.`,
      });
    }

    // Whenever we could not offer anything, name the categories we actually run so the
    // model's redirect is grounded rather than guessed.
    if (services.length === 0) {
      const cats = await activeCategories(city);
      if (cats.length > 0) {
        sections.push({
          name: "available_categories",
          priority: 95,
          content: `The ONLY service categories HOMIGO offers${city ? ` in ${city}` : ""} are: ${cats.join(", ")}. Never mention a category outside this list.`,
        });
      }
    }
  }

  if (scope.serviceability && city) {
    const serviceable = await prisma.service.count({
      where: {
        isActive: true,
        OR: [{ availableCities: { isEmpty: true } }, { availableCities: { has: city } }],
      },
    });
    sections.push({
      name: "serviceability",
      priority: 90,
      content:
        serviceable > 0
          ? `Serviceability: HOMIGO operates in ${city}.`
          : `Serviceability: HOMIGO does not currently operate in ${city}. Do not promise a booking.`,
    });
  }

  if (scope.providerAvailability) {
    const categories = inferCategories(message);
    if (categories.length > 0) {
      // Aggregate only. Partner identity, location and contact details are never sent —
      // a count answers "can this be served" without exposing anyone.
      const available = await prisma.provider.count({
        where: {
          isActive: true,
          isApproved: true,
          isBanned: false,
          serviceCategories: { hasSome: categories },
          ...(city ? { city } : {}),
        },
      });
      sections.push({
        name: "provider_availability",
        priority: 80,
        content:
          available > 0
            ? `Provider availability: ${available} verified professional(s) currently cover this category${city ? ` in ${city}` : ""}.`
            : `Provider availability: no verified professional currently covers this category${city ? ` in ${city}` : ""}. Do not promise same-day service.`,
      });
    }
  }

  const { kept, dropped } = enforceContextBudget(sections);
  return {
    content: kept.map((s) => s.content).join("\n\n"),
    sections: kept.map((s) => s.name),
    dropped,
    services,
  };
}
