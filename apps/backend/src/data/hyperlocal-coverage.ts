/**
 * HOMIGO Hyperlocal Coverage Engine v1 — geography seeds + deterministic derivation.
 *
 * This is a pure, dependency-free module: city → area → pincode → society geography
 * with metric derivation that is stable across restarts (seeded hashing, no RNG).
 * The coverage.service blends these baselines with live PostgreSQL aggregates
 * (providers per city, completed bookings, live catalog) when real data exists.
 *
 * NOTE: apps/web/src/lib/coverage/coverage-engine.ts mirrors this file as the
 * client-side fallback when the API is unreachable. Keep both in sync.
 */

export type CoverageStatus = "AVAILABLE" | "LIMITED" | "COMING_SOON";
export type DensityLevel = "HIGH" | "MEDIUM" | "LOW";
export type ServiceDayAvailability = "TODAY" | "TOMORROW" | "UNAVAILABLE";

export type AreaSeed = {
  name: string;
  status: CoverageStatus;
  pincodes: string[];
  societies: string[];
};

export type CitySeed = {
  slug: string;
  name: string;
  state: string;
  tier: 1 | 2;
  launchedYear: number;
  areas: AreaSeed[];
};

export type CityCoverageSummary = {
  slug: string;
  name: string;
  state: string;
  tier: number;
  status: CoverageStatus;
  areaCount: number;
  pincodeCount: number;
  societyCount: number;
  activePartners: number;
  customers: number;
  servicesCompleted: number;
  fulfillmentRate: number;
  coverageScore: number;
};

export type AreaCoverage = {
  id: string;
  name: string;
  status: CoverageStatus;
  pincodes: string[];
  societyCount: number;
  activePartners: number;
  density: DensityLevel;
  avgArrivalMins: number;
};

export type PincodeCoverage = {
  pincode: string;
  areaName: string;
  status: CoverageStatus;
  partnerCount: number;
};

export type SocietyCoverage = {
  id: string;
  name: string;
  areaName: string;
  status: CoverageStatus;
  partnerCount: number;
  avgResponseMins: number;
  rating: number;
  availableServices: string[];
};

export type ServiceAvailability = {
  name: string;
  slug: string;
  availability: ServiceDayAvailability;
};

export type ResponseEngine = {
  avgArrivalMins: number;
  acceptanceRate: number;
  completionRate: number;
  cancellationRate: number;
};

export type CityCoverageDetail = {
  summary: CityCoverageSummary;
  areas: AreaCoverage[];
  pincodes: PincodeCoverage[];
  societies: SocietyCoverage[];
  services: ServiceAvailability[];
  responseEngine: ResponseEngine;
  generatedAt: string;
};

export type CoverageSearchResult = {
  type: "CITY" | "AREA" | "PINCODE" | "SOCIETY";
  covered: boolean;
  status: CoverageStatus;
  citySlug: string;
  cityName: string;
  label: string;
  sublabel: string;
  partnersNearby: number;
  expectedArrivalMins: number;
  availableToday: boolean;
};

/** Core services shown per area when the live catalog is unavailable. */
export const CORE_COVERAGE_SERVICES: Array<{ name: string; slug: string }> = [
  { name: "Bathroom Cleaning", slug: "bathroom-cleaning" },
  { name: "Kitchen Cleaning", slug: "kitchen-cleaning" },
  { name: "Laundry", slug: "laundry" },
  { name: "Balcony Cleaning", slug: "balcony-cleaning" },
  { name: "Plant Care", slug: "plant-care" },
  { name: "Wardrobe Cleaning", slug: "wardrobe-cleaning" },
];

/* -------------------------------------------------------------------------- */
/*  Geography seeds — 11 launch cities                                         */
/* -------------------------------------------------------------------------- */

export const CITY_SEEDS: CitySeed[] = [
  {
    slug: "delhi",
    name: "Delhi",
    state: "Delhi NCR",
    tier: 1,
    launchedYear: 2024,
    areas: [
      {
        name: "South Delhi",
        status: "AVAILABLE",
        pincodes: ["110016", "110017", "110019", "110024", "110049"],
        societies: ["The Magnolias GK", "Ansal Neel Padam", "DDA SFS Saket", "Uday Park Apartments", "Gulmohar Enclave"],
      },
      {
        name: "West Delhi",
        status: "AVAILABLE",
        pincodes: ["110015", "110018", "110026", "110027", "110058"],
        societies: ["DLF Capital Greens", "Unity The Amaryllis", "Janakpuri C4E Blocks", "Rajouri Apartments", "Punjabi Bagh Enclave"],
      },
      {
        name: "East Delhi",
        status: "AVAILABLE",
        pincodes: ["110091", "110092", "110096"],
        societies: ["Mayur Vihar Ph-1 CGHS", "IP Extension Towers", "Supreme Enclave", "Vasundhara Enclave CGHS"],
      },
      {
        name: "North Delhi",
        status: "LIMITED",
        pincodes: ["110007", "110009", "110033", "110035"],
        societies: ["Model Town Villas", "Mukherjee Nagar Heights", "GTB Enclave"],
      },
      {
        name: "Central Delhi",
        status: "AVAILABLE",
        pincodes: ["110001", "110002", "110005", "110060"],
        societies: ["Connaught Residency", "New Rajinder Nagar Blocks", "Karol Bagh Towers"],
      },
      {
        name: "Dwarka",
        status: "AVAILABLE",
        pincodes: ["110075", "110077", "110078"],
        societies: ["DDA Shubham Apartments", "Sispal Vihar CGHS", "Bharat Vandana Apartments", "Metro View Apartments"],
      },
      {
        name: "Rohini",
        status: "COMING_SOON",
        pincodes: ["110085", "110089"],
        societies: ["Rohini Heights", "Jaipuria Sunrise Greens"],
      },
    ],
  },
  {
    slug: "gurgaon",
    name: "Gurgaon",
    state: "Haryana",
    tier: 1,
    launchedYear: 2024,
    areas: [
      {
        name: "Golf Course Road",
        status: "AVAILABLE",
        pincodes: ["122002", "122009"],
        societies: ["DLF Camellias", "DLF Crest", "DLF Magnolias", "DLF Aralias", "Ireo Grand Arch", "Salcon The Verandas"],
      },
      {
        name: "DLF Phase 1-5",
        status: "AVAILABLE",
        pincodes: ["122002", "122009", "122010"],
        societies: ["DLF Phase 1 Blocks", "DLF Phase 2 Silver Oaks", "DLF Phase 3 U-Block", "DLF Phase 4 Regency Park", "DLF Phase 5 Park Place", "DLF Belaire"],
      },
      {
        name: "Sector 14-31",
        status: "AVAILABLE",
        pincodes: ["122001", "122003", "122022"],
        societies: ["Sector 14 HUDA Colony", "Sector 22 Jal Vayu Vihar", "Sector 29 Housing Board", "Sector 31 HUDA"],
      },
      {
        name: "Sector 43-57",
        status: "AVAILABLE",
        pincodes: ["122003", "122011", "122018"],
        societies: ["Tulip Violet", "Central Park Resorts", "Vipul Greens", "Bestech Park View Spa", "Unitech Fresco"],
      },
      {
        name: "Sohna Road",
        status: "AVAILABLE",
        pincodes: ["122018", "122101", "122102"],
        societies: ["M3M Golf Estate", "Eldeco Accolade", "Central Park Flower Valley", "Vatika City"],
      },
      {
        name: "Sector 65-70 (SPR)",
        status: "LIMITED",
        pincodes: ["122018", "122101"],
        societies: ["M3M Merlin", "Ireo Victory Valley", "Emaar Emerald Hills", "Tata Primanti"],
      },
      {
        name: "New Gurgaon (Sec 81-95)",
        status: "COMING_SOON",
        pincodes: ["122004", "122051", "122505"],
        societies: ["DLF New Town Heights", "Emaar Palm Hills", "Sare Homes"],
      },
    ],
  },
  {
    slug: "mumbai",
    name: "Mumbai",
    state: "Maharashtra",
    tier: 1,
    launchedYear: 2024,
    areas: [
      {
        name: "Andheri West",
        status: "AVAILABLE",
        pincodes: ["400053", "400058", "400061"],
        societies: ["Oberoi Springs", "Lokhandwala Complex", "Veera Desai Residency", "Yamuna Nagar CHS"],
      },
      {
        name: "Bandra",
        status: "AVAILABLE",
        pincodes: ["400050", "400051"],
        societies: ["Pali Hill Residency", "Bandstand Apartments", "Carter Road CHS", "Mount Mary Heights"],
      },
      {
        name: "Powai",
        status: "AVAILABLE",
        pincodes: ["400076"],
        societies: ["Hiranandani Gardens", "Lake Homes", "Raheja Vihar", "Nahar Amrit Shakti"],
      },
      {
        name: "Lower Parel & Worli",
        status: "AVAILABLE",
        pincodes: ["400013", "400018", "400030"],
        societies: ["Lodha Park", "Indiabulls Blu", "Ashok Towers", "Planet Godrej"],
      },
      {
        name: "Goregaon & Malad",
        status: "LIMITED",
        pincodes: ["400062", "400064", "400097"],
        societies: ["Oberoi Woods", "Raheja Ridgewood", "Evershine Millennium"],
      },
      {
        name: "Juhu & Vile Parle",
        status: "AVAILABLE",
        pincodes: ["400049", "400056"],
        societies: ["Juhu Tara Residency", "Silver Beach CHS", "Parle Heritage"],
      },
      {
        name: "Chembur",
        status: "COMING_SOON",
        pincodes: ["400071", "400089"],
        societies: ["Diamond Garden CHS", "L&T Emerald Isle"],
      },
    ],
  },
  {
    slug: "bangalore",
    name: "Bangalore",
    state: "Karnataka",
    tier: 1,
    launchedYear: 2024,
    areas: [
      {
        name: "Indiranagar",
        status: "AVAILABLE",
        pincodes: ["560038", "560008"],
        societies: ["Defence Colony Blocks", "Purva Carnation", "HAL 2nd Stage Residency"],
      },
      {
        name: "Koramangala",
        status: "AVAILABLE",
        pincodes: ["560034", "560095"],
        societies: ["Raheja Residency", "Sobha Magnolia", "ST Bed Layout", "National Games Village"],
      },
      {
        name: "Whitefield",
        status: "AVAILABLE",
        pincodes: ["560066", "560048"],
        societies: ["Prestige Shantiniketan", "Brigade Lakefront", "Sobha Dream Acres", "Prestige Lakeside Habitat"],
      },
      {
        name: "HSR Layout",
        status: "AVAILABLE",
        pincodes: ["560102"],
        societies: ["HSR Sector Blocks", "Purva Fountain Square", "Salarpuria Serenity"],
      },
      {
        name: "Sarjapur Road",
        status: "LIMITED",
        pincodes: ["560035", "560103"],
        societies: ["Prestige Ferns Residency", "Sobha Silicon Oasis", "Bren Unity"],
      },
      {
        name: "Hebbal & Yelahanka",
        status: "COMING_SOON",
        pincodes: ["560024", "560064"],
        societies: ["Prestige Misty Waters", "Purva Venezia"],
      },
      {
        name: "Jayanagar & JP Nagar",
        status: "AVAILABLE",
        pincodes: ["560041", "560078"],
        societies: ["Brigade Millennium", "Mantri Elegance", "Jayanagar Blocks"],
      },
    ],
  },
  {
    slug: "pune",
    name: "Pune",
    state: "Maharashtra",
    tier: 1,
    launchedYear: 2025,
    areas: [
      {
        name: "Koregaon Park",
        status: "AVAILABLE",
        pincodes: ["411001", "411036"],
        societies: ["Trump Towers Pune", "Panchshil Towers", "KP Annexe Residency"],
      },
      {
        name: "Baner & Balewadi",
        status: "AVAILABLE",
        pincodes: ["411045"],
        societies: ["Rohan Leher", "Supreme Amadore", "Paranjape Blue Ridge Annexe"],
      },
      {
        name: "Hinjewadi & Wakad",
        status: "AVAILABLE",
        pincodes: ["411057", "411033"],
        societies: ["Blue Ridge Township", "Megapolis Smart Homes", "Kolte Patil Life Republic"],
      },
      {
        name: "Kharadi & Viman Nagar",
        status: "AVAILABLE",
        pincodes: ["411014"],
        societies: ["Gera Emerald City", "Marvel Piazza", "Kumar Purab"],
      },
      {
        name: "Hadapsar & Magarpatta",
        status: "LIMITED",
        pincodes: ["411028", "411013"],
        societies: ["Magarpatta City", "Amanora Park Town", "Nyati Elysia"],
      },
      {
        name: "Kothrud",
        status: "COMING_SOON",
        pincodes: ["411038"],
        societies: ["Nirmiti Emporio", "Kothrud Depot Residency"],
      },
    ],
  },
  {
    slug: "noida",
    name: "Noida",
    state: "Uttar Pradesh",
    tier: 1,
    launchedYear: 2024,
    areas: [
      {
        name: "Sector 15-37 (Core)",
        status: "AVAILABLE",
        pincodes: ["201301"],
        societies: ["Sector 15A Villas", "Arun Vihar", "Sector 29 Brahmaputra Apartments"],
      },
      {
        name: "Sector 50-62",
        status: "AVAILABLE",
        pincodes: ["201301", "201307", "201309"],
        societies: ["Mahagun Moderne", "Amrapali Silicon City", "The Great Value Sharanam", "Stellar MI Citihomes"],
      },
      {
        name: "Sector 74-79",
        status: "AVAILABLE",
        pincodes: ["201304", "201305"],
        societies: ["Supertech Capetown", "Gaur Sportswood", "Prateek Wisteria", "Civitech Stadia"],
      },
      {
        name: "Noida Expressway (128-143)",
        status: "AVAILABLE",
        pincodes: ["201304", "201310"],
        societies: ["Jaypee Wish Town", "ATS Pristine", "Gulshan Vivante", "Paras Tierea"],
      },
      {
        name: "Sector 150",
        status: "LIMITED",
        pincodes: ["201310"],
        societies: ["ATS Pious Hideaways", "Tata Eureka Park", "Godrej Nest"],
      },
      {
        name: "Greater Noida West",
        status: "COMING_SOON",
        pincodes: ["201306", "203201"],
        societies: ["Gaur City 1 & 2", "Ace City", "Supertech Eco Village"],
      },
    ],
  },
  {
    slug: "hyderabad",
    name: "Hyderabad",
    state: "Telangana",
    tier: 1,
    launchedYear: 2025,
    areas: [
      {
        name: "Gachibowli",
        status: "AVAILABLE",
        pincodes: ["500032"],
        societies: ["My Home Bhooja", "Lanco Hills", "Aparna Westside"],
      },
      {
        name: "Hitec City & Madhapur",
        status: "AVAILABLE",
        pincodes: ["500081"],
        societies: ["My Home Abhra", "Cyber Towers Residency", "Meenakshi Trident Towers"],
      },
      {
        name: "Kondapur",
        status: "AVAILABLE",
        pincodes: ["500084"],
        societies: ["Aparna Sarovar", "Rainbow Vistas", "Prestige High Fields Annexe"],
      },
      {
        name: "Jubilee Hills & Banjara Hills",
        status: "AVAILABLE",
        pincodes: ["500033", "500034"],
        societies: ["Jubilee Heights", "Banjara Green Colony", "Park View Enclave"],
      },
      {
        name: "Kukatpally",
        status: "LIMITED",
        pincodes: ["500072", "500085"],
        societies: ["KPHB Colony Phases", "Malaysian Township", "Manjeera Diamond Towers"],
      },
      {
        name: "Kokapet & Narsingi",
        status: "COMING_SOON",
        pincodes: ["500075", "500089"],
        societies: ["My Home Ankura", "Rajapushpa Atria"],
      },
    ],
  },
  {
    slug: "navi-mumbai",
    name: "Navi Mumbai",
    state: "Maharashtra",
    tier: 2,
    launchedYear: 2025,
    areas: [
      {
        name: "Vashi",
        status: "AVAILABLE",
        pincodes: ["400703"],
        societies: ["Vashi Sector 17 CHS", "Mainada Tower", "Satra Park"],
      },
      {
        name: "Nerul & Seawoods",
        status: "AVAILABLE",
        pincodes: ["400706"],
        societies: ["Seawoods Estates", "NRI Complex", "L&T Seawoods Residences"],
      },
      {
        name: "Kharghar",
        status: "AVAILABLE",
        pincodes: ["410210"],
        societies: ["Adhiraj Samyama", "Paradise Sai World City", "Hiranandani Fortune City Annexe"],
      },
      {
        name: "Airoli & Ghansoli",
        status: "LIMITED",
        pincodes: ["400708", "400701"],
        societies: ["Rustomjee Urbania Annexe", "Akshar Elementa"],
      },
      {
        name: "Panvel",
        status: "COMING_SOON",
        pincodes: ["410206"],
        societies: ["Marathon Nexzone", "Indiabulls Greens"],
      },
    ],
  },
  {
    slug: "faridabad",
    name: "Faridabad",
    state: "Haryana",
    tier: 2,
    launchedYear: 2025,
    areas: [
      {
        name: "Sector 14-21 (Old Faridabad)",
        status: "AVAILABLE",
        pincodes: ["121001", "121002"],
        societies: ["Sector 15 HUDA", "Charmwood Village", "Eros Garden"],
      },
      {
        name: "Sector 46 & 48",
        status: "AVAILABLE",
        pincodes: ["121003", "121010"],
        societies: ["Omaxe Heights", "SRS Residency", "Piyush Heights"],
      },
      {
        name: "Greater Faridabad (Neharpar)",
        status: "LIMITED",
        pincodes: ["121002", "121006"],
        societies: ["BPTP Parklands", "Puri Pranayam", "Omaxe New Heights", "RPS Savana"],
      },
      {
        name: "Ballabgarh",
        status: "COMING_SOON",
        pincodes: ["121004"],
        societies: ["Ballabgarh Residency"],
      },
    ],
  },
  {
    slug: "ghaziabad",
    name: "Ghaziabad",
    state: "Uttar Pradesh",
    tier: 2,
    launchedYear: 2025,
    areas: [
      {
        name: "Indirapuram",
        status: "AVAILABLE",
        pincodes: ["201014"],
        societies: ["Shipra Srishti", "ATS Advantage", "Orange County", "Jaipuria Sunrise"],
      },
      {
        name: "Vaishali & Vasundhara",
        status: "AVAILABLE",
        pincodes: ["201010", "201012"],
        societies: ["Ramprastha Greens", "Mahagun Mansion", "Saya Zenith"],
      },
      {
        name: "Raj Nagar Extension",
        status: "LIMITED",
        pincodes: ["201017"],
        societies: ["Ajnara Integrity", "VVIP Addresses", "River Heights"],
      },
      {
        name: "Crossings Republik",
        status: "COMING_SOON",
        pincodes: ["201016"],
        societies: ["Mahagun Mascot", "Paramount Symphony"],
      },
    ],
  },
  {
    slug: "thane",
    name: "Thane",
    state: "Maharashtra",
    tier: 2,
    launchedYear: 2025,
    areas: [
      {
        name: "Ghodbunder Road",
        status: "AVAILABLE",
        pincodes: ["400607", "400615"],
        societies: ["Hiranandani Estate", "Lodha Amara", "Puraniks City", "Vijay Garden"],
      },
      {
        name: "Majiwada & Manpada",
        status: "AVAILABLE",
        pincodes: ["400601", "400610"],
        societies: ["Rustomjee Urbania", "Dosti Vihar", "Lodha Paradise"],
      },
      {
        name: "Kolshet & Balkum",
        status: "LIMITED",
        pincodes: ["400607", "400608"],
        societies: ["Kalpataru Sunrise", "Piramal Vaikunth"],
      },
      {
        name: "Kalwa & Mumbra",
        status: "COMING_SOON",
        pincodes: ["400605", "400612"],
        societies: ["Kalwa Residency"],
      },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/*  Deterministic derivation (seeded hashing — stable across restarts)         */
/* -------------------------------------------------------------------------- */

/** FNV-1a 32-bit hash — deterministic pseudo-randomness from a string seed. */
export function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic value in [min, max] derived from a seed string. */
export function seeded(seed: string, min: number, max: number): number {
  return min + ((hashSeed(seed) % 10_000) / 10_000) * (max - min);
}

function seededInt(seed: string, min: number, max: number): number {
  return Math.round(seeded(seed, min, max));
}

const STATUS_PARTNER_FACTOR: Record<CoverageStatus, number> = {
  AVAILABLE: 1,
  LIMITED: 0.45,
  COMING_SOON: 0,
};

export function deriveAreaCoverage(city: CitySeed, area: AreaSeed): AreaCoverage {
  const key = `${city.slug}:${area.name}`;
  const base = city.tier === 1 ? seededInt(`${key}:p`, 24, 85) : seededInt(`${key}:p`, 10, 42);
  const activePartners = Math.round(base * STATUS_PARTNER_FACTOR[area.status]);
  return {
    id: key,
    name: area.name,
    status: area.status,
    pincodes: area.pincodes,
    societyCount: area.societies.length,
    activePartners,
    density: activePartners >= 45 ? "HIGH" : activePartners >= 18 ? "MEDIUM" : "LOW",
    avgArrivalMins:
      area.status === "COMING_SOON" ? 0 : seededInt(`${key}:eta`, 22, area.status === "LIMITED" ? 55 : 42),
  };
}

export function derivePincodes(city: CitySeed): PincodeCoverage[] {
  const seen = new Map<string, PincodeCoverage>();
  for (const area of city.areas) {
    const areaCov = deriveAreaCoverage(city, area);
    for (const pin of area.pincodes) {
      const existing = seen.get(pin);
      // A pincode shared by areas takes the best status among them.
      if (!existing || rankStatus(area.status) < rankStatus(existing.status)) {
        seen.set(pin, {
          pincode: pin,
          areaName: area.name,
          status: area.status,
          partnerCount: Math.max(existing?.partnerCount ?? 0, Math.round(areaCov.activePartners * seeded(`${city.slug}:${pin}`, 0.4, 0.9))),
        });
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.pincode.localeCompare(b.pincode));
}

function rankStatus(s: CoverageStatus): number {
  return s === "AVAILABLE" ? 0 : s === "LIMITED" ? 1 : 2;
}

export function deriveSocieties(city: CitySeed, serviceNames?: string[]): SocietyCoverage[] {
  const services = serviceNames && serviceNames.length > 0 ? serviceNames : CORE_COVERAGE_SERVICES.map((s) => s.name);
  const out: SocietyCoverage[] = [];
  for (const area of city.areas) {
    for (const society of area.societies) {
      const key = `${city.slug}:${area.name}:${society}`;
      const partnerCount =
        area.status === "COMING_SOON" ? 0 : seededInt(`${key}:p`, area.status === "LIMITED" ? 3 : 8, area.status === "LIMITED" ? 14 : 40);
      // Deterministic per-society service subset (COMING_SOON societies expose none).
      const availableServices =
        area.status === "COMING_SOON"
          ? []
          : services.filter((_, i) => hashSeed(`${key}:svc:${i}`) % 10 < (area.status === "LIMITED" ? 6 : 9));
      out.push({
        id: key,
        name: society,
        areaName: area.name,
        status: area.status,
        partnerCount,
        avgResponseMins: area.status === "COMING_SOON" ? 0 : seededInt(`${key}:rt`, 20, area.status === "LIMITED" ? 60 : 45),
        rating: area.status === "COMING_SOON" ? 0 : Math.round(seeded(`${key}:r`, 4.3, 4.95) * 10) / 10,
        availableServices,
      });
    }
  }
  return out;
}

/** Day-key so TODAY/TOMORROW availability rotates daily but stays stable within a day. */
function dayKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

export function deriveServiceAvailability(
  city: CitySeed,
  services?: Array<{ name: string; slug: string }>,
): ServiceAvailability[] {
  const list = services && services.length > 0 ? services : CORE_COVERAGE_SERVICES;
  const day = dayKey();
  return list.map((svc) => {
    const roll = hashSeed(`${city.slug}:${svc.slug}:${day}`) % 10;
    return {
      name: svc.name,
      slug: svc.slug,
      availability: roll < 7 ? "TODAY" : roll < 9 ? "TOMORROW" : "UNAVAILABLE",
    };
  });
}

export function deriveResponseEngine(city: CitySeed): ResponseEngine {
  const key = `${city.slug}:engine`;
  return {
    avgArrivalMins: seededInt(`${key}:eta`, 24, city.tier === 1 ? 34 : 44),
    acceptanceRate: Math.round(seeded(`${key}:acc`, 91, 98) * 10) / 10,
    completionRate: Math.round(seeded(`${key}:comp`, 96.5, 99.4) * 10) / 10,
    cancellationRate: Math.round(seeded(`${key}:can`, 0.6, 2.8) * 10) / 10,
  };
}

export function deriveCoverageScore(city: CitySeed): number {
  const areas = city.areas;
  const available = areas.filter((a) => a.status === "AVAILABLE").length;
  const limited = areas.filter((a) => a.status === "LIMITED").length;
  const areaScore = ((available + limited * 0.5) / Math.max(1, areas.length)) * 60;
  const partners = areas.reduce((sum, a) => sum + deriveAreaCoverage(city, a).activePartners, 0);
  const densityScore = Math.min(1, partners / (city.tier === 1 ? 300 : 120)) * 40;
  return Math.round(areaScore + densityScore);
}

export type CityLiveOverrides = {
  activePartners?: number;
  customers?: number;
  servicesCompleted?: number;
  /** Admin-managed operational status; supersedes the derived (seed) status. */
  statusOverride?: CoverageStatus;
};

export function deriveCitySummary(city: CitySeed, live?: CityLiveOverrides): CityCoverageSummary {
  const areaCovs = city.areas.map((a) => deriveAreaCoverage(city, a));
  const baselinePartners = areaCovs.reduce((sum, a) => sum + a.activePartners, 0);
  const pincodeCount = new Set(city.areas.flatMap((a) => a.pincodes)).size;
  const societyCount = city.areas.reduce((sum, a) => sum + a.societies.length, 0);
  const ageYears = Math.max(1, new Date().getFullYear() - city.launchedYear + 1);
  const baselineCustomers = seededInt(`${city.slug}:cust`, 4000, city.tier === 1 ? 16000 : 8000) * ageYears;
  const baselineCompleted = Math.round(baselineCustomers * seeded(`${city.slug}:freq`, 1.6, 3.2));
  const anyAvailable = city.areas.some((a) => a.status === "AVAILABLE");
  const anyLimited = city.areas.some((a) => a.status !== "COMING_SOON");
  return {
    slug: city.slug,
    name: city.name,
    state: city.state,
    tier: city.tier,
    status: live?.statusOverride ?? (anyAvailable ? "AVAILABLE" : anyLimited ? "LIMITED" : "COMING_SOON"),
    areaCount: city.areas.length,
    pincodeCount,
    societyCount,
    activePartners: live?.activePartners && live.activePartners > 0 ? live.activePartners : baselinePartners,
    customers: live?.customers && live.customers > 0 ? live.customers : baselineCustomers,
    servicesCompleted:
      live?.servicesCompleted && live.servicesCompleted > 0 ? live.servicesCompleted : baselineCompleted,
    fulfillmentRate: Math.round(seeded(`${city.slug}:ful`, 98.2, 99.6) * 10) / 10,
    coverageScore: deriveCoverageScore(city),
  };
}

export function deriveCityDetail(
  city: CitySeed,
  opts?: { live?: CityLiveOverrides; services?: Array<{ name: string; slug: string }> },
): CityCoverageDetail {
  const societies = deriveSocieties(city, opts?.services?.map((s) => s.name));
  return {
    summary: deriveCitySummary(city, opts?.live),
    areas: city.areas.map((a) => deriveAreaCoverage(city, a)),
    pincodes: derivePincodes(city),
    societies,
    services: deriveServiceAvailability(city, opts?.services),
    responseEngine: deriveResponseEngine(city),
    generatedAt: new Date().toISOString(),
  };
}

export function getCitySeed(slug: string): CitySeed | undefined {
  return CITY_SEEDS.find((c) => c.slug === slug || c.name.toLowerCase() === slug.toLowerCase());
}

/* -------------------------------------------------------------------------- */
/*  Coverage search — society / area / pincode / city                          */
/* -------------------------------------------------------------------------- */

export function searchCoverage(rawQuery: string, limit = 12): CoverageSearchResult[] {
  const q = rawQuery.trim().toLowerCase();
  if (q.length < 2) return [];
  const results: CoverageSearchResult[] = [];
  const isPincodeQuery = /^\d{2,6}$/.test(q);

  const push = (r: CoverageSearchResult) => {
    if (results.length < limit * 3) results.push(r);
  };

  for (const city of CITY_SEEDS) {
    if (!isPincodeQuery && city.name.toLowerCase().includes(q)) {
      const summary = deriveCitySummary(city);
      push({
        type: "CITY",
        covered: summary.status !== "COMING_SOON",
        status: summary.status,
        citySlug: city.slug,
        cityName: city.name,
        label: city.name,
        sublabel: `${summary.areaCount} areas · ${summary.societyCount} societies`,
        partnersNearby: summary.activePartners,
        expectedArrivalMins: deriveResponseEngine(city).avgArrivalMins,
        availableToday: summary.status === "AVAILABLE",
      });
    }
    for (const area of city.areas) {
      const areaCov = deriveAreaCoverage(city, area);
      if (isPincodeQuery) {
        for (const pin of area.pincodes) {
          if (pin.startsWith(q)) {
            push({
              type: "PINCODE",
              covered: area.status !== "COMING_SOON",
              status: area.status,
              citySlug: city.slug,
              cityName: city.name,
              label: pin,
              sublabel: `${area.name}, ${city.name}`,
              partnersNearby: areaCov.activePartners,
              expectedArrivalMins: areaCov.avgArrivalMins,
              availableToday: area.status === "AVAILABLE",
            });
          }
        }
        continue;
      }
      if (area.name.toLowerCase().includes(q)) {
        push({
          type: "AREA",
          covered: area.status !== "COMING_SOON",
          status: area.status,
          citySlug: city.slug,
          cityName: city.name,
          label: area.name,
          sublabel: `${city.name} · ${area.pincodes.join(", ")}`,
          partnersNearby: areaCov.activePartners,
          expectedArrivalMins: areaCov.avgArrivalMins,
          availableToday: area.status === "AVAILABLE",
        });
      }
      for (const society of area.societies) {
        if (society.toLowerCase().includes(q)) {
          const key = `${city.slug}:${area.name}:${society}`;
          const partners =
            area.status === "COMING_SOON" ? 0 : seededInt(`${key}:p`, area.status === "LIMITED" ? 3 : 8, area.status === "LIMITED" ? 14 : 40);
          push({
            type: "SOCIETY",
            covered: area.status !== "COMING_SOON",
            status: area.status,
            citySlug: city.slug,
            cityName: city.name,
            label: society,
            sublabel: `${area.name}, ${city.name}`,
            partnersNearby: partners,
            expectedArrivalMins: area.status === "COMING_SOON" ? 0 : seededInt(`${key}:rt`, 20, 45),
            availableToday: area.status === "AVAILABLE",
          });
        }
      }
    }
  }

  // Exact/prefix matches first, then societies before broader matches.
  const typeRank = { SOCIETY: 0, PINCODE: 0, AREA: 1, CITY: 2 } as const;
  return results
    .sort((a, b) => {
      const aExact = a.label.toLowerCase().startsWith(q) ? 0 : 1;
      const bExact = b.label.toLowerCase().startsWith(q) ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      return typeRank[a.type] - typeRank[b.type];
    })
    .slice(0, limit);
}
