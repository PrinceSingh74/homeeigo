import type { ImageSourcePropType } from "react-native";
import { getServiceImage } from "@/lib/service-assets";

export type CategoryItem = {
  id: number;
  name: string;
  count: number;
  emoji: string;
  bgColor: string;
  serviceId: string;
};

export type AiRecommendation = {
  id: number;
  title: string;
  desc: string;
  emoji: string;
  bgFrom: string;
  bgTo: string;
  urgent: boolean;
  serviceId: string;
};

export type TrendingService = {
  id: number;
  title: string;
  rating: number | null;
  reviews: string;
  price: number;
  duration: string;
  imageUri: string;
  serviceId: string;
  categoryIds: number[];
};

export type ExpressService = {
  icon: string;
  name: string;
  price: number;
  iconBg: string;
  iconColor: string;
  serviceId: string;
};

export type WhyFeature = {
  icon: string;
  title: string;
  desc: string;
  color: string;
  bg: string;
};

export type PremiumFeature = {
  icon: string;
  label: string;
};

export type CustomerReview = {
  id: number;
  name: string;
  location: string;
  rating: number;
  review: string;
  initial: string;
};

export const CATEGORIES: CategoryItem[] = [
  { id: 1, name: "Cleaning", count: 18, emoji: "🧹", bgColor: "#EEF2FF", serviceId: "cleaning" },
  { id: 2, name: "AC Service", count: 12, emoji: "❄️", bgColor: "#E0F2FE", serviceId: "ac-service" },
  { id: 3, name: "Plumbing", count: 16, emoji: "🔧", bgColor: "#E0F7FA", serviceId: "plumbing" },
  { id: 4, name: "Electrician", count: 14, emoji: "⚡", bgColor: "#FFF9C4", serviceId: "electrician" },
  { id: 5, name: "Pest Control", count: 8, emoji: "🐛", bgColor: "#F0FFF4", serviceId: "pest-control" },
  { id: 6, name: "Salon & Spa", count: 20, emoji: "💜", bgColor: "#FDF4FF", serviceId: "salon" },
  { id: 7, name: "Painting", count: 10, emoji: "🎨", bgColor: "#FFF7ED", serviceId: "cleaning" },
  { id: 8, name: "Carpentry", count: 12, emoji: "🔨", bgColor: "#FEF3C7", serviceId: "electrician" },
  { id: 9, name: "Appliance Repair", count: 15, emoji: "🔌", bgColor: "#F0F4FF", serviceId: "electrician" },
];

export const AI_RECOMMENDATIONS: AiRecommendation[] = [
  {
    id: 1,
    title: "AC Service Due Soon",
    desc: "Your AC performance may decrease. Book preventive maintenance.",
    emoji: "❄️",
    bgFrom: "#FFFFFF",
    bgTo: "#F0EAFF",
    urgent: false,
    serviceId: "ac-service",
  },
  {
    id: 2,
    title: "Deep Cleaning Recommended",
    desc: "It's been 45 days. Keep your home fresh & healthy.",
    emoji: "🧹",
    bgFrom: "#FFFFFF",
    bgTo: "#FFF0F0",
    urgent: false,
    serviceId: "cleaning",
  },
  {
    id: 3,
    title: "Water Filter Replacement",
    desc: "Your water filter life is 70% used.",
    emoji: "💧",
    bgFrom: "#FFFFFF",
    bgTo: "#E0F7FA",
    urgent: false,
    serviceId: "plumbing",
  },
  {
    id: 4,
    title: "Pest Control Suggested",
    desc: "Season change detected. Protect your home.",
    emoji: "🐛",
    bgFrom: "#FFFFFF",
    bgTo: "#F0FFF0",
    urgent: true,
    serviceId: "pest-control",
  },
];

export const TRENDING_SERVICES: TrendingService[] = [
  {
    id: 1,
    title: "Deep Home Cleaning",
    rating: 4.8,
    reviews: "12.6k",
    price: 899,
    duration: "2.5 hrs",
    imageUri:
      "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=1600&q=90&auto=format&fit=crop",
    serviceId: "cleaning",
    categoryIds: [1],
  },
  {
    id: 2,
    title: "AC Full Service",
    rating: 4.9,
    reviews: "7k",
    price: 599,
    duration: "1.5 hrs",
    imageUri:
      "https://images.unsplash.com/photo-1635048424329-a9bfb146d7aa?w=1600&q=90&auto=format&fit=crop",
    serviceId: "ac-service",
    categoryIds: [2],
  },
  {
    id: 3,
    title: "Plumbing Repair",
    rating: 4.7,
    reviews: "6.1k",
    price: 499,
    duration: "1 hr",
    imageUri:
      "https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?w=1600&q=90&auto=format&fit=crop",
    serviceId: "plumbing",
    categoryIds: [3],
  },
  {
    id: 4,
    title: "Electrician Visit",
    rating: 4.8,
    reviews: "9.3k",
    price: 399,
    duration: "45 mins",
    imageUri:
      "https://images.unsplash.com/photo-1621905252472-943afaa0e938?w=1600&q=90&auto=format&fit=crop",
    serviceId: "electrician",
    categoryIds: [4],
  },
  {
    id: 5,
    title: "Pest Control",
    rating: 4.6,
    reviews: "4.4k",
    price: 699,
    duration: "1.5 hrs",
    imageUri:
      "https://images.unsplash.com/photo-1584622781867-cf7ebc2f0a0c?w=1600&q=90&auto=format&fit=crop",
    serviceId: "pest-control",
    categoryIds: [5],
  },
];

export const EXPRESS_SERVICES: ExpressService[] = [
  {
    icon: "⚡",
    name: "Electrician",
    price: 399,
    iconBg: "#312060",
    iconColor: "#A78BFA",
    serviceId: "electrician",
  },
  {
    icon: "🔧",
    name: "Plumbing",
    price: 499,
    iconBg: "#1A3A2A",
    iconColor: "#34D399",
    serviceId: "plumbing",
  },
  {
    icon: "❄️",
    name: "AC Quick Fix",
    price: 599,
    iconBg: "#1A2A4A",
    iconColor: "#60A5FA",
    serviceId: "ac-service",
  },
];

export const WHY_FEATURES: WhyFeature[] = [
  { icon: "🛡️", title: "Background Verified", desc: "All partners undergo thorough background checks", color: "#059669", bg: "#D1FAE5" },
  { icon: "⏰", title: "On-Time Guarantee", desc: "Arrive on time, every time. Guaranteed.", color: "#0d9488", bg: "#CCFBF1" },
  { icon: "✅", title: "Satisfaction Guaranteed", desc: "100% satisfaction or your money back", color: "#15803d", bg: "#DCFCE7" },
  { icon: "🔒", title: "Secure Payments", desc: "Safe, encrypted transactions always", color: "#0f766e", bg: "#CCFBF1" },
  { icon: "🤖", title: "AI Scheduling", desc: "Smart matching for best service quality", color: "#059669", bg: "#D1FAE5" },
  { icon: "📍", title: "Live Tracking", desc: "Know where your service partner is", color: "#14b8a6", bg: "#CCFBF1" },
  { icon: "👥", title: "Verified Partners", desc: "10,000+ verified experts across India", color: "#15803d", bg: "#DCFCE7" },
  { icon: "💸", title: "Transparent Pricing", desc: "No hidden charges, no surprises", color: "#0d9488", bg: "#CCFBF1" },
];


export const PREMIUM_FEATURES: PremiumFeature[] = [
  { icon: "📅", label: "Priority Booking" },
  { icon: "⭐", label: "Elite Experts" },
  { icon: "🔄", label: "Free Revisits" },
  { icon: "✨", label: "AI Optimization" },
  { icon: "⚡", label: "Faster Support" },
];

export const CUSTOMER_REVIEWS: CustomerReview[] = [
  {
    id: 1,
    name: "Rahul Sharma",
    location: "Gurugram",
    rating: 5,
    review:
      "Amazing service! The cleaner was on time and did a fantastic job. My home feels brand new.",
    initial: "R",
  },
  {
    id: 2,
    name: "Priya Mehta",
    location: "Gurugram",
    rating: 5,
    review:
      "Booked AC service and the technician was very professional and quick. Highly recommended!",
    initial: "P",
  },
  {
    id: 3,
    name: "Vikram Singh",
    location: "Gurugram",
    rating: 5,
    review:
      "Homeeigo is my go-to app for all home services. Super reliable and easy to use.",
    initial: "V",
  },
];

export const POPULAR_SEARCHES = [
  "AC Service",
  "Deep Cleaning",
  "Plumbing",
  "Electrician",
] as const;

/** Local 3D house hero (from apps/web/public) */
export const HOUSE_3D_IMAGE: ImageSourcePropType = require("../../assets/house-3d.png");

export function trendingImageSource(
  serviceId: string,
): ImageSourcePropType | { uri: string } {
  const local = getServiceImage(
    serviceId === "ac-service"
      ? "ac"
      : serviceId === "pest-control"
        ? "pest"
        : serviceId,
  );
  return local ?? { uri: "" };
}
