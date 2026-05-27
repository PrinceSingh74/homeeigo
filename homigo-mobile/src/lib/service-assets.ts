import type { ImageSourcePropType } from "react-native";

/** Local service illustrations (same paths as ServiceCategories). */
export const SERVICE_IMAGES: Record<string, ImageSourcePropType> = {
  cleaning: require("../../assets/svc-cleaning.png"),
  ac: require("../../assets/svc-ac.png"),
  plumbing: require("../../assets/svc-plumbing.png"),
  electrician: require("../../assets/svc-electrician.png"),
  pest: require("../../assets/svc-pest.png"),
};

export function getServiceImage(imageKey?: string) {
  if (!imageKey) return undefined;
  return SERVICE_IMAGES[imageKey];
}
