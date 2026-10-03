import { matchServiceVisual } from "@/lib/service-visuals";

/** Real work photos — never the welcome portrait or the cartoon mop icon. */
const BY_SLUG: Record<string, string> = {
  "hourly-home-help": "/hero-professional.png",
  "dusting-wiping": "/services/dusting-wiping.png",
  "sweeping-mopping": "/services/sweeping-mopping.png",
  utensils: "/services/utensils.png",
  "kitchen-prep": "/services/kitchen-prep.png",
  "ironing-folding": "/services/ironing-folding.png",
  laundry: "/services/laundry.png",
  "packing-unpacking": "/services/packing-unpacking.png",
  "home-organization": "/services/wardrobe-cleaning.png",
  "decluttering-assistance": "/services/wardrobe-cleaning.png",
};

const FALLBACK = "/services/dusting-wiping.png";

function isGeneric(src?: string | null) {
  if (!src) return true;
  return (
    src.includes("homigo-welcome") ||
    src.includes("svc-cleaning") ||
    src.includes("unsplash") ||
    src.includes("images.unsplash")
  );
}

export function homeHelpPhoto(svc: { slug: string; name: string; image?: string | null }) {
  if (BY_SLUG[svc.slug]) return BY_SLUG[svc.slug];
  const visual = matchServiceVisual(svc.name)?.photo;
  if (visual?.startsWith("/") && !isGeneric(visual)) return visual;
  if (!isGeneric(svc.image)) return svc.image as string;
  return FALLBACK;
}
