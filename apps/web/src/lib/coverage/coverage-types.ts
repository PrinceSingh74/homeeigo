/**
 * Hyperlocal Coverage Engine V1 — client-side response shapes.
 * Mirrors apps/backend/src/data/hyperlocal-coverage.ts. Keep in sync.
 */

export type CoverageStatus = "AVAILABLE" | "LIMITED" | "COMING_SOON";
export type DensityLevel = "HIGH" | "MEDIUM" | "LOW";
export type ServiceDayAvailability = "TODAY" | "TOMORROW" | "UNAVAILABLE";

export type CityCoverageSummary = {
  slug: string;
  name: string;
  state: string;
  tier: number;
  status: CoverageStatus;
  areaCount: number;
  pincodeCount: number;
  societyCount: number;
  /** All null = UNMEASURED. The backend publishes a measured value or nothing — never a seed. */
  activePartners: number | null;
  customers: number | null;
  servicesCompleted: number | null;
  /** null = UNMEASURED — the backend has no agreed definition for this metric. */
  fulfillmentRate: number | null;
  coverageScore: number;
};

export type AreaCoverage = {
  id: string;
  name: string;
  status: CoverageStatus;
  pincodes: string[];
  societyCount: number;
  /** All null = UNMEASURED. No provider is attributed below city level. */
  activePartners: number | null;
  density: DensityLevel | null;
  avgArrivalMins: number | null;
};

export type PincodeCoverage = {
  pincode: string;
  areaName: string;
  status: CoverageStatus;
  /** null = UNMEASURED. */
  partnerCount: number | null;
};

export type SocietyCoverage = {
  id: string;
  name: string;
  areaName: string;
  status: CoverageStatus;
  /** All null = UNMEASURED. `rating` was a seeded 4.3-4.95 star figure; real ratings are per provider. */
  partnerCount: number | null;
  avgResponseMins: number | null;
  rating: number | null;
  availableServices: string[];
};

export type ServiceAvailability = {
  name: string;
  slug: string;
  availability: ServiceDayAvailability;
};

export type ResponseEngine = {
  avgArrivalMins: number | null;
  /** null = UNMEASURED. The backend sends null when a city has no terminal dispatch outcome. */
  acceptanceRate: number | null;
  completionRate: number | null;
  cancellationRate: number | null;
};

export type CityCoverageDetail = {
  summary: CityCoverageSummary;
  areas: AreaCoverage[];
  pincodes: PincodeCoverage[];
  societies: SocietyCoverage[];
  services: ServiceAvailability[];
  responseEngine: ResponseEngine;
  generatedAt: string;
};

export type CoverageSearchResult = {
  type: "CITY" | "AREA" | "PINCODE" | "SOCIETY";
  covered: boolean;
  status: CoverageStatus;
  citySlug: string;
  cityName: string;
  label: string;
  sublabel: string;
  /** null = UNMEASURED. */
  partnersNearby: number | null;
  /** null = UNMEASURED. Measured from real bookings, so it can be absent. */
  expectedArrivalMins: number | null;
  availableToday: boolean;
};

export type CoverageRequestPayload = {
  name: string;
  mobile: string;
  city?: string;
  area: string;
  society?: string;
  pincode?: string;
  source?: string;
};

export const COVERAGE_STATUS_LABEL: Record<CoverageStatus, string> = {
  AVAILABLE: "Available",
  LIMITED: "Limited Availability",
  COMING_SOON: "Coming Soon",
};

export const DENSITY_LABEL: Record<DensityLevel, string> = {
  HIGH: "High Availability",
  MEDIUM: "Medium Availability",
  LOW: "Low Availability",
};
