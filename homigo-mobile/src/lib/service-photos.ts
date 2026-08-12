import type { ImageSourcePropType } from "react-native";

/**
 * Branded service photography — SAME artwork as the website's Popular Services
 * (apps/web/public/services/*), compressed to 720px webp for mobile.
 * Matching mirrors web `service-visuals.ts`: match on the service NAME so any
 * backend service automatically picks up its branded photo.
 */
const PHOTO_RULES: Array<{ match: RegExp; photo: ImageSourcePropType; accent: string }> = [
  { match: /bathroom/i, photo: require("../../assets/services/bathroom-cleaning.webp"), accent: "#38bdf8" },
  { match: /sofa|upholstery|couch/i, photo: require("../../assets/services/sofa-deep-cleaning.webp"), accent: "#059669" },
  { match: /fridge|refrigerator/i, photo: require("../../assets/services/fridge-cleaning.webp"), accent: "#06b6d4" },
  { match: /packing|unpacking/i, photo: require("../../assets/services/packing-unpacking.webp"), accent: "#f59e0b" },
  { match: /utensil|dish/i, photo: require("../../assets/services/utensils.webp"), accent: "#f97316" },
  { match: /kitchen prep|meal|cook(?!ing pot)/i, photo: require("../../assets/services/kitchen-prep.webp"), accent: "#fb7185" },
  { match: /dusting|wiping/i, photo: require("../../assets/services/dusting-wiping.webp"), accent: "#a78bfa" },
  { match: /sweep|mop/i, photo: require("../../assets/services/sweeping-mopping.webp"), accent: "#8b5cf6" },
  { match: /pre-?party/i, photo: require("../../assets/services/pre-party.webp"), accent: "#ec4899" },
  { match: /after-?party/i, photo: require("../../assets/services/after-party.webp"), accent: "#e11d48" },
  { match: /wardrobe/i, photo: require("../../assets/services/wardrobe-cleaning.webp"), accent: "#6366f1" },
  { match: /iron|fold/i, photo: require("../../assets/services/ironing-folding.webp"), accent: "#d946ef" },
  { match: /window|glass/i, photo: require("../../assets/services/window-cleaning.webp"), accent: "#3b82f6" },
  { match: /laundry|wash(ing)? ?machine/i, photo: require("../../assets/services/laundry.webp"), accent: "#0284c7" },
  { match: /cabinet/i, photo: require("../../assets/services/kitchen-cabinet.webp"), accent: "#b45309" },
  { match: /kitchen/i, photo: require("../../assets/services/kitchen-cleaning.webp"), accent: "#10b981" },
  { match: /balcony|terrace/i, photo: require("../../assets/services/balcony-cleaning.webp"), accent: "#84cc16" },
  { match: /fan/i, photo: require("../../assets/services/fan-cleaning.webp"), accent: "#14b8a6" },
  { match: /plant|garden/i, photo: require("../../assets/services/plant-care.webp"), accent: "#22c55e" },
  { match: /car|vehicle/i, photo: require("../../assets/services/car-surface.webp"), accent: "#0ea5e9" },
];

export type ServicePhoto = { photo: ImageSourcePropType; accent: string } | null;

/** Branded photo + accent for a service name; null when no branded artwork exists. */
export function getServicePhoto(name: string | undefined | null): ServicePhoto {
  if (!name) return null;
  for (const rule of PHOTO_RULES) {
    if (rule.match.test(name)) return { photo: rule.photo, accent: rule.accent };
  }
  return null;
}
