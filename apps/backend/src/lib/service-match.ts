import type { Prisma } from "@prisma/client";
import prisma from "./prisma";

export type ServiceMatchTokens = {
  serviceId: string;
  category: string;
  serviceSlug: string;
  categoryServiceIds: string[];
  /** Values stored in `provider.serviceCategories` during partner registration. */
  partnerRegistrationSlugs: string[];
};

/**
 * Partner registration UI slugs (partner-web Step2Services) → catalog categories.
 * Partners pick "plumbing" but the service catalog uses category "repair".
 */
const PARTNER_SLUG_TO_CATEGORIES: Record<string, string[]> = {
  cleaning: ["cleaning"],
  plumbing: ["repair"],
  "ac-repair": ["repair"],
  electrician: ["repair"],
  "pest-control": ["cleaning"],
  salon: ["beauty"],
  "appliance-repair": ["repair"],
};

/** Service slug → partner registration slugs that can fulfill it. */
const SERVICE_SLUG_TO_PARTNER_SLUGS: Record<string, string[]> = {
  "deep-cleaning": ["cleaning"],
  "bathroom-cleaning": ["cleaning"],
  "pest-control": ["cleaning", "pest-control"],
  plumbing: ["plumbing"],
  "ac-service": ["ac-repair"],
  electrician: ["electrician"],
  "salon-at-home": ["salon"],
  "home-painting": ["cleaning"],
  // Marketplace catalog (services page sections) — all fulfilled by cleaning partners.
  "kitchen-cleaning": ["cleaning"],
  "dusting-wiping": ["cleaning"],
  "sweeping-mopping": ["cleaning"],
  "sofa-deep-cleaning": ["cleaning"],
  "mattress-sanitization": ["cleaning"],
  "carpet-shampooing": ["cleaning"],
  laundry: ["cleaning"],
  "ironing-folding": ["cleaning"],
  "wardrobe-cleaning": ["cleaning"],
  "balcony-cleaning": ["cleaning"],
  "plant-care": ["cleaning"],
  "car-surface-cleaning": ["cleaning"],
  "pre-party-express-clean": ["cleaning"],
  "after-party-express-clean": ["cleaning"],
};

function resolvePartnerRegistrationSlugs(category: string, serviceSlug: string): string[] {
  const slugs = new Set<string>([category, serviceSlug]);

  for (const s of SERVICE_SLUG_TO_PARTNER_SLUGS[serviceSlug] ?? []) {
    slugs.add(s);
  }

  for (const [partnerSlug, categories] of Object.entries(PARTNER_SLUG_TO_CATEGORIES)) {
    if (categories.includes(category)) {
      slugs.add(partnerSlug);
    }
  }

  return [...slugs];
}

/** Resolve how a booked service maps to provider `serviceCategories` values. */
export async function resolveServiceMatchTokens(
  serviceId: string,
): Promise<ServiceMatchTokens | null> {
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { id: true, category: true, slug: true },
  });
  if (!service) return null;

  const categoryServices = await prisma.service.findMany({
    where: { category: service.category, isActive: true },
    select: { id: true },
  });

  return {
    serviceId: service.id,
    category: service.category,
    serviceSlug: service.slug,
    categoryServiceIds: categoryServices.map((s) => s.id),
    partnerRegistrationSlugs: resolvePartnerRegistrationSlugs(service.category, service.slug),
  };
}

/** Prisma filter: provider offers this service (by id, category, slug, or sibling service id). */
export function serviceCategoryMatchWhere(
  tokens: ServiceMatchTokens,
): Prisma.ProviderWhereInput {
  return {
    OR: [
      { serviceCategories: { has: tokens.serviceId } },
      { serviceCategories: { has: tokens.category } },
      { serviceCategories: { has: tokens.serviceSlug } },
      { serviceCategories: { hasSome: tokens.categoryServiceIds } },
      { serviceCategories: { hasSome: tokens.partnerRegistrationSlugs } },
    ],
  };
}

export function providerOffersService(
  serviceCategories: string[],
  tokens: ServiceMatchTokens,
): boolean {
  if (serviceCategories.includes(tokens.serviceId)) return true;
  if (serviceCategories.includes(tokens.category)) return true;
  if (serviceCategories.includes(tokens.serviceSlug)) return true;
  if (serviceCategories.some((entry) => tokens.categoryServiceIds.includes(entry))) return true;
  return serviceCategories.some((entry) => tokens.partnerRegistrationSlugs.includes(entry));
}
