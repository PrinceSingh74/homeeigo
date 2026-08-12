import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  Calendar,
  CalendarClock,
  CheckCircle,
  Clock,
  DollarSign,
  Eye,
  FileText,
  Home,
  Lock,
  Receipt,
  Route,
  Shield,
  Sparkles,
  Star,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

const U = (id: string, w = 1200) =>
  `https://images.unsplash.com/${id}?w=${w}&q=90&auto=format&fit=crop`;

export type MarketplaceService = {
  id: string;
  /** Backend catalog slug — stable identifier used to match live services. */
  slug?: string;
  name: string;
  image: string;
  duration: string;
  rating: number;
  price: string;
  priceValue?: number;
  badge?: string;
  /** Passed to /book?service=… — catalog cuid when live, slug-style id as fallback. */
  serviceId: string;
  freshness?: string;
};

export type FutureService = {
  id: string;
  name: string;
  description: string;
  features: string[];
  icon: string;
  image: string;
};

export type TrustPoint = {
  icon: LucideIcon;
  title: string;
  description: string;
  color: "emerald" | "blue" | "yellow" | "amber" | "green";
};

export type CityItem = {
  name: string;
  image: string;
};

export type HowItWorksStep = {
  number: string;
  icon: LucideIcon;
  title: string;
  description: string;
};

// Brand welcome portrait — HOMEEIGO professional greeting the customer (local asset).
export const HERO_IMAGE = "/homigo-welcome.png";

export const HERO_TRUST_PILLS: { label: string; icon: LucideIcon }[] = [
  { label: "Background Verified", icon: Shield },
  { label: "On-time Guarantee", icon: Clock },
  { label: "Satisfaction Guaranteed", icon: Star },
  { label: "Secure Payments", icon: Lock },
];

export const HOME_CARE_SERVICES: MarketplaceService[] = [
  {
    id: "bathroom",
    slug: "bathroom-cleaning",
    name: "Bathroom Cleaning",
    image: U("photo-1620626011761-996317b8d101"),
    duration: "40 mins",
    rating: 4.9,
    price: "₹199 onwards",
    priceValue: 199,
    badge: "Most Booked",
    serviceId: "bathroom-cleaning",
  },
  {
    id: "kitchen",
    slug: "kitchen-cleaning",
    name: "Kitchen Cleaning",
    image: U("photo-1556911220-bff31c812dba"),
    duration: "45 mins",
    rating: 4.9,
    price: "₹249 onwards",
    priceValue: 249,
    badge: "Popular",
    serviceId: "kitchen-cleaning",
  },
  {
    id: "dusting",
    slug: "dusting-wiping",
    name: "Dusting & Wiping",
    image: U("photo-1581578731548-c64695cc6952"),
    duration: "30 mins",
    rating: 4.8,
    price: "₹149 onwards",
    priceValue: 149,
    serviceId: "dusting-wiping",
  },
  {
    id: "sweeping",
    slug: "sweeping-mopping",
    name: "Sweeping & Mopping",
    image: U("photo-1563453392213-326a5a1ea2c5"),
    duration: "40 mins",
    rating: 4.8,
    price: "₹179 onwards",
    priceValue: 179,
    serviceId: "sweeping-mopping",
  },
];

export const PREMIUM_CARE_SERVICES: MarketplaceService[] = [
  {
    id: "sofa",
    slug: "sofa-deep-cleaning",
    name: "Sofa Deep Cleaning",
    image: U("photo-1555041469-a586c61ea9bc"),
    duration: "40 mins",
    rating: 4.9,
    price: "₹499 onwards",
    priceValue: 499,
    serviceId: "sofa-deep-cleaning",
  },
  {
    id: "mattress",
    slug: "mattress-sanitization",
    name: "Mattress Sanitization",
    image: U("photo-1631049307264-da0ec9d70304"),
    duration: "60 mins",
    rating: 4.9,
    price: "₹899 onwards",
    priceValue: 899,
    serviceId: "mattress-sanitization",
  },
  {
    id: "carpet",
    slug: "carpet-shampooing",
    name: "Carpet Shampooing",
    image: U("photo-1600585154340-be6161a56a0c"),
    duration: "60 mins",
    rating: 4.3,
    price: "₹649 onwards",
    priceValue: 649,
    serviceId: "carpet-shampooing",
  },
];

export const LAUNDRY_SERVICES: MarketplaceService[] = [
  {
    id: "laundry",
    slug: "laundry",
    name: "Laundry",
    image: U("photo-1582735689369-4fe89db7114c"),
    duration: "40 hrs",
    rating: 4.6,
    price: "₹199 onwards",
    priceValue: 199,
    freshness: "Premium Fresh",
    serviceId: "laundry",
  },
  {
    id: "ironing",
    slug: "ironing-folding",
    name: "Ironing & Folding",
    image: U("photo-1582735689369-4fe89db7114c"),
    duration: "24 hrs",
    rating: 4.5,
    price: "₹149 onwards",
    priceValue: 149,
    freshness: "Crisp Finish",
    serviceId: "ironing-folding",
  },
  {
    id: "wardrobe",
    slug: "wardrobe-cleaning",
    name: "Complete Wardrobe Cleaning",
    image: U("photo-1555041469-a586c61ea9bc"),
    duration: "72 hrs",
    rating: 4.3,
    price: "₹999 onwards",
    priceValue: 999,
    freshness: "Full Care",
    badge: "Popular",
    serviceId: "wardrobe-cleaning",
  },
];

export const OUTDOOR_SERVICES: MarketplaceService[] = [
  {
    id: "balcony",
    slug: "balcony-cleaning",
    name: "Balcony Cleaning",
    image: U("photo-1600585154340-be6161a56a0c"),
    duration: "30 mins",
    rating: 4.7,
    price: "₹199 onwards",
    priceValue: 199,
    serviceId: "balcony-cleaning",
  },
  {
    id: "plants",
    slug: "plant-care",
    name: "Plant Care",
    image: U("photo-1466692479666-897e069cb282"),
    duration: "30 mins",
    rating: 4.6,
    price: "₹199 onwards",
    priceValue: 199,
    serviceId: "plant-care",
  },
  {
    id: "car",
    slug: "car-surface-cleaning",
    name: "Car Surface Cleaning",
    image: U("photo-1503376780353-7e6692767b70"),
    duration: "60 mins",
    rating: 4.8,
    price: "₹299 onwards",
    priceValue: 299,
    serviceId: "car-surface-cleaning",
  },
];

export const EXPRESS_SERVICES: MarketplaceService[] = [
  {
    id: "pre-party",
    slug: "pre-party-express-clean",
    name: "Pre-Party Express Clean",
    image: U("photo-1519671482749-fd8f5b4c0b8e"),
    duration: "0-60 mins",
    rating: 4.9,
    price: "₹549 onwards",
    priceValue: 549,
    badge: "Specialist",
    serviceId: "pre-party-express-clean",
  },
  {
    id: "post-party",
    slug: "after-party-express-clean",
    name: "After-Party Express Clean",
    image: U("photo-1530103862676-de8c9debad1d"),
    duration: "0-60 mins",
    rating: 4.9,
    price: "₹549 onwards",
    priceValue: 549,
    badge: "Specialist",
    serviceId: "after-party-express-clean",
  },
];

export const FUTURE_SERVICES: FutureService[] = [
  {
    id: "senior",
    name: "Senior Care",
    description: "Compassionate care for elders",
    features: [
      "Medicine Pickup",
      "Hospital Companion",
      "Home Visit Support",
      "Daily Assistance",
    ],
    icon: "👴",
    image: U("photo-1573496359142-b8d87734a5a2", 800),
  },
  {
    id: "pet",
    name: "Pet Care",
    description: "Love & care for your pets",
    features: [
      "Pet Walking",
      "Pet Feeding",
      "Pet Cleaning",
      "Grooming Assistance",
    ],
    icon: "🐕",
    image: U("photo-1587300003388-59208cc962cb", 800),
  },
  {
    id: "executive",
    name: "Executive Services",
    description: "Personal assistance on demand",
    features: [
      "Driver On Demand",
      "Office Assistant",
      "Errand Runner",
      "Concierge Service",
    ],
    icon: "💼",
    image: U("photo-1560250097-0b93528c311a", 800),
  },
];

export const TRUST_POINTS: TrustPoint[] = [
  {
    icon: Shield,
    title: "Background Verified",
    description: "All partners undergo thorough background checks",
    color: "emerald",
  },
  {
    icon: Clock,
    title: "On-Time Guarantee",
    description: "Arrive on time, every time. Guaranteed.",
    color: "blue",
  },
  {
    icon: Star,
    title: "Satisfaction Guaranteed",
    description: "100% satisfaction or your money back",
    color: "yellow",
  },
  {
    icon: Lock,
    title: "Secure Payments",
    description: "Safe, encrypted transactions always",
    color: "emerald",
  },
  {
    icon: Zap,
    title: "AI Scheduling",
    description: "Smart matching for best service quality",
    color: "amber",
  },
  {
    icon: Eye,
    title: "Live Tracking",
    description: "Know where your service partner is",
    color: "blue",
  },
  {
    icon: CheckCircle,
    title: "Verified Partners",
    description: "10,000+ verified experts across India",
    color: "emerald",
  },
  {
    icon: DollarSign,
    title: "Transparent Pricing",
    description: "No hidden charges, no surprises",
    color: "green",
  },
];

export const CITIES: CityItem[] = [
  { name: "Bangalore", image: U("photo-1596176530529-78163a4f5af6", 600) },
  { name: "Delhi", image: U("photo-1587474260584-136574528ed5", 600) },
  { name: "Mumbai", image: U("photo-1566552881560-0be862a7c445", 600) },
  { name: "Pune", image: U("photo-1596178065887-1198b8048ed8", 600) },
  { name: "Gurgaon", image: U("photo-1524492412937-2808ad67581e", 600) },
  { name: "Noida", image: U("photo-1587474260584-136574528ed5", 600) },
  { name: "Hyderabad", image: U("photo-1596176530529-78163a4f5af6", 600) },
  { name: "Navi Mumbai", image: U("photo-1566552881560-0be862a7c445", 600) },
  { name: "Faridabad", image: U("photo-1524492412937-2808ad67581e", 600) },
  { name: "Ghaziabad", image: U("photo-1587474260584-136574528ed5", 600) },
  { name: "Thane", image: U("photo-1566552881560-0be862a7c445", 600) },
];

/** Section 11 — transparent pricing cards (curated from marketplace catalog). */
export const TRANSPARENT_PRICING_SERVICES: MarketplaceService[] = [
  HOME_CARE_SERVICES[0]!,
  HOME_CARE_SERVICES[1]!,
  LAUNDRY_SERVICES[0]!,
  { ...PREMIUM_CARE_SERVICES[0]!, name: "Sofa Cleaning" },
  { ...LAUNDRY_SERVICES[2]!, name: "Wardrobe Cleaning" },
  OUTDOOR_SERVICES[0]!,
];

export const PRICING_TRUST_STRIP: { label: string; icon: LucideIcon }[] = [
  { label: "GST Included", icon: Receipt },
  { label: "No Hidden Charges", icon: Shield },
  { label: "Upfront Pricing", icon: DollarSign },
  { label: "Secure Payments", icon: Lock },
  { label: "Instant Invoice", icon: FileText },
  { label: "Verified Professionals", icon: BadgeCheck },
];

export type AiSchedulingFeature = {
  title: string;
  description: string;
  icon: LucideIcon;
};

/** Section 14 — AI scheduling engine feature cards. */
export const AI_SCHEDULING_FEATURES: AiSchedulingFeature[] = [
  {
    title: "Demand Forecasting",
    description: "Predicts service demand by city and locality.",
    icon: TrendingUp,
  },
  {
    title: "Smart Time Slot Recommendation",
    description: "Suggests optimal booking windows.",
    icon: CalendarClock,
  },
  {
    title: "Auto Assignment",
    description: "Matches the best available professional.",
    icon: Users,
  },
  {
    title: "Travel Time Optimization",
    description: "Reduces delays and improves efficiency.",
    icon: Route,
  },
  {
    title: "Real-Time Matching",
    description: "Instantly connects demand with supply.",
    icon: Sparkles,
  },
];

export const REVIEW_TRUST_STATS: { value: string; label: string }[] = [
  { value: "50,000+", label: "Happy Homes" },
  { value: "4.9★", label: "Average Rating" },
  { value: "98%", label: "Customer Satisfaction" },
];

export const FINAL_CTA_TRUST_BAR: { label: string; icon: LucideIcon }[] = [
  { label: "4.9★ Rating", icon: Star },
  { label: "50,000+ Homes Served", icon: Home },
  { label: "10,000+ Verified Partners", icon: BadgeCheck },
  { label: "Secure Payments", icon: Lock },
  { label: "On-Time Service Guarantee", icon: Clock },
];

export const HOW_IT_WORKS_STEPS: HowItWorksStep[] = [
  {
    number: "1",
    icon: Home,
    title: "Choose a Service",
    description: "Select from 100+ home services",
  },
  {
    number: "2",
    icon: Calendar,
    title: "Pick Date & Time",
    description: "Choose your preferred time slot",
  },
  {
    number: "3",
    icon: Users,
    title: "Verified Partner Assigned",
    description: "We assign the best-matched expert",
  },
  {
    number: "4",
    icon: CheckCircle,
    title: "Service Delivered",
    description: "Relax, we handle the rest!",
  },
  {
    number: "5",
    icon: Star,
    title: "Rate & Relax",
    description: "Your feedback helps us improve",
  },
];
