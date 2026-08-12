import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Bed,
  Blinds,
  Brush,
  Bug,
  Car,
  ChefHat,
  Clock,
  CookingPot,
  Fan,
  Fence,
  Layers,
  PackageOpen,
  PaintRoller,
  PartyPopper,
  Refrigerator,
  Scissors,
  Shirt,
  ShowerHead,
  Snowflake,
  Sofa,
  Sparkles,
  Sprout,
  UtensilsCrossed,
  WashingMachine,
  Wine,
  Wrench,
  Zap,
} from "lucide-react";

export type ServiceVisual = { icon: LucideIcon; color: string; photo?: string };

/** Full-bleed card artwork (verified-live Unsplash IDs, CDN-optimised). */
const u = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=640&q=70`;

/**
 * Curated icon + brand-tint + card photo per service, matched by name keywords
 * so it works for every service the backend returns (order matters — first
 * match wins). One place to keep the marketplace looking like one system.
 */
const VISUALS: Array<{ match: RegExp; visual: ServiceVisual }> = [
  { match: /hourly/i, visual: { icon: Clock, color: "#0ea5e9", photo: u("photo-1495364141860-b0d03eccd065") } },
  { match: /bathroom/i, visual: { icon: ShowerHead, color: "#38bdf8", photo: "/services/bathroom-cleaning.png" } },
  { match: /fridge|refrigerator/i, visual: { icon: Refrigerator, color: "#06b6d4", photo: "/services/fridge-cleaning.png" } },
  { match: /packing|unpacking/i, visual: { icon: PackageOpen, color: "#f59e0b", photo: "/services/packing-unpacking.png" } },
  { match: /utensil|dish/i, visual: { icon: UtensilsCrossed, color: "#f97316", photo: "/services/utensils.png" } },
  { match: /kitchen prep|meal|cook(?!ing pot)/i, visual: { icon: ChefHat, color: "#fb7185", photo: "/services/kitchen-prep.png" } },
  { match: /dusting|wiping/i, visual: { icon: Sparkles, color: "#a78bfa", photo: "/services/dusting-wiping.png" } },
  { match: /sweep|mop/i, visual: { icon: Brush, color: "#8b5cf6", photo: "/services/sweeping-mopping.png" } },
  { match: /pre-?party/i, visual: { icon: PartyPopper, color: "#ec4899", photo: "/services/pre-party.png" } },
  { match: /after-?party/i, visual: { icon: Wine, color: "#e11d48", photo: "/services/after-party.png" } },
  { match: /wardrobe/i, visual: { icon: Shirt, color: "#6366f1", photo: "/services/wardrobe-cleaning.png" } },
  { match: /iron|fold/i, visual: { icon: Layers, color: "#d946ef", photo: "/services/ironing-folding.png" } },
  { match: /window|glass/i, visual: { icon: Blinds, color: "#3b82f6", photo: "/services/window-cleaning.png" } },
  { match: /laundry|wash(ing)? ?machine/i, visual: { icon: WashingMachine, color: "#0284c7", photo: "/services/laundry.png" } },
  { match: /cabinet/i, visual: { icon: Archive, color: "#b45309", photo: "/services/kitchen-cabinet.png" } },
  { match: /kitchen/i, visual: { icon: CookingPot, color: "#10b981", photo: "/services/kitchen-cleaning.png" } },
  { match: /balcony|terrace/i, visual: { icon: Fence, color: "#84cc16", photo: "/services/balcony-cleaning.png" } },
  { match: /fan/i, visual: { icon: Fan, color: "#14b8a6", photo: "/services/fan-cleaning.png" } },
  { match: /plant|garden/i, visual: { icon: Sprout, color: "#22c55e", photo: "/services/plant-care.png" } },
  { match: /car|vehicle/i, visual: { icon: Car, color: "#64748b", photo: "/services/car-surface.png" } },
  // Existing catalog beyond the popular grid — same design language everywhere.
  { match: /\bac\b|air.?cond/i, visual: { icon: Snowflake, color: "#0ea5e9" } },
  { match: /plumb/i, visual: { icon: Wrench, color: "#f59e0b" } },
  { match: /electric/i, visual: { icon: Zap, color: "#eab308" } },
  { match: /pest/i, visual: { icon: Bug, color: "#ef4444" } },
  { match: /sofa|upholstery|couch/i, visual: { icon: Sofa, color: "#059669", photo: "/services/sofa-deep-cleaning.png" } },
  { match: /salon|beauty|hair/i, visual: { icon: Scissors, color: "#ec4899" } },
  { match: /paint/i, visual: { icon: PaintRoller, color: "#f97316" } },
  { match: /mattress|bed/i, visual: { icon: Bed, color: "#6366f1" } },
];

const DEFAULT_VISUAL: ServiceVisual = { icon: Sparkles, color: "#7c3aed" };

export function serviceVisual(name: string | undefined | null): ServiceVisual {
  if (!name) return DEFAULT_VISUAL;
  for (const { match, visual } of VISUALS) {
    if (match.test(name)) return visual;
  }
  return DEFAULT_VISUAL;
}
