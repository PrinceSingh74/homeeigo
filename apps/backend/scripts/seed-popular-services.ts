/**
 * Seed the "Popular Services" catalog (home-page grid) — idempotent.
 *
 * - Upserts the 20 marketplace services (matches the approved reference set),
 *   marking them isPopular with a stable popularity rank for ordering.
 * - Existing services keep their price/description; only flags/rank are set.
 * - Un-marks isPopular on everything else so the home grid is exactly curated.
 * - Deactivates junk load-test services ("Adv Service …", "Eco Service …")
 *   that polluted the customer-facing catalog.
 *
 * Run: cd apps/backend && bun --env-file=.env run scripts/seed-popular-services.ts
 */
import prisma from "../src/lib/prisma";

type Entry = {
  name: string;
  slug: string;
  description: string;
  basePrice: number;
  estimatedDuration: number; // minutes
  category?: string;
  featured?: boolean;
};

const POPULAR: Entry[] = [
  { name: "Hourly Bookings", slug: "hourly-bookings", description: "Book a trained pro by the hour for any household task — you set the agenda.", basePrice: 199, estimatedDuration: 60, featured: true },
  { name: "Bathroom Cleaning", slug: "bathroom-cleaning", description: "Deep scrub of tiles, fittings, WC and shower area with anti-germ treatment.", basePrice: 399, estimatedDuration: 60 },
  { name: "Fridge Cleaning", slug: "fridge-cleaning", description: "Inside-out fridge degrease, defrost wipe-down and shelf sanitisation.", basePrice: 349, estimatedDuration: 45 },
  { name: "Packing or Unpacking", slug: "packing-unpacking", description: "Careful packing or unpacking help for moves — boxes, labelling, arranging.", basePrice: 499, estimatedDuration: 120 },
  { name: "Utensils", slug: "utensil-washing", description: "Sink-to-shelf utensil washing, drying and stacking after meals or parties.", basePrice: 149, estimatedDuration: 30 },
  { name: "Kitchen Prep", slug: "kitchen-prep", description: "Chopping, marination and meal prep by a hygienic, trained kitchen helper.", basePrice: 299, estimatedDuration: 60 },
  { name: "Dusting & Wiping", slug: "dusting-wiping", description: "Full-home dusting and surface wiping — furniture, ledges, decor and more.", basePrice: 249, estimatedDuration: 60 },
  { name: "Sweeping & Mopping", slug: "sweeping-mopping", description: "Daily-style floor sweep and disinfectant mop for every room.", basePrice: 199, estimatedDuration: 45 },
  { name: "Pre-Party Express Clean", slug: "pre-party-express-clean", description: "Rapid pre-guest sparkle: living areas, bathroom touch-up and fragrance finish.", basePrice: 799, estimatedDuration: 120, featured: true },
  { name: "Complete Wardrobe Cleaning", slug: "complete-wardrobe-cleaning", description: "Empty, wipe, re-fold and organise your wardrobe shelf by shelf.", basePrice: 449, estimatedDuration: 90 },
  { name: "After-Party Express Clean", slug: "after-party-express-clean", description: "Post-party rescue: trash-out, dish pile, floors and living-area reset.", basePrice: 899, estimatedDuration: 120 },
  { name: "Ironing & Folding", slug: "ironing-folding", description: "Crisp ironing and neat folding for your weekly laundry pile.", basePrice: 199, estimatedDuration: 45 },
  { name: "Window Cleaning", slug: "window-cleaning", description: "Streak-free glass, tracks and grills for every window in the house.", basePrice: 299, estimatedDuration: 60 },
  { name: "Laundry", slug: "laundry", description: "Wash, dry and fold service using your machine and preferred detergent.", basePrice: 249, estimatedDuration: 90 },
  { name: "Kitchen Cleaning", slug: "kitchen-cleaning", description: "Degrease hob, chimney exterior, counters, sink and cabinet fronts.", basePrice: 549, estimatedDuration: 90 },
  { name: "Balcony Cleaning", slug: "balcony-cleaning", description: "Balcony floor scrub, railing wipe-down and cobweb removal.", basePrice: 299, estimatedDuration: 45 },
  { name: "Fan Cleaning", slug: "fan-cleaning", description: "Ceiling and wall fan blade degrease — no dust showers, we bring covers.", basePrice: 149, estimatedDuration: 30 },
  { name: "Kitchen Cabinet Cleaning", slug: "kitchen-cabinet-cleaning", description: "Empty, degrease and relayer kitchen cabinets and drawers.", basePrice: 399, estimatedDuration: 90 },
  { name: "Plant Care", slug: "plant-care", description: "Watering, pruning, repotting and leaf-shine for your home garden.", basePrice: 199, estimatedDuration: 45, category: "home" },
  { name: "Car Surface Cleaning", slug: "car-surface-cleaning", description: "Doorstep exterior car wash, wax wipe and tyre shine.", basePrice: 349, estimatedDuration: 60 },
];

async function main() {
  let created = 0;
  let updated = 0;

  for (let i = 0; i < POPULAR.length; i++) {
    const e = POPULAR[i]!;
    const rank = 1000 - i; // stable ordering: first in list = most popular
    const existing = await prisma.service.findFirst({
      where: { name: { equals: e.name, mode: "insensitive" } },
    });
    if (existing) {
      await prisma.service.update({
        where: { id: existing.id },
        data: {
          isPopular: true,
          isActive: true,
          popularity: rank,
          ...(e.featured ? { isFeatured: true } : {}),
        },
      });
      updated++;
    } else {
      await prisma.service.create({
        data: {
          name: e.name,
          slug: e.slug,
          description: e.description,
          category: e.category ?? "cleaning",
          basePrice: e.basePrice,
          minPrice: e.basePrice,
          maxPrice: Math.round(e.basePrice * 1.6),
          estimatedDuration: e.estimatedDuration,
          isActive: true,
          isPopular: true,
          isFeatured: e.featured ?? false,
          popularity: rank,
          tags: ["popular", "home-help"],
        },
      });
      created++;
    }
  }

  // Curate: only the list above appears in the home "Popular Services" grid.
  const names = POPULAR.map((e) => e.name);
  const unmarked = await prisma.service.updateMany({
    where: { name: { notIn: names }, isPopular: true },
    data: { isPopular: false },
  });

  // Retire load-test junk from the customer-facing catalog.
  const junk = await prisma.service.updateMany({
    where: {
      OR: [
        { name: { startsWith: "Adv Service" } },
        { name: { startsWith: "Eco Service" } },
      ],
    },
    data: { isActive: false, isPopular: false, isFeatured: false },
  });

  console.log(`popular services → created ${created}, updated ${updated}, unmarked ${unmarked.count}, junk deactivated ${junk.count}`);
  const active = await prisma.service.count({ where: { isActive: true } });
  const popular = await prisma.service.count({ where: { isPopular: true, isActive: true } });
  console.log(`catalog now: ${active} active, ${popular} popular`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
