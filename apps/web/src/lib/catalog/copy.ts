import type { BeautyType, CategoryId, Faq } from "@/lib/catalog/types";

export type ServiceCopy = {
  short?: string;
  includes?: string[];
  excludes?: string[];
  faqs?: Faq[];
  planned?: string[];
};

export const SUBGROUP_COPY: Partial<Record<CategoryId, Record<string, string>>> = {
  "home-help": {
    hourly: "A trained pair of hands for as long as you need — you set the list.",
    daily: "One visit, one chore. Dusting, floors, utensils and kitchen prep.",
    clothes: "Laundry, ironing and folding, done the way you would ask at home.",
    organise: "Packing, unpacking and putting a home back into order.",
  },
  "home-cleaning": {
    rooms: "Bathrooms, kitchens, windows, balconies and whole-home deep cleans.",
    furnishings: "Sofas, mattresses, carpets and wardrobes — cleaned and reset.",
    fixtures: "Fans, fridges and kitchen cabinets, treated with the right method.",
  },
  "event-occasion": {
    express: "A fast refresh before guests arrive, or a reset after they leave.",
    occasions: "Festival prep and larger functions, scoped to the day you are hosting.",
  },
  "home-maintenance": {
    repairs: "Plumbing, electrical, carpentry and the small jobs that keep a home working.",
    installs: "Assembly and mounting — furniture, TVs, rods and blinds, fitted level.",
    painting: "Interior and exterior walls, painted to the surfaces you agree.",
  },
  "appliance-care": {
    cooling: "AC service, cleaning and repair so the home stays cool and the air stays clean.",
    kitchen: "Chimneys, microwaves and the appliances you use every day.",
    utility: "Washing machines, geysers and new installations, set up properly.",
  },
  "specialized-care": {
    pest: "Targeted treatment for pests, plus whole-home sanitisation when you need it.",
    living: "Plants, facades and the outdoor edges of a home.",
    specialist: "Water tanks and delicate surfaces that need a specialist method.",
  },
  "laundry-fabric": {
    wash: "Wash, dry and fold — in our care or on your machine at home.",
    press: "Crisp ironing and steam pressing for everyday and occasion wear.",
    textiles: "Curtains, cushions and upholstery taken care of in place.",
  },
  "vehicle-care": {
    car: "Exterior, interior and full resets for the car, where it is parked.",
    "two-wheeler": "A careful wash for scooters and motorcycles.",
    detail: "Paint, glass and cabin detailing when you want more than a wash.",
  },
  "senior-care": {
    daily: "Scheduled visits and everyday help around the home.",
    outings: "Pharmacy runs, groceries and accompanied appointments.",
    wellness: "Companionship, gentle activity and time together — never medical care.",
  },
  "pet-care": {
    visits: "Walks, feeds, drop-ins and sitting while you are out.",
    grooming: "Baths, brushing and tidy-up grooming — not veterinary treatment.",
  },
  "executive-concierge": {
    drivers: "A professional for your car — on demand or for a regular schedule.",
    errands: "Queues, documents, groceries and the small city tasks on your list.",
    assistance: "An extra pair of hands for home, office or the day ahead.",
  },
  "special-services": {
    moves: "Packing, shifting support and setting up a new home.",
    property: "Check-ins on a home you do not live in, or while you travel.",
    custom: "Work that does not fit a listed service — scoped with you first.",
  },
};

export const BEAUTY_TYPE_COPY: Record<BeautyType, string> = {
  hair: "Cuts, colour, treatments and styling — in a chair at home.",
  skin: "Facials, cleanups and de-tan, matched to the skin in front of us.",
  waxing: "Threading and waxing, done with the products you are comfortable with.",
  nails: "Manicure, pedicure and nail art without a salon wait.",
  makeup: "Occasion makeup and draping, finished where you get dressed.",
  grooming: "Beard, shaving and packages for men, plus gentle care for kids.",
  spa: "Massage and relaxation at home — never a medical treatment.",
  bridal: "Bridal and wedding-party looks, planned with you before the day.",
};

export const DEFAULT_PLANNED = [
  "Choose the option or quantity that fits your home",
  "Add instructions the professional should know",
  "Pick a date and time slot",
  "Pay securely — the final amount is shown before you confirm",
];

/**
 * Slugs that have scope copy (includes / excludes) in service-detail-copy.ts. Only the detail page
 * loads that data; the catalog needs to know merely THAT it exists, because it decides
 * `fallbackApproved`. Kept equal to that module's keys by tests/catalog/service-detail-copy.test.ts.
 */
export const SCOPE_COPY_SLUGS: ReadonlySet<string> = new Set([
  "ac-cleaning", "ac-repair", "appliance-installation", "appointment-assistance", "basic-pet-grooming", "beard-shaving",
  "bike-cleaning", "bleach-detan", "bridal-wedding", "car-deep-cleaning", "car-interior-cleaning", "chimney-cleaning",
  "cleanup", "companion-support", "curtain-care", "curtain-rod-installation", "custom-service-request", "daily-assistance",
  "decluttering-assistance", "document-pickup-drop", "draping", "driver-on-demand", "errand-runner", "fabric-upholstery-care",
  "facial-skin", "festival-home-preparation", "floor-cleaning", "furniture-assembly", "general-handyman", "gentle-grooming",
  "gentle-skin-care", "geyser-service", "glass-surface-cleaning", "grocery-assistance", "grocery-essentials-pickup", "grooming-packages",
  "hair-colour", "hair-styling", "hair-treatments", "haircut-styling", "head-foot-care", "head-massage",
  "home-concierge", "home-move-assistance", "home-organization", "home-setup-assistance", "home-visit-support", "hospital-companion",
  "makeup", "manicure-pedicure", "medicine-pickup", "minor-carpentry", "move-in-move-out-cleaning", "nails",
  "occasion-styling", "office-assistant", "personal-assistance", "personal-driver", "pet-care-visits", "pet-cleaning",
  "pet-feeding", "pet-sitting", "pet-walking", "post-event-cleanup", "property-care-visits", "relaxation",
  "rental-turnover-services", "sanitization", "senior-wellness-support", "small-appliance-care", "spa-massage", "specialized-surface-care",
  "steam-ironing", "threading", "vacation-home-check", "vehicle-detailing", "vet-visit-assistance", "wall-mounting",
  "washing-assistance", "washing-machine-care", "water-tank-cleaning", "waxing",
]);

export function applyServiceCopy(def: {
  slug: string;
  short: string;
  includes?: string[];
  excludes?: string[];
  faqs?: Faq[];
  planned?: string[];
  fallbackApproved?: boolean;
}) {
  // Scope copy itself is read by the detail builder (content.ts → scopeCopyFor), not carried on the
  // definition — that is what keeps it out of the /services hub bundle.
  const hasScope =
    def.includes !== undefined || def.excludes !== undefined
      ? Boolean(def.includes?.length || def.excludes?.length)
      : SCOPE_COPY_SLUGS.has(def.slug);
  return {
    short: def.short,
    includes: def.includes,
    excludes: def.excludes,
    faqs: def.faqs,
    planned: def.planned,
    fallbackApproved: def.fallbackApproved ?? hasScope,
  };
}
