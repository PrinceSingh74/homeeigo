import type { ServiceCatalogConfig } from "./service-catalog-config";
// A cycle with service-domain (it imports this module too). Safe: both sides only call the other
// from inside functions, never while the module is loading.
import { declaredNotApplicable, type CapabilityProfile } from "./service-domain";

/**
 * Runtime consumption of catalogConfig. Unset flags keep TODAY's behaviour
 * (coupons/wallet/membership/split allowed; matching uses the fixed 30/25/20/15/10 points).
 * Explicit `false` / configured weights change the existing engines — they do not add new ones.
 */

export type PaymentCapabilities = {
  walletAvailable: boolean;
  couponAvailable: boolean;
  membershipAvailable: boolean;
  splitPaymentAvailable: boolean;
};

/** Default allow when the admin has not set a policy. Explicit false is enforced. */
export function paymentCapabilities(cfg: ServiceCatalogConfig | null): PaymentCapabilities {
  const p = cfg?.payment;
  return {
    walletAvailable: p?.walletAllowed !== false,
    couponAvailable: p?.couponAllowed !== false,
    membershipAvailable: p?.membershipAllowed !== false,
    splitPaymentAvailable: p?.splitPaymentAllowed !== false,
  };
}

export type PaymentPolicyError =
  | "WALLET_NOT_ALLOWED"
  | "COUPON_NOT_ALLOWED"
  | "MEMBERSHIP_NOT_ALLOWED"
  | "SPLIT_NOT_ALLOWED";

export function assertWalletAllowed(cfg: ServiceCatalogConfig | null): PaymentPolicyError | null {
  return paymentCapabilities(cfg).walletAvailable ? null : "WALLET_NOT_ALLOWED";
}

export function assertSplitAllowed(cfg: ServiceCatalogConfig | null): PaymentPolicyError | null {
  return paymentCapabilities(cfg).splitPaymentAvailable ? null : "SPLIT_NOT_ALLOWED";
}

/**
 * Typed by SHAPE, not by value: `as const` made each default a literal type (`0.3`), so an
 * admin-configured weight (a plain number) could not be assigned to it — `configuredMatchingWeights`
 * returns `typeof DEFAULT_WEIGHTS`, which is exactly where the tsc errors came from.
 */
export type MatchingWeights = {
  rating: number;
  distance: number;
  availability: number;
  response: number;
  completion: number;
};

const DEFAULT_WEIGHTS: MatchingWeights = {
  rating: 0.3,
  distance: 0.25,
  availability: 0.2,
  response: 0.15,
  completion: 0.1,
};

const MAX_POINTS = {
  rating: 30,
  distance: 25,
  availability: 20,
  response: 15,
  completion: 10,
} as const;

export type MatchingComponentScores = {
  ratingScore: number;
  distanceScore: number;
  availabilityScore: number;
  responseScore: number;
  completionScore: number;
};

/** Null = keep the historical additive 0–100 formula. */
export function configuredMatchingWeights(cfg: ServiceCatalogConfig | null): typeof DEFAULT_WEIGHTS | null {
  const m = cfg?.matching;
  if (!m) return null;
  const any =
    m.ratingWeight != null ||
    m.distanceWeight != null ||
    m.availabilityWeight != null ||
    m.responseWeight != null ||
    m.completionWeight != null;
  if (!any) return null;
  return {
    rating: m.ratingWeight ?? DEFAULT_WEIGHTS.rating,
    distance: m.distanceWeight ?? DEFAULT_WEIGHTS.distance,
    availability: m.availabilityWeight ?? DEFAULT_WEIGHTS.availability,
    response: m.responseWeight ?? DEFAULT_WEIGHTS.response,
    completion: m.completionWeight ?? DEFAULT_WEIGHTS.completion,
  };
}

export function applyMatchingWeights(
  components: MatchingComponentScores,
  weights: typeof DEFAULT_WEIGHTS,
): number {
  const sum =
    weights.rating + weights.distance + weights.availability + weights.response + weights.completion;
  if (!(sum > 0)) {
    return (
      components.ratingScore +
      components.distanceScore +
      components.availabilityScore +
      components.responseScore +
      components.completionScore
    );
  }
  return (
    100 *
    ((components.ratingScore / MAX_POINTS.rating) * (weights.rating / sum) +
      (components.distanceScore / MAX_POINTS.distance) * (weights.distance / sum) +
      (components.availabilityScore / MAX_POINTS.availability) * (weights.availability / sum) +
      (components.responseScore / MAX_POINTS.response) * (weights.response / sum) +
      (components.completionScore / MAX_POINTS.completion) * (weights.completion / sum))
  );
}

export type QualitySnapshot = {
  proofRequired: boolean;
  beforeAfterPhotos: boolean;
  checklist: string[];
  notApplicable: boolean;
  warrantyDays: number;
  customerConfirmation: boolean;
  /**
   * Phase 10 §10: hours the customer has to confirm or report an issue after completion. Frozen
   * here so the booking's own window is what booking_completions.confirm_by is computed from;
   * absent = the platform default (48, the published legal window).
   */
  confirmationWindowHours?: number;
  /** What "done" means for this service, shown to the professional. Absent on older bookings. */
  completionCriteria?: string[];
  /** The professional must attest the criteria were met before the job can complete. */
  professionalConfirmation?: boolean;
};

function validWindowHours(h: unknown): number | undefined {
  return typeof h === "number" && Number.isInteger(h) && h >= 1 && h <= 720 ? h : undefined;
}

/**
 * What a booking freezes as its quality standard. Quality is switched off only when the service
 * DECLARES it not applicable — asked through `declaredNotApplicable`, the publish gate's own
 * question. The bare `quality.notApplicable` flag used to switch the checks off here while the gate
 * reported the same service as incomplete; without its reason the flag now switches nothing off.
 */
export function qualitySnapshot(cfg: ServiceCatalogConfig | null): QualitySnapshot | null {
  const q = cfg?.quality;
  if (!q || declaredNotApplicable(cfg, "quality")) return null;
  const checklist = q.checklist ?? [];
  const proofRequired = q.proofRequired === true;
  const beforeAfterPhotos = q.beforeAfterPhotos === true;
  const warrantyDays = q.warrantyDays ?? 0;
  const customerConfirmation = q.customerConfirmation === true;
  const completionCriteria = q.completionCriteria ?? [];
  const professionalConfirmation = q.professionalConfirmation === true;
  if (
    !proofRequired && !beforeAfterPhotos && checklist.length === 0 && warrantyDays <= 0 &&
    completionCriteria.length === 0 && !professionalConfirmation
  ) {
    return null;
  }
  const confirmationWindowHours = validWindowHours(q.confirmationWindowHours);
  return {
    proofRequired, beforeAfterPhotos, checklist, notApplicable: false, warrantyDays, customerConfirmation,
    ...(confirmationWindowHours !== undefined ? { confirmationWindowHours } : {}),
    ...(completionCriteria.length > 0 ? { completionCriteria: [...completionCriteria] } : {}),
    ...(professionalConfirmation ? { professionalConfirmation } : {}),
  };
}

/**
 * Reads what a booking FROZE, not the catalogue. `qualitySnapshot` never writes `notApplicable:
 * true` (a declared section is frozen as null), so the flag below is only ever true on a snapshot
 * frozen before that rule. That booking's decision was made when it was booked and is honoured as
 * recorded; there is no reason beside it to re-ask.
 */
export function qualityFromSnapshot(snap: unknown): QualitySnapshot | null {
  if (!snap || typeof snap !== "object" || Array.isArray(snap)) return null;
  const q = (snap as { quality?: Partial<QualitySnapshot> | null }).quality;
  if (!q || q.notApplicable) return null;
  const checklist = Array.isArray(q.checklist) ? q.checklist.filter((x) => typeof x === "string") : [];
  return {
    proofRequired: q.proofRequired === true,
    beforeAfterPhotos: q.beforeAfterPhotos === true,
    checklist,
    notApplicable: false,
    warrantyDays: typeof q.warrantyDays === "number" ? q.warrantyDays : 0,
    customerConfirmation: q.customerConfirmation === true,
    ...(validWindowHours(q.confirmationWindowHours) !== undefined ? { confirmationWindowHours: validWindowHours(q.confirmationWindowHours) } : {}),
    ...(Array.isArray(q.completionCriteria) && q.completionCriteria.length > 0
      ? { completionCriteria: q.completionCriteria.filter((x) => typeof x === "string") }
      : {}),
    ...(q.professionalConfirmation === true ? { professionalConfirmation: true } : {}),
  };
}

export function qualityBlocksCompletion(
  quality: QualitySnapshot | null | undefined,
  evidence: { photos: number; hasBefore: boolean; hasAfter: boolean; checklistComplete: boolean },
): "QUALITY_PROOF_REQUIRED" | "QUALITY_CHECKLIST_REQUIRED" | null {
  if (!quality) return null;
  if (quality.beforeAfterPhotos && !(evidence.hasBefore && evidence.hasAfter)) {
    return "QUALITY_PROOF_REQUIRED";
  }
  if (quality.proofRequired && evidence.photos < 1) {
    return "QUALITY_PROOF_REQUIRED";
  }
  if (quality.checklist.length > 0 && !evidence.checklistComplete) {
    return "QUALITY_CHECKLIST_REQUIRED";
  }
  return null;
}

export function warrantyWindow(
  quality: QualitySnapshot | null | undefined,
  completedAt: Date,
): { days: number; until: string } | null {
  if (!quality || !(quality.warrantyDays > 0)) return null;
  const until = new Date(completedAt.getTime() + quality.warrantyDays * 86_400_000);
  return { days: quality.warrantyDays, until: until.toISOString() };
}

/** Customer-safe booking steps implied by the capability profile. Not a second engine. */
export function bookingFlowForProfile(profile: CapabilityProfile): string[] {
  switch (profile) {
    case "BEAUTY":
      return ["audience", "variant", "addons", "slot", "quote"];
    case "HOME_HELP":
      return ["quantity", "slot", "quote"];
    case "CLEANING":
      return ["quantity", "variant", "addons", "slot", "quote"];
    case "REPAIR":
    case "APPLIANCE":
      return ["issue", "slot", "quote"];
    case "SENIOR_CARE":
    case "PET_CARE":
      return ["duration", "instructions", "slot", "quote"];
    case "CONCIERGE":
    case "VEHICLE":
      return ["task", "slot", "quote"];
    default:
      return ["options", "slot", "quote"];
  }
}

export function customerMaterialsCopy(policy: ServiceCatalogConfig["materialPolicy"] | undefined): string | null {
  switch (policy) {
    case "CUSTOMER_PROVIDED":
      return "You provide the materials listed for this service.";
    case "PROFESSIONAL_PROVIDED":
      return "The professional brings the materials.";
    case "PACKAGE_INCLUDED":
      return "Materials are included in this package.";
    case "MIXED":
      return "Some materials are yours; the rest are brought by the professional.";
    case "NOT_REQUIRED":
      return null;
    default:
      return null;
  }
}

export function partnerMaterialsCopy(policy: ServiceCatalogConfig["materialPolicy"] | undefined): string | null {
  switch (policy) {
    case "CUSTOMER_PROVIDED":
      return "Customer provides materials. Do not assume stock is on site.";
    case "PROFESSIONAL_PROVIDED":
      return "Bring the materials listed for this job.";
    case "PACKAGE_INCLUDED":
      return "Materials are included in the package — bring the standard kit.";
    case "MIXED":
      return "Split responsibility: check the job notes before you leave.";
    case "NOT_REQUIRED":
      return null;
    default:
      return null;
  }
}

export function customerEquipmentCopy(policy: ServiceCatalogConfig["equipmentPolicy"] | undefined): string | null {
  switch (policy) {
    case "CUSTOMER_PROVIDED":
      return "Please have the listed equipment available at the address.";
    case "PROFESSIONAL_PROVIDED":
      return "The professional brings the equipment.";
    case "PACKAGE_INCLUDED":
      return "Equipment is included in this package.";
    case "MIXED":
      return "Some equipment is yours; the rest is brought by the professional.";
    case "NOT_REQUIRED":
      return null;
    default:
      return null;
  }
}

export function partnerEquipmentCopy(policy: ServiceCatalogConfig["equipmentPolicy"] | undefined): string | null {
  switch (policy) {
    case "CUSTOMER_PROVIDED":
      return "Customer provides equipment. Confirm it is on site before you start.";
    case "PROFESSIONAL_PROVIDED":
      return "Bring the equipment listed for this job.";
    case "PACKAGE_INCLUDED":
      return "Equipment is included — bring the standard kit.";
    case "MIXED":
      return "Split equipment responsibility: check the job notes.";
    case "NOT_REQUIRED":
      return null;
    default:
      return null;
  }
}

export function partnerExecutionFromSnapshot(snap: unknown): {
  materials: string | null;
  equipment: string | null;
  quality: QualitySnapshot | null;
  durationMinutes: number | null;
} {
  const rec = snap && typeof snap === "object" && !Array.isArray(snap) ? (snap as Record<string, unknown>) : null;
  const materials = rec?.materialPolicy as ServiceCatalogConfig["materialPolicy"] | undefined;
  const equipment = rec?.equipmentPolicy as ServiceCatalogConfig["equipmentPolicy"] | undefined;
  const duration = rec?.durationMinutes;
  return {
    materials: partnerMaterialsCopy(materials),
    equipment: partnerEquipmentCopy(equipment),
    quality: qualityFromSnapshot(snap),
    durationMinutes: typeof duration === "number" ? duration : null,
  };
}
