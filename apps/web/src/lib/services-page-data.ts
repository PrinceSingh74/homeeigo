import type { LucideIcon } from "lucide-react";
import {
  AirVent,
  Bot,
  Bug,
  Clock,
  Droplets,
  Hammer,
  Headphones,
  Paintbrush,
  Scissors,
  ShieldCheck,
  SprayCan,
  UserCheck,
  Wrench,
  Zap,
} from "lucide-react";

const U = (id: string, w = 2400) =>
  `https://images.unsplash.com/${id}?w=${w}&q=95&auto=format&fit=crop`;

export type ServiceCategory = {
  id: string;
  name: string;
  count: number;
  serviceId: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  image: string;
};

export type AiRecommendation = {
  id: string;
  title: string;
  description: string;
  badge: "AI Recommended" | "Popular" | "Urgent";
  serviceId: string;
  gradient: string;
  icon: LucideIcon;
};

export type TrendingServiceItem = {
  id: string;
  title: string;
  provider: string;
  providerAvatar: string;
  rating: number;
  reviews: number;
  price: number;
  duration: string;
  type: string;
  image: string;
  serviceId: string;
};

export type TrustItem = {
  title: string;
  description: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
};

export type CustomerReview = {
  id: string;
  name: string;
  location: string;
  rating: number;
  review: string;
  avatar: string;
};

export const POPULAR_SEARCHES = [
  "AC Service",
  "Deep Cleaning",
  "Plumbing",
  "Electrician",
  "Pest Control",
] as const;

export const HERO_TRUST_BADGES = [
  "Verified Experts",
  "Background Checked",
  "Secure Payments",
  "On-time Service",
] as const;

export const FLOATING_SERVICES = [
  { label: "Painting", icon: Paintbrush, color: "#7C3AED", delay: 0, serviceId: "cleaning" as const },
  { label: "Electrician", icon: Zap, color: "#F59E0B", delay: 0.4, serviceId: "electrician" as const },
  { label: "AC Service", icon: AirVent, color: "#2563EB", delay: 0.8, serviceId: "ac-service" as const },
  { label: "Plumbing", icon: Droplets, color: "#06B6D4", delay: 1.2, serviceId: "plumbing" as const },
] as const;

export const SERVICE_CATEGORIES: ServiceCategory[] = [
  {
    id: "cleaning",
    name: "Cleaning",
    count: 18,
    serviceId: "cleaning",
    icon: SprayCan,
    iconColor: "#7C3AED",
    iconBg: "#EDE9FE",
    image: U("photo-1581578731548-c64695cc6952"),
  },
  {
    id: "ac",
    name: "AC Service",
    count: 9,
    serviceId: "ac-service",
    icon: AirVent,
    iconColor: "#0891B2",
    iconBg: "#CFFAFE",
    image: U("photo-1585771721814-51ae77187df2"),
  },
  {
    id: "plumbing",
    name: "Plumbing",
    count: 16,
    serviceId: "plumbing",
    icon: Droplets,
    iconColor: "#2563EB",
    iconBg: "#DBEAFE",
    image: U("photo-1607472586893-edb57bdc0e39"),
  },
  {
    id: "electrician",
    name: "Electrician",
    count: 14,
    serviceId: "electrician",
    icon: Zap,
    iconColor: "#EA580C",
    iconBg: "#FFEDD5",
    image: U("photo-1621905252472-943afaa0e938"),
  },
  {
    id: "pest",
    name: "Pest Control",
    count: 8,
    serviceId: "pest-control",
    icon: Bug,
    iconColor: "#16A34A",
    iconBg: "#DCFCE7",
    image: U("photo-1584515934247-1a1b9f966279"),
  },
  {
    id: "salon",
    name: "Salon & Spa",
    count: 20,
    serviceId: "salon",
    icon: Scissors,
    iconColor: "#9333EA",
    iconBg: "#F3E8FF",
    image: U("photo-1560066984-138d3efda2b7"),
  },
  {
    id: "painting",
    name: "Painting",
    count: 20,
    serviceId: "cleaning",
    icon: Paintbrush,
    iconColor: "#EA580C",
    iconBg: "#FFF7ED",
    image: U("photo-1589939705384-518513271a4c"),
  },
  {
    id: "carpentry",
    name: "Carpentry",
    count: 12,
    serviceId: "electrician",
    icon: Hammer,
    iconColor: "#92400E",
    iconBg: "#FEF3C7",
    image: U("photo-1504148455328-c376efea4a0f"),
  },
  {
    id: "appliance",
    name: "Appliance Repair",
    count: 15,
    serviceId: "electrician",
    icon: Wrench,
    iconColor: "#64748B",
    iconBg: "#F1F5F9",
    image: U("photo-1558618666-fcd25c85cd64"),
  },
];

export const AI_RECOMMENDATIONS: AiRecommendation[] = [
  {
    id: "ac-due",
    title: "AC Service Due Soon",
    description:
      "Your AC performance may decrease. Book preventive maintenance now.",
    badge: "AI Recommended",
    serviceId: "ac-service",
    gradient: "from-blue-500/15 to-violet-500/10",
    icon: AirVent,
  },
  {
    id: "deep-clean",
    title: "Deep Cleaning Recommended",
    description: "It's been 45 days. Keep your home fresh and healthy.",
    badge: "Popular",
    serviceId: "cleaning",
    gradient: "from-orange-500/15 to-rose-500/10",
    icon: SprayCan,
  },
  {
    id: "water-filter",
    title: "Water Filter Replacement",
    description: "Your water filter life is 70% used — schedule a visit.",
    badge: "AI Recommended",
    serviceId: "plumbing",
    gradient: "from-cyan-500/15 to-blue-500/10",
    icon: Droplets,
  },
  {
    id: "pest",
    title: "Pest Control Suggested",
    description: "Season change detected. Protect your home proactively.",
    badge: "Urgent",
    serviceId: "pest-control",
    gradient: "from-emerald-500/15 to-lime-500/10",
    icon: Bug,
  },
];

export const TRENDING_SERVICES: TrendingServiceItem[] = [
  {
    id: "t1",
    title: "Deep Home Cleaning",
    provider: "HOMIGO Pro",
    providerAvatar: U("photo-1573496359142-b8d87734a5a2", 96),
    rating: 4.8,
    reviews: 54,
    price: 899,
    duration: "3.5 hrs",
    type: "Premium",
    image: U("photo-1581578731548-c64695cc6952"),
    serviceId: "cleaning",
  },
  {
    id: "t2",
    title: "AC Full Service",
    provider: "CoolCare Experts",
    providerAvatar: U("photo-1560250097-0b93528c311a", 96),
    rating: 4.9,
    reviews: 128,
    price: 599,
    duration: "2 hrs",
    type: "Maintenance",
    image: U("photo-1585771721814-51ae77187df2"),
    serviceId: "ac-service",
  },
  {
    id: "t3",
    title: "Plumbing Repair",
    provider: "PipeFix India",
    providerAvatar: U("photo-1472099645785-5658abf4ff4e", 96),
    rating: 4.7,
    reviews: 89,
    price: 499,
    duration: "1.5 hrs",
    type: "Repair",
    image: U("photo-1607472586893-edb57bdc0e39"),
    serviceId: "plumbing",
  },
  {
    id: "t4",
    title: "Electrician Visit",
    provider: "SparkSafe",
    providerAvatar: U("photo-1507003211169-0a1dd7228f2d", 96),
    rating: 4.8,
    reviews: 203,
    price: 399,
    duration: "1 hr",
    type: "Visit",
    image: U("photo-1621905252472-943afaa0e938"),
    serviceId: "electrician",
  },
  {
    id: "t5",
    title: "Pest Control",
    provider: "ShieldHome",
    providerAvatar: U("photo-1494790108377-be9c29b29330", 96),
    rating: 4.6,
    reviews: 67,
    price: 699,
    duration: "45 mins",
    type: "Treatment",
    image: U("photo-1584515934247-1a1b9f966279"),
    serviceId: "pest-control",
  },
];

export const LIVE_TRACKING_MAP_IMAGE = U(
  "photo-1524661135-423995f22d0b",
);

export const TRUST_ITEMS: TrustItem[] = [
  {
    title: "Verified Professionals",
    description: "Background verified experts only",
    icon: UserCheck,
    iconColor: "#16A34A",
    iconBg: "#DCFCE7",
  },
  {
    title: "Secure & Safe",
    description: "100% secure payments & data",
    icon: ShieldCheck,
    iconColor: "#2563EB",
    iconBg: "#DBEAFE",
  },
  {
    title: "AI-Powered Matching",
    description: "Right expert for your home",
    icon: Bot,
    iconColor: "#7C3AED",
    iconBg: "#EDE9FE",
  },
  {
    title: "On-time Service",
    description: "Punctual and reliable visits",
    icon: Clock,
    iconColor: "#EA580C",
    iconBg: "#FFEDD5",
  },
  {
    title: "24/7 Support",
    description: "We're always here to help",
    icon: Headphones,
    iconColor: "#CA8A04",
    iconBg: "#FEF9C3",
  },
];

export const CUSTOMER_REVIEWS: CustomerReview[] = [
  {
    id: "r1",
    name: "Rahul Verma",
    location: "Gurugram",
    rating: 5,
    review:
      "Amazing service! The cleaner was on time and did a fantastic job. My home feels brand new!",
    avatar:
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=90&auto=format&fit=crop",
  },
  {
    id: "r2",
    name: "Priya Mehta",
    location: "Gurugram",
    rating: 5,
    review:
      "Booked AC service and the technician was very professional and quick. Highly recommended!",
    avatar:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&q=90&auto=format&fit=crop",
  },
  {
    id: "r3",
    name: "Vikram Singh",
    location: "Gurugram",
    rating: 5,
    review:
      "HOMIGO is the go-to app for all home services. Super reliable and easy to use.",
    avatar:
      "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&q=90&auto=format&fit=crop",
  },
];

export const CTA_ROOM_IMAGE = U(
  "photo-1616486297864-5c04a511ad6e",
);

export const HOUSE_3D_SRC = "/3d-house.png";
