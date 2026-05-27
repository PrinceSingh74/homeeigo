import type { LucideIcon } from "lucide-react-native";
import { Sparkles, Tag, MapPin } from "lucide-react-native";

export type ServicesNotification = {
  id: string;
  icon: LucideIcon;
  title: string;
  body: string;
  time: string;
  serviceId: string;
  promo?: string;
};

export const SERVICES_NOTIFICATIONS: ServicesNotification[] = [
  {
    id: "1",
    icon: Sparkles,
    title: "Your pro is on the way",
    body: "Rajesh will arrive in ~12 minutes for Home Cleaning.",
    time: "2m ago",
    serviceId: "cleaning",
  },
  {
    id: "2",
    icon: Tag,
    title: "New offer: COOL100",
    body: "Flat ₹100 off on AC Service — valid today only.",
    time: "1h ago",
    serviceId: "ac-service",
    promo: "COOL100",
  },
  {
    id: "3",
    icon: MapPin,
    title: "Service completed",
    body: "Plumbing job marked complete. Rate your experience.",
    time: "Yesterday",
    serviceId: "plumbing",
  },
];
