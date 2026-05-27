import type { ImageSourcePropType } from "react-native";
import { SERVICE_IMAGES } from "./service-assets";

export const AI_USER = { name: "Arjun" };

export const AI_TAGLINE = "Your Home. Our Intelligence.";

export const QUICK_ACTIONS: {
  label: string;
  serviceId: string;
  image: ImageSourcePropType;
  /** Solid accent color used for shadow/glow + subtle tint */
  accent: string;
  /** Soft gradient tint behind icon (low opacity) */
  tint: [string, string];
}[] = [
  {
    label: "Cleaning",
    serviceId: "cleaning",
    image: SERVICE_IMAGES.cleaning,
    accent: "#60A5FA",
    tint: ["rgba(96, 165, 250, 0.22)", "rgba(59, 130, 246, 0.05)"],
  },
  {
    label: "AC Service",
    serviceId: "ac-service",
    image: SERVICE_IMAGES.ac,
    accent: "#00D1FF",
    tint: ["rgba(0, 209, 255, 0.22)", "rgba(37, 99, 235, 0.05)"],
  },
  {
    label: "Plumbing",
    serviceId: "plumbing",
    image: SERVICE_IMAGES.plumbing,
    accent: "#22D3EE",
    tint: ["rgba(34, 211, 238, 0.20)", "rgba(14, 116, 144, 0.05)"],
  },
  {
    label: "Electrician",
    serviceId: "electrician",
    image: SERVICE_IMAGES.electrician,
    accent: "#FBBF24",
    tint: ["rgba(251, 191, 36, 0.22)", "rgba(245, 158, 11, 0.05)"],
  },
  {
    label: "Pest Control",
    serviceId: "pest-control",
    image: SERVICE_IMAGES.pest,
    accent: "#4ADE80",
    tint: ["rgba(74, 222, 128, 0.22)", "rgba(22, 163, 74, 0.05)"],
  },
  {
    label: "Deep Cleaning",
    serviceId: "cleaning",
    image: SERVICE_IMAGES.cleaning,
    accent: "#A855F7",
    tint: ["rgba(168, 85, 247, 0.22)", "rgba(109, 40, 217, 0.05)"],
  },
];

export const CHAT_MESSAGES = [
  { id: "u1", role: "user" as const, text: "AC cooling kam kar raha hai", time: "09:41 AM" },
  {
    id: "a1",
    role: "assistant" as const,
    text: "Possible airflow issue detected. Would you like instant diagnosis?",
    time: "09:41 AM",
  },
];

export const CHAT_ACTIONS = ["Diagnose Now", "Book Expert", "Upload Photo"] as const;

export const RECOMMENDATIONS: {
  title: string;
  note: string;
  serviceId: string;
  image: ImageSourcePropType;
  accent: string;
  tint: [string, string];
}[] = [
  {
    title: "Deep Cleaning",
    note: "Recommended next week",
    serviceId: "cleaning",
    image: SERVICE_IMAGES.cleaning,
    accent: "#A855F7",
    tint: ["rgba(168, 85, 247, 0.22)", "rgba(109, 40, 217, 0.05)"],
  },
  {
    title: "AC Maintenance",
    note: "Recommended in 7 days",
    serviceId: "ac-service",
    image: SERVICE_IMAGES.ac,
    accent: "#00D1FF",
    tint: ["rgba(0, 209, 255, 0.22)", "rgba(37, 99, 235, 0.05)"],
  },
  {
    title: "Water Filter Change",
    note: "Due in 15 days",
    serviceId: "plumbing",
    image: SERVICE_IMAGES.plumbing,
    accent: "#22D3EE",
    tint: ["rgba(34, 211, 238, 0.20)", "rgba(14, 116, 144, 0.05)"],
  },
  {
    title: "Pest Control",
    note: "Recommended in 20 days",
    serviceId: "pest-control",
    image: SERVICE_IMAGES.pest,
    accent: "#4ADE80",
    tint: ["rgba(74, 222, 128, 0.22)", "rgba(22, 163, 74, 0.05)"],
  },
];
