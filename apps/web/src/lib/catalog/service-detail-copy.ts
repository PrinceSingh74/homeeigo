/**
 * Detail-page copy: what a service includes / excludes, and the FAQs per category (2026-10-01).
 *
 * Split out of copy.ts so it is not in the /services hub bundle: only content.ts (the service detail
 * builder) reads it. copy.ts keeps SCOPE_COPY_SLUGS — the slugs that have an entry here — so
 * `fallbackApproved` is derived exactly as before without loading this data. A test keeps the two
 * in step (tests/catalog/service-detail-copy.test.ts).
 */
import type { CategoryId, Faq } from "@/lib/catalog/types";
import type { ServiceCopy } from "@/lib/catalog/copy";

const REPAIR_OUT = [
  "Spare parts and materials — confirmed with you if needed",
  "Civil work such as wall breaking, tiling or masonry",
];

const VISIT_IN = [
  "A trained professional at your door, for the work you booked",
  "Inspection of the reported issue, then work agreed with you on site",
];

export const CATEGORY_FAQS: Partial<Record<CategoryId, Faq[]>> = {
  "home-help": [
    {
      q: "Hourly help or a single task — which should I book?",
      a: "Book Hourly Home Help when you have a list of everyday chores. Book a named task — dusting, utensils, laundry — when you want one job done and priced on its own.",
    },
    {
      q: "Do I need to provide cleaning materials?",
      a: "Use your usual supplies if you prefer. If anything extra is needed, your professional will confirm with you during the visit.",
    },
  ],
  "home-cleaning": [
    {
      q: "What is the difference between Home Help and Home Cleaning?",
      a: "Home Help is everyday housework — dusting, utensils, laundry, prep. Home Cleaning is a dedicated clean: bathrooms, kitchens, deep cleans and furnishings.",
    },
    {
      q: "Will furniture be moved?",
      a: "Light items are shifted so the area can be cleaned. Heavy furniture stays put unless you have asked for it and it is safe to move.",
    },
  ],
  "event-occasion": [
    {
      q: "How early should I book before a party?",
      a: "Book the pre-party clean for the same day or the day before. After-party cleanup can be booked for the evening or the next morning.",
    },
  ],
  "home-maintenance": [
    {
      q: "Are spare parts included in the price?",
      a: "The visit covers inspection and the labour agreed with you. Parts and materials are confirmed and charged only with your approval.",
    },
  ],
  "appliance-care": [
    {
      q: "Do you service every brand?",
      a: "Most household brands can be inspected and serviced. If a spare part or a specialist visit is needed, that is agreed with you before work continues.",
    },
  ],
  "specialized-care": [
    {
      q: "Is pest treatment safe for children and pets?",
      a: "Your professional will explain the product and the waiting time. Plan for children and pets to stay out of treated areas as advised on the visit.",
    },
  ],
  "laundry-fabric": [
    {
      q: "Is dry-cleaning included?",
      a: "Everyday wash, dry, fold and ironing are included in the relevant services. Dry-clean-only garments are excluded unless a dedicated option is offered.",
    },
  ],
  "vehicle-care": [
    {
      q: "Where is the car cleaned?",
      a: "At your parking spot, as long as there is room to work around the vehicle and water access if the service needs it. Mention basement or society rules in booking instructions.",
    },
  ],
  beauty: [
    {
      q: "Who should be present for a kids' appointment?",
      a: "A parent or guardian should be present for kids and teens. Mention allergies or sensitivities in booking instructions.",
    },
  ],
  "senior-care": [
    {
      q: "Is this medical or nursing care?",
      a: "No. Senior Care is non-medical assistance and companionship. It does not include nursing, medical care or administering medication.",
    },
  ],
  "pet-care": [
    {
      q: "Is this a veterinary service?",
      a: "No. Pet Care is walking, feeding, sitting and basic grooming. For medical concerns, please consult a veterinarian.",
    },
  ],
  "executive-concierge": [
    {
      q: "Can I book a driver for my own car?",
      a: "Yes — Driver On Demand is a professional for your vehicle. Share pickup, destination and any society or parking notes in the booking.",
    },
  ],
  "special-services": [
    {
      q: "What if I need something that is not listed?",
      a: "Use Custom Service Request. Tell us the work, the address and the timing — we scope it and confirm before anything is booked.",
    },
  ],
};

export const SCOPE_COPY: Record<string, ServiceCopy> = {
  "home-organization": {
    includes: ["Wardrobes, shelves and drawers sorted into a clear system", "Labelling and grouping so things are easy to find again"],
    excludes: ["Throwing items away without your say", "Buying new storage furniture"],
  },
  "decluttering-assistance": {
    includes: ["Room-by-room sorting into keep, donate and let-go", "Help packing donations you have decided on"],
    excludes: ["Disposing of items you have not approved", "Valuation of antiques or jewellery"],
  },
  "floor-cleaning": {
    includes: ["Machine scrubbing of the agreed floor area", "Careful treatment for tiles, marble or stone as specified"],
    excludes: ["Guaranteed restoration of etched or damaged stone", "Moving heavy furniture"],
  },
  "glass-surface-cleaning": {
    includes: ["Mirrors, glass partitions and reachable shiny surfaces", "Streak-free wipe-down of the agreed glass"],
    excludes: ["Exterior glass on high floors without safe access", "Repairs to frames or hardware"],
  },
  "move-in-move-out-cleaning": {
    includes: ["Empty rooms, kitchen and bathrooms cleaned end to end", "Floors, reachable fixtures and inside of cabinets as agreed"],
    excludes: ["Packing or moving belongings", "Repairs, painting or pest treatment"],
  },
  "festival-home-preparation": {
    includes: ["A focused clean of living areas, kitchen and bathrooms before the day", "Surfaces and floors ready for guests"],
    excludes: ["Decoration, rangoli or mandap setup", "Catering or utensil hire"],
  },
  "post-event-cleanup": {
    includes: ["Trash bagged, dishes handled and floors reset after a larger gathering", "Bathrooms refreshed"],
    excludes: ["Hired furniture or tent takedown", "Waste disposal outside the premises"],
  },
  "minor-carpentry": {
    includes: VISIT_IN,
    excludes: [...REPAIR_OUT, "Full furniture making or modular kitchen fabrication"],
  },
  "furniture-assembly": {
    includes: ["Assembly of the agreed flat-pack items using the parts supplied", "A stability check before we leave"],
    excludes: ["Missing parts from the manufacturer", "Wall anchoring unless you have booked wall mounting"],
  },
  "wall-mounting": {
    includes: ["Secure mounting of the agreed TVs, shelves, mirrors or frames", "A level and load check"],
    excludes: ["Masonry or hidden wiring work", "Mounts or fasteners you have not supplied when the service requires them"],
  },
  "curtain-rod-installation": {
    includes: ["Rods, tracks or blinds fitted level on the agreed windows", "A smooth open-and-close check"],
    excludes: ["Custom fabrication of rods or pelmets", "Wall repairs after old fittings are removed"],
  },
  "general-handyman": {
    includes: ["The small jobs you list for the booked hours", "Basic tools for everyday household fixes"],
    excludes: [...REPAIR_OUT, "Specialist trades already listed as their own service"],
  },
  "ac-cleaning": {
    includes: ["Filter, coil and drain cleaning on the agreed indoor units", "A function check after the clean"],
    excludes: ["Gas refill or spare parts", "Outdoor unit work that needs unsafe access"],
  },
  "ac-repair": {
    includes: VISIT_IN,
    excludes: [...REPAIR_OUT, "Refrigerant gas unless agreed during the visit"],
  },
  "washing-machine-care": {
    includes: ["Drum clean, descaling and a service check of the agreed machine", "Guidance if a part needs replacing"],
    excludes: REPAIR_OUT,
  },
  "chimney-cleaning": {
    includes: ["Filter and hood degreasing for the agreed chimney", "A suction check after the clean"],
    excludes: ["Duct replacement inside the wall", "Spare filters unless agreed"],
  },
  "geyser-service": {
    includes: VISIT_IN,
    excludes: REPAIR_OUT,
  },
  "small-appliance-care": {
    includes: ["Cleaning and a basic function check of the agreed countertop appliances"],
    excludes: ["Opening sealed electronics", "Spare parts"],
  },
  "appliance-installation": {
    includes: ["Unpacking, positioning and setup of the agreed new appliance", "A first-run check where it is safe to do so"],
    excludes: ["Electrical or plumbing points that do not already exist", "Haul-away of old appliances unless agreed"],
  },
  sanitization: {
    includes: ["Disinfection of high-touch surfaces and the rooms you book", "A method explained before treatment starts"],
    excludes: ["Deep cleaning of kitchens or furnishings", "Medical-grade hospital sterilisation"],
  },
  "water-tank-cleaning": {
    includes: ["Draining, scrubbing and disinfection of the agreed tank", "Guidance on refill timing"],
    excludes: ["Tank repair or waterproofing", "Plumbing to the rest of the building"],
  },
  "specialized-surface-care": {
    includes: ["Inspection of marble, wood, stone or the surface you name", "The treatment agreed with you on site"],
    excludes: ["Guaranteed restoration of damaged or stained stone", "Full floor replacement"],
  },
  "washing-assistance": {
    includes: ["Sorting, machine loads and drying on your washer and line or dryer", "Folding of the load from this visit"],
    excludes: ["Dry-clean-only garments", "Detergent you have not provided when you want your own brand"],
  },
  "steam-ironing": {
    includes: ["Steam pressing of the agreed garments", "Neat hanging or folding"],
    excludes: ["Dry-clean-only or heavily embroidered pieces that need a specialist press", "Repairs or alterations"],
  },
  "curtain-care": {
    includes: ["Taking down, cleaning and re-hanging the agreed curtain panels"],
    excludes: ["Dry-clean-only fabrics that cannot be washed on site", "Track or rod repairs"],
  },
  "fabric-upholstery-care": {
    includes: ["Cleaning of the agreed cushions, covers or upholstered pieces", "Spot treatment of fresh stains"],
    excludes: ["Guaranteed removal of set-in stains", "Leather restoration"],
  },
  "car-interior-cleaning": {
    includes: ["Seats, mats, dashboard and cabin wipe-down", "Interior vacuum"],
    excludes: ["Engine bay", "Odour guarantees on old stains or smoke"],
  },
  "car-deep-cleaning": {
    includes: ["Exterior wash and interior deep clean of the agreed vehicle", "Mats, cabin and reachable trims"],
    excludes: ["Paint correction, ceramic coating or engine-bay degreasing"],
  },
  "bike-cleaning": {
    includes: ["Wash and wipe-down of the scooter or motorcycle you book", "Mirrors and reachable plastics"],
    excludes: ["Engine degreasing or chain work", "Paint correction"],
  },
  "vehicle-detailing": {
    includes: ["Detailing of paint, glass and interiors as agreed for the visit"],
    excludes: ["Factory ceramic warranties or paint-thickness guarantees"],
  },
  "home-visit-support": {
    includes: ["A scheduled check-in at home", "Help with the everyday tasks you list for the visit"],
    excludes: ["Nursing, medical care or administering medication"],
  },
  "daily-assistance": {
    includes: ["Help with routines, light chores and errands you set for the hours booked"],
    excludes: ["Nursing, medical care or administering medication"],
  },
  "companion-support": {
    includes: ["Company for conversation, a walk or a hobby at home or nearby"],
    excludes: ["Nursing, medical care or administering medication"],
  },
  "hospital-companion": {
    includes: ["Someone present for hospital waiting time and a calm visit"],
    excludes: ["Medical decisions, nursing or speaking to doctors in your place without your say"],
  },
  "medicine-pickup": {
    includes: ["Collecting a ready prescription from the pharmacy you name", "Delivery to the home address on the booking"],
    excludes: ["Paying for medicines unless you have arranged it", "Clinical advice about the prescription"],
  },
  "appointment-assistance": {
    includes: ["Accompanied travel to and from the appointment you name"],
    excludes: ["Medical care during the appointment", "Paying consultation fees unless arranged"],
  },
  "grocery-assistance": {
    includes: ["A grocery run to the store you name", "Help putting things away at home"],
    excludes: ["Paying for groceries unless you have arranged it"],
  },
  "senior-wellness-support": {
    includes: ["Gentle activity, a familiar routine and company during the visit"],
    excludes: ["Physiotherapy, nursing or medical treatment"],
  },
  "pet-walking": {
    includes: ["A walk at your pet's pace, on the route you prefer", "Fresh water on return"],
    excludes: ["Veterinary care", "Off-lead walking unless you have asked for it in writing"],
  },
  "pet-feeding": {
    includes: ["Meals and fresh water on the schedule you leave", "A quick tidy of the feeding area"],
    excludes: ["Medication unless it is a simple food-mixed dose you have described", "Veterinary care"],
  },
  "pet-sitting": {
    includes: ["Company and care at your home for the hours booked", "Feeding and a comfort break as you instruct"],
    excludes: ["Overnight boarding at another address", "Veterinary care"],
  },
  "pet-cleaning": {
    includes: ["A bath and towel-dry for the pet you book", "Clean-up of the bathing area"],
    excludes: ["Sedation, clipping that needs a salon table, or veterinary treatment"],
  },
  "basic-pet-grooming": {
    includes: ["Brushing, a nail tidy and a basic tidy-up groom"],
    excludes: ["Breed-standard cuts", "Veterinary care"],
  },
  "vet-visit-assistance": {
    includes: ["Accompanied travel to and from the clinic you name"],
    excludes: ["Veterinary decisions or paying clinic fees unless arranged"],
  },
  "pet-care-visits": {
    includes: ["A drop-in for feeding, play and a quick wellbeing check"],
    excludes: ["Veterinary care", "House-sitting overnight unless booked as sitting"],
  },
  "driver-on-demand": {
    includes: ["A professional driver for your car, for the hours and route you book"],
    excludes: ["Fuel, tolls and parking unless you have arranged them", "A vehicle supplied by HOMEEIGO"],
  },
  "personal-driver": {
    includes: ["A dedicated driver for the day or schedule you agree"],
    excludes: ["Fuel, tolls and parking unless arranged", "A vehicle supplied by HOMEEIGO"],
  },
  "office-assistant": {
    includes: ["Admin, filing and the small office tasks you list for the visit"],
    excludes: ["Signed legal authority or access to systems you have not granted"],
  },
  "errand-runner": {
    includes: ["Queues, pickups and the errands on your list, within the booked time"],
    excludes: ["Paying for goods unless you have arranged it"],
  },
  "document-pickup-drop": {
    includes: ["Documents collected and delivered between the addresses you name"],
    excludes: ["Legal witnessing or opening sealed envelopes"],
  },
  "grocery-essentials-pickup": {
    includes: ["Groceries or essentials picked up from the store you name", "Delivery to your door"],
    excludes: ["Paying the bill unless you have arranged it"],
  },
  "home-concierge": {
    includes: ["One coordinator for the home jobs you want organised", "A scope and plan before work is booked"],
    excludes: ["The underlying services themselves — those are booked separately once scoped"],
  },
  "personal-assistance": {
    includes: ["Flexible help for the day you describe", "The tasks you list in the booking"],
    excludes: ["Medical care or acting as a legal representative"],
  },
  "home-move-assistance": {
    includes: ["Help coordinating packing, handing over and the steps of a home move"],
    excludes: ["A goods vehicle unless separately arranged", "Insurance of high-value items"],
  },
  "home-setup-assistance": {
    includes: ["Unpacking, arranging rooms and the setup list you share"],
    excludes: ["Buying furniture", "Electrical or plumbing installs unless booked as their own service"],
  },
  "rental-turnover-services": {
    includes: ["A clean and reset between tenants or guests, to the rooms you book"],
    excludes: ["Repairs, painting or replacing linens you have not supplied"],
  },
  "property-care-visits": {
    includes: ["A scheduled walkthrough of the property", "A short update on what was checked"],
    excludes: ["Living in the property", "Paying society dues unless arranged"],
  },
  "vacation-home-check": {
    includes: ["A look-in while you travel — lights, taps, and the rooms you name", "A message after the visit"],
    excludes: ["Staying overnight", "Forwarding post unless you have asked"],
  },
  "custom-service-request": {
    includes: ["A conversation to scope the work, address and timing", "A clear confirmation before anything is booked"],
    excludes: ["A guaranteed price before the scope is agreed"],
  },
};

const BEAUTY_OUT = [
  "Services not selected for this visit",
  "Treatments you have asked us not to use — mention them in booking instructions",
];

const BEAUTY_SCOPES: Record<string, ServiceCopy> = {
  "haircut-styling": { includes: ["A haircut and finish styling at home", "A consultation on length and shape before cutting"], excludes: BEAUTY_OUT },
  "hair-styling": { includes: ["Braids, buns or the style you ask for", "Products suitable for the hair type"], excludes: BEAUTY_OUT },
  "occasion-styling": { includes: ["Occasion hair for the event you name", "A hold-and-finish check before we leave"], excludes: BEAUTY_OUT },
  "hair-colour": { includes: ["The colour service you book — global, highlights, roots or grey coverage", "A strand conversation before colour goes on"], excludes: [...BEAUTY_OUT, "Guaranteed match to a photograph"] },
  "hair-treatments": { includes: ["A nourishing hair treatment at home", "A rinse and finish as the treatment requires"], excludes: BEAUTY_OUT },
  "facial-skin": { includes: ["A facial matched to the skin in front of us", "Cleanse, treatment and finish"], excludes: BEAUTY_OUT },
  cleanup: { includes: ["A quick skin cleanup and refresh"], excludes: BEAUTY_OUT },
  "bleach-detan": { includes: ["Bleach or de-tan on the areas you book"], excludes: BEAUTY_OUT },
  threading: { includes: ["Brows, upper lip or face threading as selected"], excludes: BEAUTY_OUT },
  waxing: { includes: ["Waxing of the areas you book"], excludes: BEAUTY_OUT },
  "manicure-pedicure": { includes: ["Hand and/or foot care as booked", "Shaping, cuticle care and a finish polish if you want it"], excludes: BEAUTY_OUT },
  nails: { includes: ["Nail art, extensions or polish as selected"], excludes: BEAUTY_OUT },
  makeup: { includes: ["Occasion makeup at home", "A look check in your lighting before we leave"], excludes: BEAUTY_OUT },
  draping: { includes: ["Saree or dupatta draping for the occasion"], excludes: BEAUTY_OUT },
  "bridal-wedding": { includes: ["Bridal or wedding-party makeup and hair as planned with you", "A trial if you have booked one"], excludes: BEAUTY_OUT },
  "spa-massage": { includes: ["A relaxing massage at home, for the duration you book"], excludes: [...BEAUTY_OUT, "Medical or physiotherapy treatment"] },
  "beard-shaving": { includes: ["Beard shaping, a trim or a clean shave as booked"], excludes: BEAUTY_OUT },
  "head-massage": { includes: ["A head and shoulder massage at home"], excludes: [...BEAUTY_OUT, "Medical or physiotherapy treatment"] },
  "grooming-packages": { includes: ["The hair, beard and skin steps included in the package you choose"], excludes: BEAUTY_OUT },
  "gentle-grooming": { includes: ["Age-appropriate grooming basics", "A parent or guardian present for kids and teens"], excludes: BEAUTY_OUT },
  "gentle-skin-care": { includes: ["Mild, soothing skin care suited to mature skin"], excludes: BEAUTY_OUT },
  "head-foot-care": { includes: ["A soothing head and foot session at home"], excludes: [...BEAUTY_OUT, "Medical or physiotherapy treatment"] },
  relaxation: { includes: ["A gentle relaxation session at home"], excludes: [...BEAUTY_OUT, "Medical or physiotherapy treatment"] },
};

Object.assign(SCOPE_COPY, BEAUTY_SCOPES);

/** The scope copy for one service, or undefined. */
export function scopeCopyFor(slug: string): ServiceCopy | undefined {
  return SCOPE_COPY[slug];
}
