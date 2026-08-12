/**
 * Idempotent service catalog seed — creates the standard HOMIGO services if they
 * don't already exist (upsert by slug). SAFE: touches only the services table,
 * never users / addresses / bookings (unlike the full destructive seed.ts).
 *
 * For services that already exist, only marketplace presentation fields
 * (subcategory, thumbnail, durationRange, tags) are refreshed — prices and
 * admin-managed fields are never overwritten.
 *
 *   bun --env-file=.env run scripts/seed-services.ts
 */
import prisma from "../src/lib/prisma";

const IMG = (id: string, w = 1200) =>
  `https://images.unsplash.com/${id}?w=${w}&q=90&auto=format&fit=crop`;

type SeedService = {
  name: string;
  slug: string;
  description: string;
  category: string;
  subcategory?: string;
  basePrice: number;
  estimatedDuration: number;
  durationRange?: string;
  isFeatured?: boolean;
  isPopular?: boolean;
  premiumOnly?: boolean;
  thumbnail?: string;
  tags?: string[];
  includedServices?: string[];
};

const SERVICES: SeedService[] = [
  // ---- Core catalog --------------------------------------------------------
  { name: "Deep Cleaning", slug: "deep-cleaning", description: "Professional deep cleaning for your entire home", category: "cleaning", basePrice: 899, estimatedDuration: 120, isFeatured: true, isPopular: true, tags: ["cleaning", "home", "professional"], includedServices: ["Kitchen", "Bathroom", "Living room"] },
  { name: "AC Service", slug: "ac-service", description: "AC maintenance, gas refill, and repair", category: "repair", basePrice: 599, estimatedDuration: 60, isFeatured: true, tags: ["ac", "repair", "cooling"] },
  { name: "Plumbing Repair", slug: "plumbing", description: "Leak fixes, tap installation, and drainage", category: "repair", basePrice: 449, estimatedDuration: 45, tags: ["plumbing", "repair"] },
  { name: "Electrician", slug: "electrician", description: "Wiring, switches, fans and appliance installation", category: "repair", basePrice: 399, estimatedDuration: 45, tags: ["electrical", "repair"] },
  { name: "Salon at Home", slug: "salon-at-home", description: "Haircut, grooming and beauty services at your doorstep", category: "beauty", basePrice: 699, estimatedDuration: 60, isPopular: true, tags: ["salon", "beauty", "grooming"] },
  { name: "Pest Control", slug: "pest-control", description: "Cockroach, termite and general pest treatment", category: "cleaning", basePrice: 1299, estimatedDuration: 90, tags: ["pest", "cleaning"] },
  { name: "Home Painting", slug: "home-painting", description: "Interior and exterior wall painting", category: "home", basePrice: 2499, estimatedDuration: 240, tags: ["painting", "home"] },

  // ---- Marketplace: Home Care ---------------------------------------------
  { name: "Bathroom Cleaning", slug: "bathroom-cleaning", description: "Deep bathroom sanitisation and descaling", category: "cleaning", subcategory: "home-care", basePrice: 199, estimatedDuration: 40, durationRange: "40 mins", isPopular: true, thumbnail: IMG("photo-1620626011761-996317b8d101"), tags: ["cleaning", "bathroom", "home-care"] },
  { name: "Kitchen Cleaning", slug: "kitchen-cleaning", description: "Complete kitchen degrease, chimney exterior and counters", category: "cleaning", subcategory: "home-care", basePrice: 249, estimatedDuration: 45, durationRange: "45 mins", isPopular: true, thumbnail: IMG("photo-1556911220-bff31c812dba"), tags: ["cleaning", "kitchen", "home-care"] },
  { name: "Dusting & Wiping", slug: "dusting-wiping", description: "Full home dusting, surface wiping and cobweb removal", category: "cleaning", subcategory: "home-care", basePrice: 149, estimatedDuration: 30, durationRange: "30 mins", thumbnail: IMG("photo-1581578731548-c64695cc6952"), tags: ["cleaning", "dusting", "home-care"] },
  { name: "Sweeping & Mopping", slug: "sweeping-mopping", description: "Floor sweeping and disinfectant mopping for all rooms", category: "cleaning", subcategory: "home-care", basePrice: 179, estimatedDuration: 40, durationRange: "40 mins", thumbnail: IMG("photo-1563453392213-326a5a1ea2c5"), tags: ["cleaning", "mopping", "home-care"] },

  // ---- Marketplace: Premium Care -------------------------------------------
  { name: "Sofa Deep Cleaning", slug: "sofa-deep-cleaning", description: "Shampoo, vacuum and sanitise sofas and upholstery", category: "cleaning", subcategory: "premium-care", basePrice: 499, estimatedDuration: 40, durationRange: "40 mins", isFeatured: true, thumbnail: IMG("photo-1555041469-a586c61ea9bc"), tags: ["cleaning", "sofa", "premium-care"] },
  { name: "Mattress Sanitization", slug: "mattress-sanitization", description: "UV treatment and deep vacuum for dust-mite free sleep", category: "cleaning", subcategory: "premium-care", basePrice: 899, estimatedDuration: 60, durationRange: "60 mins", thumbnail: IMG("photo-1631049307264-da0ec9d70304"), tags: ["cleaning", "mattress", "premium-care"] },
  { name: "Carpet Shampooing", slug: "carpet-shampooing", description: "Machine shampoo and stain treatment for carpets and rugs", category: "cleaning", subcategory: "premium-care", basePrice: 649, estimatedDuration: 60, durationRange: "60 mins", thumbnail: IMG("photo-1600585154340-be6161a56a0c"), tags: ["cleaning", "carpet", "premium-care"] },

  // ---- Marketplace: Laundry & Wardrobe --------------------------------------
  { name: "Laundry", slug: "laundry", description: "Wash, dry and fold with premium detergents", category: "cleaning", subcategory: "laundry", basePrice: 199, estimatedDuration: 2400, durationRange: "40 hrs", thumbnail: IMG("photo-1582735689369-4fe89db7114c"), tags: ["laundry", "wash"] },
  { name: "Ironing & Folding", slug: "ironing-folding", description: "Crisp steam ironing and neat folding, delivered back", category: "cleaning", subcategory: "laundry", basePrice: 149, estimatedDuration: 1440, durationRange: "24 hrs", thumbnail: IMG("photo-1489274495757-95c7c837b101"), tags: ["laundry", "ironing"] },
  { name: "Complete Wardrobe Cleaning", slug: "wardrobe-cleaning", description: "Full wardrobe declutter, clean and re-organisation", category: "cleaning", subcategory: "laundry", basePrice: 999, estimatedDuration: 4320, durationRange: "72 hrs", isPopular: true, thumbnail: IMG("photo-1558997519-83ea9252edf8"), tags: ["laundry", "wardrobe", "organization"] },

  // ---- Marketplace: Outdoor --------------------------------------------------
  { name: "Balcony Cleaning", slug: "balcony-cleaning", description: "Balcony floor, railing and glass cleaning", category: "cleaning", subcategory: "outdoor", basePrice: 199, estimatedDuration: 30, durationRange: "30 mins", thumbnail: IMG("photo-1600585154340-be6161a56a0c"), tags: ["cleaning", "balcony", "outdoor"] },
  { name: "Plant Care", slug: "plant-care", description: "Watering, pruning, repotting and plant health check", category: "home", subcategory: "outdoor", basePrice: 199, estimatedDuration: 30, durationRange: "30 mins", thumbnail: IMG("photo-1466692479666-897e069cb282"), tags: ["plants", "garden", "outdoor"] },
  { name: "Car Surface Cleaning", slug: "car-surface-cleaning", description: "Exterior wash, polish and interior vacuum at your doorstep", category: "cleaning", subcategory: "outdoor", basePrice: 299, estimatedDuration: 60, durationRange: "60 mins", thumbnail: IMG("photo-1503376780353-7e6692767b70"), tags: ["car", "cleaning", "outdoor"] },

  // ---- Marketplace: Express ---------------------------------------------------
  { name: "Pre-Party Express Clean", slug: "pre-party-express-clean", description: "Rapid whole-home refresh before your guests arrive", category: "cleaning", subcategory: "express", basePrice: 549, estimatedDuration: 60, durationRange: "0-60 mins", isFeatured: true, thumbnail: IMG("photo-1519671482749-fd8f5b4c0b8e"), tags: ["cleaning", "express", "party"] },
  { name: "After-Party Express Clean", slug: "after-party-express-clean", description: "Fast post-event cleanup — trash, dishes, floors and more", category: "cleaning", subcategory: "express", basePrice: 549, estimatedDuration: 60, durationRange: "0-60 mins", isFeatured: true, thumbnail: IMG("photo-1530103862676-de8c9debad1d"), tags: ["cleaning", "express", "party"] },
];

const CITIES = ["Mumbai", "Delhi", "Noida", "Bangalore", "Pune", "Hyderabad"];

async function main() {
  let created = 0;
  let updated = 0;
  for (const s of SERVICES) {
    const existing = await prisma.service.findUnique({ where: { slug: s.slug } });
    if (existing) {
      // Refresh only presentation/grouping fields; never touch admin-managed
      // pricing or availability on existing rows.
      await prisma.service.update({
        where: { slug: s.slug },
        data: {
          subcategory: s.subcategory ?? existing.subcategory,
          thumbnail: existing.thumbnail ?? s.thumbnail,
          durationRange: existing.durationRange ?? s.durationRange,
          tags: existing.tags.length ? existing.tags : (s.tags ?? []),
        },
      });
      updated++;
      continue;
    }
    await prisma.service.create({
      data: {
        name: s.name,
        slug: s.slug,
        description: s.description,
        category: s.category,
        subcategory: s.subcategory,
        basePrice: s.basePrice,
        estimatedDuration: s.estimatedDuration,
        durationRange: s.durationRange,
        isActive: true,
        isFeatured: s.isFeatured ?? false,
        isPopular: s.isPopular ?? false,
        premiumOnly: s.premiumOnly ?? false,
        thumbnail: s.thumbnail,
        availableCities: CITIES,
        tags: s.tags ?? [],
        includedServices: s.includedServices ?? [],
      },
    });
    created++;
  }
  const total = await prisma.service.count();
  console.log(`✅ services seed: created ${created}, refreshed ${updated}, total now ${total}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await prisma.$disconnect();
  process.exit(1);
});
