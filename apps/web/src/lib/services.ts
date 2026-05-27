import { Scissors, type LucideIcon } from "lucide-react";

export type ServicePackage = {
  name: string;
  tag: string;
  price: number;
  popular?: boolean;
  items: string[];
};

export type Service = {
  id: string;
  name: string;
  img?: string;
  icon?: LucideIcon;
  price: string;
  priceFrom: number;
  color: string;
  title: string;
  tagline: string;
  rating: string;
  reviews: string;
  homes: string;
  packages: ServicePackage[];
  keywords: string[];
  featured?: boolean;
};

export const LOCATIONS = [
  { id: "gurugram-49", label: "Gurugram, Sector 49", city: "Gurugram", pin: "122018" },
  { id: "gurugram-56", label: "Gurugram, Sector 56", city: "Gurugram", pin: "122011" },
  { id: "delhi-saket", label: "Delhi, Saket", city: "New Delhi", pin: "110017" },
  { id: "noida-62", label: "Noida, Sector 62", city: "Noida", pin: "201309" },
] as const;

export type LocationId = (typeof LOCATIONS)[number]["id"];

export const SERVICES: Service[] = [
  {
    id: "cleaning",
    name: "Cleaning",
    img: "/svc-cleaning.png",
    price: "₹199",
    priceFrom: 199,
    color: "#7C3AED",
    title: "Home Cleaning",
    tagline: "Professional home cleaning — neat, clean & hygienic.",
    rating: "4.8",
    reviews: "12.5k",
    homes: "12K+ homes cleaned",
    featured: true,
    keywords: ["clean", "cleaning", "deep clean", "home", "sofa", "kitchen", "bathroom"],
    packages: [
      { name: "Basic", tag: "Essential Cleaning", price: 199, items: ["1 Bedroom", "1 Bathroom", "Kitchen Cleaning", "Floor Cleaning"] },
      { name: "Standard", tag: "Deep Cleaning", price: 299, popular: true, items: ["2 Bedroom", "2 Bathroom", "Kitchen Cleaning", "Dusting & Wiping", "Floor Cleaning"] },
      { name: "Premium", tag: "Full Home Cleaning", price: 499, items: ["3 Bedroom", "3 Bathroom", "Kitchen Cleaning", "Deep Cleaning", "Balcony Cleaning", "Windows Cleaning"] },
    ],
  },
  {
    id: "ac-service",
    name: "AC Service",
    img: "/svc-ac.png",
    price: "₹299",
    priceFrom: 299,
    color: "#06B6D4",
    title: "AC Service & Repair",
    tagline: "Cooling care by certified AC technicians.",
    rating: "4.9",
    reviews: "9.2k",
    homes: "8K+ ACs serviced",
    keywords: ["ac", "air conditioner", "cooling", "gas", "refill"],
    packages: [
      { name: "Basic", tag: "AC Cleaning", price: 299, items: ["1 AC Unit", "Filter Cleaning", "Cooling Check", "Basic Servicing"] },
      { name: "Standard", tag: "Deep Service", price: 499, popular: true, items: ["2 AC Units", "Deep Coil Cleaning", "Gas Pressure Check", "Filter + Drain Clean"] },
      { name: "Premium", tag: "Full AC Care", price: 899, items: ["3 AC Units", "Full Chemical Wash", "Gas Top-up", "1 Year Warranty", "Priority Support"] },
    ],
  },
  {
    id: "plumbing",
    name: "Plumbing",
    img: "/svc-plumbing.png",
    price: "₹249",
    priceFrom: 249,
    color: "#3B82F6",
    title: "Plumbing Services",
    tagline: "Leak-free homes by expert plumbers.",
    rating: "4.7",
    reviews: "7.8k",
    homes: "10K+ jobs done",
    keywords: ["plumber", "plumbing", "leak", "tap", "pipe"],
    packages: [
      { name: "Basic", tag: "Quick Fix", price: 249, items: ["1 Tap / Faucet", "Leak Inspection", "Minor Repair", "30-day Warranty"] },
      { name: "Standard", tag: "Full Repair", price: 449, popular: true, items: ["Up to 3 Fixtures", "Pipe Leak Repair", "Drain Cleaning", "60-day Warranty"] },
      { name: "Premium", tag: "Home Plumbing", price: 799, items: ["Whole-home Check", "Pipe Replacement", "Tank Cleaning", "90-day Warranty", "Priority Support"] },
    ],
  },
  {
    id: "electrician",
    name: "Electrician",
    img: "/svc-electrician.png",
    price: "₹199",
    priceFrom: 199,
    color: "#F59E0B",
    title: "Electrician Services",
    tagline: "Safe wiring & repairs by certified electricians.",
    rating: "4.8",
    reviews: "6.4k",
    homes: "9K+ homes wired",
    keywords: ["electric", "electrician", "wiring", "fan", "switch"],
    packages: [
      { name: "Basic", tag: "Quick Fix", price: 199, items: ["1 Switch / Socket", "Fault Inspection", "Minor Repair", "30-day Warranty"] },
      { name: "Standard", tag: "Full Repair", price: 399, popular: true, items: ["Up to 4 Points", "Wiring Check", "Fan / Light Install", "60-day Warranty"] },
      { name: "Premium", tag: "Home Electrical", price: 749, items: ["Full Home Audit", "MCB / Panel Work", "New Wiring", "90-day Warranty", "Priority Support"] },
    ],
  },
  {
    id: "pest-control",
    name: "Pest Control",
    img: "/svc-pest.png",
    price: "₹299",
    priceFrom: 299,
    color: "#10B981",
    title: "Pest Control",
    tagline: "Pest-free homes with eco-safe treatment.",
    rating: "4.9",
    reviews: "5.6k",
    homes: "7K+ homes treated",
    keywords: ["pest", "cockroach", "termite", "rodent"],
    packages: [
      { name: "Basic", tag: "Single Treatment", price: 299, items: ["1 BHK", "Cockroach + Ant", "Eco-safe Spray", "15-day Warranty"] },
      { name: "Standard", tag: "Full Home", price: 549, popular: true, items: ["2 BHK", "All Common Pests", "Gel + Spray", "45-day Warranty"] },
      { name: "Premium", tag: "Annual Shield", price: 1299, items: ["3 BHK", "Termite + Rodent", "4 Visits / Year", "1 Year Warranty", "Priority Support"] },
    ],
  },
  {
    id: "salon",
    name: "Salon",
    icon: Scissors,
    price: "₹199",
    priceFrom: 199,
    color: "#EC4899",
    title: "Salon at Home",
    tagline: "Premium salon services at your doorstep.",
    rating: "4.9",
    reviews: "11.3k",
    homes: "15K+ appointments",
    keywords: ["salon", "haircut", "facial", "spa", "beauty"],
    packages: [
      { name: "Basic", tag: "Essentials", price: 199, items: ["Haircut", "Threading", "Basic Cleanup", "Hygienic Tools"] },
      { name: "Standard", tag: "Glow Package", price: 499, popular: true, items: ["Haircut + Style", "Facial", "Manicure", "Premium Products"] },
      { name: "Premium", tag: "Luxury Spa", price: 999, items: ["Hair Spa", "Gold Facial", "Mani + Pedi", "Body Massage", "Priority Stylist"] },
    ],
  },
];

export const PROMO_OFFERS = [
  { code: "COOL100", serviceId: "ac-service", discount: "Flat ₹100 OFF", desc: "On AC Service" },
  { code: "FRESH25", serviceId: "cleaning", discount: "25% OFF", desc: "On Deep Cleaning" },
  { code: "FIX150", serviceId: "plumbing", discount: "Flat ₹150 OFF", desc: "On Plumbing" },
] as const;

/** Quick time slots on book screen (matches mobile app). */
export const BOOKING_TIMES = [
  "09:00 AM",
  "11:00 AM",
  "01:00 PM",
  "03:00 PM",
  "05:00 PM",
  "07:00 PM",
] as const;

export const RECOMMENDED = [
  { title: "Sofa Deep Clean", price: "₹699", rating: "4.9", serviceId: "cleaning", packageIndex: 2, img: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=600&q=75" },
  { title: "AC Gas Refill", price: "₹1,299", rating: "4.8", serviceId: "ac-service", packageIndex: 2, img: "https://images.unsplash.com/photo-1635048424329-a9bfb146d7aa?w=600&q=75" },
  { title: "Kitchen Cleaning", price: "₹499", rating: "4.7", serviceId: "cleaning", packageIndex: 1, img: "https://images.unsplash.com/photo-1556911220-bff31c812dba?w=600&q=75" },
  { title: "Bathroom Cleaning", price: "₹599", rating: "4.8", serviceId: "cleaning", packageIndex: 0, img: "https://images.unsplash.com/photo-1620626011761-996317b8d101?w=600&q=75" },
] as const;

export function getServiceById(id: string): Service | undefined {
  return SERVICES.find((s) => s.id === id);
}

export function getServiceIndex(id: string): number {
  const i = SERVICES.findIndex((s) => s.id === id);
  return i === -1 ? 0 : i;
}

export function popularPackageIndex(service: Service): number {
  const p = service.packages.findIndex((x) => x.popular);
  return p === -1 ? 0 : p;
}

export function searchServices(query: string): Service[] {
  const q = query.trim().toLowerCase();
  if (!q) return SERVICES;
  const tokens = q.split(/\s+/).filter(Boolean);
  return SERVICES.filter((s) => {
    const name = s.name.toLowerCase();
    const title = s.title.toLowerCase();
    if (name.includes(q) || title.includes(q)) return true;
    if (s.keywords.some((k) => k.includes(q))) return true;
    if (tokens.length <= 1) return false;
    return tokens.every(
      (t) =>
        name.includes(t) ||
        title.includes(t) ||
        s.keywords.some((k) => k.includes(t)),
    );
  });
}

export function getLocation(id: LocationId) {
  return LOCATIONS.find((l) => l.id === id) ?? LOCATIONS[0];
}
