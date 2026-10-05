import { apiRequest, apiRequestBlob, apiRequestText } from "@/lib/api-client";
import type {
  SupportIntelligence,
  SupportRecommendationRow,
  ExecutiveBrief,
  ExecutiveBriefPeriod,
  ReportScheduleStatus,
  AdminBooking,
  AdminCustomer,
  AdminListBookingsResponse,
  AdminListCustomersResponse,
  AdminListProvidersResponse,
  AdminProvider,
  AnalyticsData,
  ApiResponse,
  BanAction,
  DashboardData,
  VerifyAction,
} from "@/types/admin";

type ListQuery = {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  kyc?: string;
  sort?: string;
  payment?: string;
  category?: string;
  interval?: string;
  planId?: string;
};

export type AutomationRegisteredWorkflow = {
  workflowId: string;
  version: number;
  name: string;
  trigger: string;
  executionMode: string;
  certificationStatus: string;
  riskClass: string | null;
  stepCount: number;
  /** Steps the engine refuses rather than runs — ACTION and ESCALATION are not implemented. */
  unexecutableSteps: Array<{ stepId: string; type: string }>;
  metadata: Record<string, unknown>;
};

export type AutomationOverview = {
  workflows: {
    registered: AutomationRegisteredWorkflow[];
    persisted: Array<Record<string, unknown>>;
  };
  triggers: Array<{ eventType: string; workflowId: string; subjectType: string }>;
  triggeredEventTypes: string[];
  conditions: string[];
  canonicalEvents: Array<{
    canonical: string;
    runtimeType: string;
    domain: string;
    producer?: string;
    producerStatus?: "ACTIVE" | "POLICY_PENDING";
    notes?: string;
  }>;
  quarantined: Array<Record<string, unknown>>;
  metrics: Record<string, unknown>;
};

export type AutomationInstance = {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: string;
  executionMode: string;
  subjectType: string;
  subjectId: string;
  stepIndex: number;
  createdAt: string;
};

/**
 * An instance the engine says cannot make progress. Mirrors `StuckInstance` in
 * `workflow-recovery.service.ts`.
 *
 * `evidence` and `actionable` are the two fields that matter to an operator and are shown verbatim:
 * the backend states WHY it calls an instance stuck rather than asking anyone to trust the label,
 * and it marks STALE_LEASE as not actionable because the executor reclaims expired leases itself —
 * an operator "fixing" one would only race the engine.
 */
export type StuckWorkflowInstance = {
  instanceId: string;
  workflowId: string;
  workflowVersion: number;
  executionMode: string;
  status: string;
  reason: "STALE_LEASE" | "LOST_WAKEUP" | "EXPIRED_UNTERMINATED";
  evidence: string;
  stepIndex: number;
  stepCount: number;
  ageMs: number;
  actionable: boolean;
  recommendedAction: "REQUEUE" | "CANCEL" | "NONE";
  updatedAt?: string;
};

export type AutomationDeadLetter = {
  id: string;
  eventId: string;
  eventType: string;
  consumerName: string;
  errorMessage: string | null;
  attempts: number;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
};

export type AutomationOutboxRow = {
  id: string;
  eventId: string;
  eventType: string;
  status: string;
  attempts: number;
  createdAt: string;
  lastError: string | null;
};

// --- Geo-Intelligence envelope + data shapes (mirrors GeoIntelligenceService) ---
export type GeoIntel<T> = { success: boolean; data: T; confidence: number; freshness: string; source: string; cached: boolean; generatedAt: string };
export type ExecKpis = { gmv: number; bookingsToday: number; completionRate: number; cancellationRate: number; refundRate: number; onlineProviders: number; activeCustomers: number };
export type SurgeZone = { zoneId: string; name: string; city: string | null; supply: number; activeBookings: number; weatherSurge: number; predictedSurge: number; demandDeltaPct: number | null };
export type DensityZone = { zoneId: string; name: string; city: string | null; centerLat: number; centerLng: number; providers: number; areaKm2: number; densityPerKm2: number };
export type PendingPartnerDocument = {
  id: string;
  providerId: string;
  documentType: string;
  documentName: string | null;
  documentUrl: string;
  documentNumber: string;
  uploadStatus: string;
  uploadedAt: string;
  expiryDate: string | null;
  verificationNotes: string | null;
  fileSize?: number | null;
  fileFormat?: string | null;
  provider: {
    id: string;
    businessName: string | null;
    city?: string | null;
    isApproved?: boolean;
    registrationStatus?: string | null;
    user: { firstName: string | null; lastName: string | null; email: string | null };
  };
};
export type AcademyModule = {
  id: string;
  slug: string;
  title: string;
  contentType: string;
  contentUrl: string | null;
  body: string | null;
  sortOrder: number;
  isPublished: boolean;
  categoryIds: string[];
  createdAt: string;
  updatedAt: string;
  stats: { started: number; completed: number; avgScore: number | null };
  recentCompletions: Array<{
    providerId: string;
    name: string;
    city: string | null;
    completedAt: string;
    score: number | null;
  }>;
};
export type AcademyCatalog = {
  modules: AcademyModule[];
  summary: {
    total: number;
    published: number;
    drafts: number;
    completions: number;
    learners: number;
    avgScore: number | null;
    certifiedPartners: number;
    catalogCategories: string[];
  };
};
export type AcademyModuleInput = {
  slug: string;
  title: string;
  contentType: string;
  contentUrl?: string;
  contentBody?: string;
  sortOrder?: number;
  isPublished?: boolean;
  categoryIds?: string[];
};
export type AcademyModulePatch = {
  title?: string;
  contentType?: string;
  contentUrl?: string | null;
  contentBody?: string | null;
  sortOrder?: number;
  isPublished?: boolean;
  categoryIds?: string[];
};
export type ZoneScore = {
  zoneId: string;
  name: string;
  city: string | null;
  supply: number;
  demand24h: number;
  revenue24h: number;
  earningScore: number;
  demandScore: number;
  serviceHealth: number;
  riskScore: number;
  compositeScore: number;
  opportunityScore?: number;
  gap?: number;
  interpretation?: string;
  recommendation?: string | null;
};
export type ZoneScoring = { ranked: ZoneScore[]; bestEarning: ZoneScore[]; worstService: ZoneScore[]; highRisk: ZoneScore[] };
export type FraudEvent = { provider_hash: string; booking_id: string | null; implied_kmh: number; jump_meters: number; lat: number; lng: number; ts: string };
export type FraudData = { suspiciousCount: number; riskScore: number; events: FraudEvent[] };
/** X-86: the GPS fraud-signal warehouse did not answer — a state carrying no count and no score. */
export type GeoFraudUnavailable = {
  success: true;
  available: false;
  reasonCode: "FRAUD_SIGNALS_SOURCE_UNAVAILABLE";
  cause: string;
  reason: string;
  data: null;
  confidence: null;
  freshness: null;
  source: "unavailable";
  cached: false;
  generatedAt: string;
};
export type GeoFraudResponse = (GeoIntel<FraudData> & { available?: true }) | GeoFraudUnavailable;
/** X-88: any warehouse read that did not answer — a state carrying no figures. */
export type WarehouseUnavailable<R extends string = string> = {
  available: false;
  reasonCode: R;
  cause: string;
  reason: string;
  data: null;
};
export type MlopsHealth = { total: number; trained: number; partial: number; blocked: number; productionModels: number; freshness: string };
export type MlopsHealthResponse =
  | { success: boolean; available?: true; data: MlopsHealth }
  | ({ success: boolean } & WarehouseUnavailable<"ML_REGISTRY_SOURCE_UNAVAILABLE">);
export type PipelineHealth = {
  freshness: number;
  totalDatasets: number;
  /** Null when no data-quality rule could be evaluated (X-90) — not 0%. */
  qualityScore: number | null;
  qualityUnavailable?: boolean;
  mlops: (Record<string, unknown> & { available?: true }) | WarehouseUnavailable<"ML_REGISTRY_SOURCE_UNAVAILABLE">;
};
export type RevenueForecast = { realized24h: number; realized7d: number; forecastHourly: number; forecastDaily: number; forecastWeekly: number; forecastMonthly: number; completedLast24h: number };
export type DemandPoint = { zone_id: string; hour: string; predicted: number; lo: number; hi: number };
/**
 * `stale` and `forecastWindow` come from the API and must be honoured before charting.
 *
 * ML.FORECAST projects from the end of the model's training data, so a warehouse forecast can
 * describe hours that are months old. Charts here carry no dates, so an unchecked render shows a
 * past window as the coming day.
 */
/** X-84: the forecast source did not answer — a state carrying no forecast numbers. */
export type DemandForecastUnavailable = {
  success: true;
  available: false;
  reasonCode: "FORECAST_SOURCE_UNAVAILABLE";
  cause: string;
  reason: string;
  data: null;
  confidence: null;
  freshness: null;
  source: "unavailable";
  cached: false;
  generatedAt: string;
};
export type DemandForecastResponse = (GeoIntel<DemandForecast> & { available?: true }) | DemandForecastUnavailable;
export type DemandForecast = {
  horizonHours: number;
  points: DemandPoint[];
  totalPredicted: number;
  stale?: boolean;
  forecastWindow?: { from: string | null; to: string | null };
  expiredByHours?: number | null;
  limitations?: string[];
};

// --- City Digital Twin ---
export type TwinEnvelope<T> = { success: boolean; data: T; confidence: number; freshness: string; source: string; generatedAt: string };
export type TwinLayers = {
  /**
   * Forecast figures are nullable: the backend withholds them when the warehouse forecast window
   * has already passed, rather than sending 0. A 0 would read as "no demand expected", which is a
   * prediction nobody made. `forecastUnavailableReason` says why they are absent.
   */
  demand: {
    current: number;
    forecast1h: number | null;
    forecast6h: number | null;
    forecast24h: number | null;
    forecastUnavailableReason?: string | null;
  };
  supply: { online: number; busy: number; available: number; density: number; shortageRisk: number };
  traffic: { congestionIndex: number; level: string };
  weather: { condition: string; description: string; severity: string; rain1hMm: number; weatherImpactScore: number; floodRisk: string; aqi: number | null } | null;
  revenue: { current24h: number; projectedDaily: number; projectedMonthly: number };
  eta: { inflationPct: number; slowZones: string[] };
  pricing: { currentSurge: number; predictedSurge: number; confidence: number };
  fraud: { events: number; pins: Array<{ lat: number; lng: number; implied_kmh: number }>; riskScore: number };
};
export type CityTwin = { city: string; zones: number; layers: TwinLayers };
export type TwinInsight = { text: string; confidence: number; severity: "info" | "warning" | "critical" };
export type TwinScenario = { demandDeltaPct?: number; providerDeltaPct?: number; trafficDeltaPct?: number; rainStart?: boolean; festival?: boolean };
export type TwinSimulation = {
  city: string; scenario: TwinScenario;
  baseline: { demand: number; supply: number; surge: number; revenue24h: number };
  projected: { demand: number; supply: number; available: number; surge: number };
  impact: { revenuePct: number; etaPct: number; supplyGapPct: number; customerPct: number; surgeShift: number };
};
export type CitySummary = { city: string; tier: number; demand: number; providers: number; surge: number };

/** Full partner command-center payload (GET /api/admin/providers/:id). */
export type ProviderDetail = {
  id: string;
  userId: string;
  profile: {
    name: string; email: string | null; phone: string | null;
    businessName: string | null; bio: string | null; profileImage: string | null;
    serviceCategories: string[]; serviceRegions: string[]; city: string | null;
    experienceYears: number | null; certifications: string[]; badges: string[];
    registeredAt: string; memberSince: string;
  };
  status: {
    isOnline: boolean; onlineSince: string | null; lastSeenAt: string | null;
    currentStatus: string | null; lifecycleState?: string; careerLevel?: string; isActive: boolean; isBanned: boolean; bannedReason: string | null;
    workingHours: { start: number; end: number; days: string[] } | null;
  };
  verification: {
    isApproved: boolean; isVerified: boolean; registrationStatus: string | null;
    verificationDate: string | null; verificationNotes: string | null; approvalNotes: string | null;
    rejectionReason: string | null; backgroundCheckStatus: string | null; backgroundCheckDate: string | null;
    kyc: Record<string, string | null>;
    documents: Array<{ id: string; type: string; name: string | null; isVerified: boolean; uploadStatus: string | null; expiryDate: string | null; verifiedAt: string | null }>;
  };
  metrics: {
    rating: number; totalReviews: number; ratingBreakdown: unknown;
    totalBookings: number; completedBookings: number; cancelledBookings: number; rejectedBookings: number;
    completionRate: number; acceptanceRate: number; responseRate: number; cancellationRate: number;
    onTimeRate: number; avgResponseTime: number | null; avgCompletionTime: number | null;
  };
  earnings: {
    totalEarnings: number; thisMonthEarnings: number; thisWeekEarnings: number;
    walletBalance: number; commissionRate: number | null;
    pendingPayoutAmount: number; pendingPayoutCount: number;
    bank: { holder: string | null; bankName: string | null; accountNumberMasked: string | null; ifsc: string | null; upiId: string | null; preference: string | null };
  };
  location: { latitude: number; longitude: number; updatedAt: string | null } | null;
  recentBookings: Array<{ id: string; bookingNumber: string | null; status: string; serviceName: string | null; amount: number | null; scheduledDate: string | null; completedAt: string | null; createdAt: string }>;
  dispatchHistory: Array<{ id: string; status: string; dispatchedAt: string | null; respondedAt: string | null; responseMs: number | null; bookingNumber: string | null; serviceName: string | null }>;
};

// --- Hyperlocal Coverage Engine V1 (consumes /api/coverage/*) ---
export type CoverageRequestStatus = "NEW" | "REVIEWING" | "PLANNED" | "LAUNCHED" | "DECLINED";
export type CoverageRequestRow = {
  id: string;
  name: string;
  mobile: string;
  city: string | null;
  area: string;
  society: string | null;
  pincode: string | null;
  source: string;
  status: CoverageRequestStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};
export type CityStatus = "AVAILABLE" | "LIMITED" | "COMING_SOON";
export type ManagedCityRow = {
  slug: string;
  name: string;
  state: string;
  tier: number;
  status: CityStatus;
  areaCount: number;
  pincodeCount: number;
  societyCount: number;
  /**
   * null = UNMEASURED, and the backend means it.
   *
   * `deriveCitySummary` publishes these straight from the aggregate query and returns null when
   * there is nothing authoritative to publish; `coverage.service` also falls back to an EMPTY live
   * map if the aggregate read fails, so every one of these can arrive null on a healthy deploy.
   * This block previously declared them non-null, which is why `tsc` was clean while the page threw
   * "Cannot read properties of null (reading 'toFixed')" in the browser.
   */
  activePartners: number | null;
  customers: number | null;
  servicesCompleted: number | null;
  /** Always null today — see OWNER DECISION #9, this metric has no agreed definition. */
  fulfillmentRate: number | null;
  coverageScore: number;
  /** Non-null when an admin has manually pinned this city's status. */
  managedStatus: CityStatus | null;
  note: string | null;
};
export type CoverageCityRow = {
  slug: string;
  name: string;
  state: string;
  tier: number;
  status: "AVAILABLE" | "LIMITED" | "COMING_SOON";
  areaCount: number;
  pincodeCount: number;
  societyCount: number;
  /**
   * null = UNMEASURED, and the backend means it.
   *
   * `deriveCitySummary` publishes these straight from the aggregate query and returns null when
   * there is nothing authoritative to publish; `coverage.service` also falls back to an EMPTY live
   * map if the aggregate read fails, so every one of these can arrive null on a healthy deploy.
   * This block previously declared them non-null, which is why `tsc` was clean while the page threw
   * "Cannot read properties of null (reading 'toFixed')" in the browser.
   */
  activePartners: number | null;
  customers: number | null;
  servicesCompleted: number | null;
  /** Always null today — see OWNER DECISION #9, this metric has no agreed definition. */
  fulfillmentRate: number | null;
  coverageScore: number;
  liveAreas: number;
  limitedAreas: number;
  comingSoonAreas: number;
  pendingRequests: number;
};
export type CoverageIntelligence = {
  totals: {
    cities: number;
    liveCities: number;
    areas: number;
    liveAreas: number;
    pincodes: number;
    societies: number;
    coveragePct: number;
    activePartners: number;
    avgCoverageScore: number;
  };
  cities: CoverageCityRow[];
  requests: { total: number; new: number; reviewing: number; planned: number; last30Days: number };
  demandHotspots: Array<{ label: string; requests: number; city: string | null }>;
  expansionOpportunities: Array<{
    citySlug: string;
    cityName: string;
    areaName: string;
    status: string;
    societies: number;
    demandSignals: number;
    priorityIndex: number;
  }>;
  generatedAt: string;
};

export type AdminNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
};

export type AdminReview = {
  id: string;
  customer: string;
  customerEmail: string;
  provider: string;
  service: string;
  bookingNumber: string;
  rating: number;
  reviewText: string | null;
  providerResponse: string | null;
  isPublic: boolean;
  isFlagged: boolean;
  createdAt: string;
};

export type AdminReviewsResponse = {
  reviews: AdminReview[];
  total: number;
  page: number;
  limit: number;
  stats: { averageRating: number | null; totalReviews: number };
};

export type PartnerServiceSkillCard = {
  serviceId: string;
  name: string;
  slug: string;
  category: string;
  lane: "performing" | "pending" | "suspended" | "revoked" | "available";
  capabilityId: number | null;
  source: string | null;
  requestedAt: string | null;
  requestNote: string | null;
  /**
   * Whether this partner would pass the service's credential gates right now — the check matching
   * applies. Only on the `performing` lane; absent on an older backend (then nothing is claimed).
   * `code` is a matching rejection reason; wording lives in lib/matching-reasons.ts.
   */
  readiness?: { ready: boolean; missing: Array<{ code: string; detail: string; title?: string }> };
};

export type PartnerServiceSkillBoard = {
  approvalWorkflow: boolean;
  performing: PartnerServiceSkillCard[];
  pending: PartnerServiceSkillCard[];
  suspended: PartnerServiceSkillCard[];
  revoked: PartnerServiceSkillCard[];
  available: PartnerServiceSkillCard[];
};

export type PendingServiceSkillRequest = {
  capabilityId: number;
  providerId: string;
  partnerName: string;
  city: string | null;
  serviceId: string;
  serviceName: string;
  serviceSlug: string;
  category: string;
  requestedAt: string;
  requestNote: string | null;
};

/* ── Phase 10 §10 — quality verdicts + completion (admin view) ─────────────────────────────── */

/** Mirror of the backend VerdictRecord (booking-quality.service), dates as ISO strings. */
export type AdminQualityVerdict = {
  id: number;
  sequence: number;
  verdict: "PASS" | "PASS_WITH_EXCEPTION" | "REWORK_REQUIRED" | "FAILED" | "ESCALATED";
  reasonCodes: string[];
  evidence: unknown;
  actorType: string;
  actorId: string | null;
  reason: string | null;
  policyVersion: string;
  serviceConfigVersion: number | null;
  bookingStatus: string;
  supersedesId: number | null;
  requestId: string | null;
  traceId: string | null;
  createdAt: string;
};

/** Mirror of QUALITY_VERDICTS (backend lib/quality-verdict.ts) — the values an override may set. */
export const ADMIN_QUALITY_VERDICTS = ["PASS", "PASS_WITH_EXCEPTION", "REWORK_REQUIRED", "FAILED", "ESCALATED"] as const;

export type AdminBookingCompletion = {
  state: "PENDING_CUSTOMER" | "CONFIRMED" | "AUTO_CONFIRMED" | "ISSUE_REPORTED";
  verdictId: number | null;
  requestedAt: string;
  confirmBy: string;
  resolvedAt: string | null;
  resolvedByType: string | null;
  resolvedById: string | null;
  caseId: string | null;
  version: number;
};

/** The quality rules a booking froze (backend QualitySnapshot, lib/service-runtime-policy.ts). */
export type AdminFrozenQualityPolicy = {
  proofRequired?: boolean;
  beforeAfterPhotos?: boolean;
  checklist?: string[];
  notApplicable?: boolean;
  warrantyDays?: number;
  /** Stored only — the customer is always asked to confirm; never shown as a rule. */
  customerConfirmation?: boolean;
  confirmationWindowHours?: number;
  completionCriteria?: string[];
  professionalConfirmation?: boolean;
};

/** The cover a booking froze (backend WarrantySnapshot, lib/service-warranty.ts). */
export type AdminFrozenWarrantyPolicy = {
  enabled?: boolean;
  durationDays?: number;
  startEvent?: string;
  eligibleIssueTypes?: string[];
  exclusions?: string[];
  proofRequired?: boolean;
  reworkFirst?: boolean;
  refundAllowed?: boolean;
  complaintWindowDays?: number;
  damagePolicy?: string | null;
  guarantee?: string | null;
};

export type AdminQualityView = {
  /** The rules THIS booking froze, at any status. Absent on an older backend. */
  policy?: { quality: AdminFrozenQualityPolicy | null; warranty: AdminFrozenWarrantyPolicy | null };
  enforced: boolean;
  latest: AdminQualityVerdict | null;
  history: AdminQualityVerdict[];
  completion: AdminBookingCompletion | null;
  audit: Array<{
    id: number;
    action: string;
    from_state: string | null;
    to_state: string;
    verdict_id: number | null;
    case_id: string | null;
    actor_type: string | null;
    actor_id: string | null;
    reason: string | null;
    request_id: string | null;
    trace_id: string | null;
    changed_at: string;
  }>;
  warranty: { state: string; policy: unknown; startsAt: string; expiresAt: string; voidReason: string | null } | null;
};

/* ── Phase 11 — matching diagnostics (read-only; nothing is dispatched) ────────────────────── */

export type AdminMatchingDiagnostics = {
  bookingId: string;
  bookingStatus: string;
  jobLocated: boolean;
  matches: Array<{
    providerId: string;
    totalScore: number;
    distance: number | null;
    scoreBreakdown: Record<string, number>;
    unknownSignals: string[];
  }>;
  rejections: Array<{ providerId: string; reasons: string[]; details: Array<Record<string, unknown>> }>;
  /** Providers carrying each reason (a provider counts once per reason it carries). */
  counts: Record<string, number>;
  latencyMs: number;
  candidateCount: number;
  serviceCapabilityMode: string;
};

/* ── Phase 10 §11 — complaint / warranty-claim cases ───────────────────────────────────────── */

/** Mirrors of backend lib/booking-case-policy.ts — kept in sync by hand (frontend mirrors, never imports). */
export const ADMIN_CASE_STATES = ["CASE_CREATED", "TRIAGE", "ELIGIBILITY", "INVESTIGATION", "ACTION", "RESOLVED", "REJECTED", "ESCALATED"] as const;
export const ADMIN_CASE_TYPES = ["COMPLAINT", "WARRANTY_CLAIM", "REWORK"] as const;
export const ADMIN_RESOLVE_ACTIONS = ["REWORK", "REFUND", "INSPECTION", "REJECT", "NONE"] as const;
export type AdminResolveAction = (typeof ADMIN_RESOLVE_ACTIONS)[number];
/** Admin transitions between OPEN states; RESOLVED/REJECTED are reached only through resolve. */
export const ADMIN_CASE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  CASE_CREATED: ["TRIAGE", "ESCALATED"],
  TRIAGE: ["ELIGIBILITY", "INVESTIGATION", "ESCALATED"],
  ELIGIBILITY: ["INVESTIGATION", "ACTION", "ESCALATED"],
  INVESTIGATION: ["ELIGIBILITY", "ACTION", "ESCALATED"],
  ACTION: ["INVESTIGATION", "ESCALATED"],
  ESCALATED: ["TRIAGE", "ELIGIBILITY", "INVESTIGATION", "ACTION"],
  RESOLVED: [],
  REJECTED: [],
};

export type AdminCaseSummary = {
  id: string;
  caseNumber: string;
  bookingId: string;
  customerId: string;
  providerId: string | null;
  type: string;
  category: string;
  state: string;
  version: number;
  ownerAdminId: string | null;
  slaDueAt: string | null;
  slaBreached: boolean;
  createdAt: string;
  closedAt: string | null;
  resolution: Record<string, unknown> | null;
};

export type AdminCaseEligibility = {
  complaintWindowOpen: boolean;
  warrantyCovers: boolean;
  reasonCodes: string[];
  allowedActions: Array<"REWORK" | "REFUND" | "INSPECTION" | "REJECT">;
  proofRequired: boolean;
  proofMissing: boolean;
};

export type AdminCaseDetail = {
  /** The raw booking_cases row (snake_case), dates as ISO strings. */
  case: {
    id: string;
    case_number: string;
    booking_id: string;
    customer_id: string;
    provider_id: string | null;
    type: string;
    category: string;
    state: string;
    description: string | null;
    eligibility: Record<string, unknown> | null;
    resolution: Record<string, unknown> | null;
    warranty_snapshot: Record<string, unknown> | null;
    service_config_version: number | null;
    sla_due_at: string | null;
    owner_admin_id: string | null;
    version: number;
    created_at: string;
    updated_at: string;
    closed_at: string | null;
  };
  eligibilityNow: AdminCaseEligibility;
  booking: {
    id: string;
    bookingNumber: string;
    status: string;
    completedAt: string | null;
    totalAmount: number;
    providerId: string | null;
    serviceId: string;
  } | null;
  warranty: { state: string; startsAt: string; expiresAt: string } | null;
  followUps: Array<{ id: string; booking_number: string; booking_kind: string; status: string; scheduled_date: string; provider_id: string | null }>;
  refunds: Array<{ id: string; amount: number; status: string; idempotency_key: string; created_at: string }>;
  events: Array<{
    id: number;
    action: string;
    from_state: string | null;
    to_state: string;
    actor_type: string | null;
    actor_id: string | null;
    reason: string | null;
    details: Record<string, unknown> | null;
    request_id: string | null;
    trace_id: string | null;
    created_at: string;
  }>;
  evidence: Array<{
    id: number;
    kind: string;
    jobEvidenceId: string | null;
    mediaStorageKey: string | null;
    mediaUrl: string | null;
    /**
     * A photo stored by the platform for this item — fetched with `cases.evidenceMedia`, never a plain
     * <img src> (the route is private). Absent on an older backend. True does not promise bytes: the
     * media route answers 404 for a key the case service did not store itself.
     */
    hasStoredMedia?: boolean;
    note: string | null;
    actorType?: string | null;
    actorId?: string | null;
    createdAt: string;
  }>;
};

/* ── Phase 11 — provider capability profile (admin review) ─────────────────────────────────── */

export const ADMIN_CAPABILITY_KINDS = ["skills", "certifications", "equipment", "insurance", "languages"] as const;
export type AdminCapabilityKind = (typeof ADMIN_CAPABILITY_KINDS)[number];

/** Rows are camelCased DB rows plus computed `validity` and `nearExpiry`; columns vary by kind. */
export type AdminCapabilityRow = Record<string, unknown> & { id: number; status?: string; validity: string; nearExpiry?: boolean };

export type AdminCapabilityProfile = {
  providerId: string;
  dataOrigin: string | null;
  generatedAt: string;
  skills: AdminCapabilityRow[];
  certifications: AdminCapabilityRow[];
  equipment: AdminCapabilityRow[];
  insurance: AdminCapabilityRow[];
  languages: AdminCapabilityRow[];
  services: AdminCapabilityRow[];
  memberships: Array<Record<string, unknown> & { validity: string }>;
  summary: { nearExpiry: number; expired: number; pendingReview: number };
  audit: Array<Record<string, unknown>>;
};

export const adminApi = {
  dashboard: () =>
    apiRequest<ApiResponse<DashboardData>>("/api/admin/dashboard", {
      auth: true,
    }).then((r) => r.data!),

  commandCenterOverview: () =>
    apiRequest<ApiResponse<CommandCenterOverview>>("/api/admin/command-center/overview", {
      auth: true,
    }).then((r) => r.data!),

  auditLogs: (query: AuditLogQuery = {}) =>
    apiRequest<ApiResponse<AuditLogResult>>("/api/admin/audit", {
      auth: true,
      query: { ...query },
    }).then((r) => r.data!),

  // --- Reviews moderation ---
  reviews: {
    list: (query: Record<string, string | number> = {}) =>
      apiRequest<ApiResponse<AdminReviewsResponse>>("/api/admin/reviews", {
        auth: true,
        query,
      }).then((r) => r.data!),
    moderate: (id: string, patch: { isPublic?: boolean; isFlagged?: boolean }) =>
      apiRequest<ApiResponse<{ review: { id: string; isPublic: boolean; isFlagged: boolean } }>>(
        `/api/admin/reviews/${id}`,
        { method: "PATCH", auth: true, body: patch },
      ),
    remove: (id: string) =>
      apiRequest<ApiResponse<{ id: string }>>(`/api/admin/reviews/${id}`, {
        method: "DELETE",
        auth: true,
      }),
  },

  // --- Admin's own notification feed (same per-user pipeline as customers) ---
  notifications: {
    list: (limit = 8) =>
      apiRequest<ApiResponse<{ notifications: AdminNotification[]; total: number; unreadCount: number }>>(
        "/api/notifications",
        { auth: true, query: { limit } },
      ).then((r) => r.data!),
    markAllRead: () =>
      apiRequest<ApiResponse<{ count: number }>>("/api/notifications/read-all", {
        method: "PUT",
        auth: true,
      }),
  },

  // --- Geo / Weather intelligence ---
  weatherOverview: () =>
    apiRequest<ApiResponse<WeatherOverview>>("/api/weather/admin/overview", { auth: true }).then((r) => r.data!),
  zoneAnalytics: () =>
    apiRequest<ApiResponse<ZoneAnalytics>>("/api/geo/geofences/analytics", { auth: true }).then((r) => r.data!),

  // --- Geo-Intelligence command layer (consumes /api/geo-intel/*) ---
  geoIntel: {
    execKpis: () => apiRequest<GeoIntel<ExecKpis>>("/api/geo-intel/exec-kpis", { auth: true }),
    surge: () => apiRequest<GeoIntel<SurgeZone[]>>("/api/geo-intel/surge", { auth: true }),
    density: () => apiRequest<GeoIntel<DensityZone[]>>("/api/geo-intel/provider-density", { auth: true }),
    zoneScoring: () => apiRequest<GeoIntel<ZoneScoring>>("/api/geo-intel/zone-scoring", { auth: true }),
    fraud: (limit = 50) => apiRequest<GeoFraudResponse>("/api/geo-intel/fraud", { auth: true, query: { limit } }),
    revenueForecast: () => apiRequest<GeoIntel<RevenueForecast>>("/api/geo-intel/revenue-forecast", { auth: true }),
    demandForecast: (horizon = 24) => apiRequest<DemandForecastResponse>("/api/geo-intel/demand-forecast", { auth: true, query: { horizon } }),
  },

  /** Server-side driving route (Google → OSRM). Avoids client Directions billing errors. */
  geoRoute: (from: { lat: number; lng: number }, to: { lat: number; lng: number }) =>
    apiRequest<
      ApiResponse<{
        polyline: string | null;
        distanceKm: number;
        durationMin: number;
        etaMinutes: number;
        source: string;
      }>
    >("/api/geo/route", {
      auth: true,
      query: { fromLat: from.lat, fromLng: from.lng, toLat: to.lat, toLng: to.lng },
    }).then((r) => r.data!),

  // --- Hyperlocal Coverage Intelligence (consumes /api/coverage/*) ---
  coverage: {
    intelligence: () =>
      apiRequest<ApiResponse<CoverageIntelligence>>("/api/coverage/intelligence", { auth: true }).then(
        (r) => r.data!,
      ),
    requests: (query: { status?: string; search?: string; page?: number; limit?: number } = {}) =>
      apiRequest<ApiResponse<{ requests: CoverageRequestRow[]; total: number; page: number; limit: number }>>(
        "/api/coverage/requests",
        { auth: true, query },
      ).then((r) => r.data!),
    updateRequest: (id: string, body: { status?: CoverageRequestStatus; notes?: string }) =>
      apiRequest<ApiResponse<{ request: CoverageRequestRow }>>(`/api/coverage/requests/${id}`, {
        method: "PATCH",
        auth: true,
        body,
      }).then((r) => r.data!),
    // Managed cities: live metrics + which have a manual status override.
    managedCities: () =>
      apiRequest<ApiResponse<{ cities: ManagedCityRow[]; total: number }>>("/api/coverage/admin/cities", {
        auth: true,
      }).then((r) => r.data!),
    // Set (status = one of the operational states) or clear (status = null) a city override.
    setCityStatus: (slug: string, body: { status: CityStatus | null; note?: string }) =>
      apiRequest<ApiResponse<{ city: ManagedCityRow }>>(`/api/coverage/cities/${slug}`, {
        method: "PATCH",
        auth: true,
        body,
      }).then((r) => r.data!),
  },

  // --- City Digital Twin (consumes /api/digital-twin/*) ---
  digitalTwin: {
    cities: () => apiRequest<TwinEnvelope<{ cities: CitySummary[] }> & { supported: { tier0: string[]; tier1: string[] } }>("/api/digital-twin/cities", { auth: true }),
    city: (name: string) => apiRequest<TwinEnvelope<CityTwin>>(`/api/digital-twin/${encodeURIComponent(name)}`, { auth: true }),
    insights: (name: string) => apiRequest<TwinEnvelope<{ city: string; insights: TwinInsight[] }>>(`/api/digital-twin/${encodeURIComponent(name)}/insights`, { auth: true }),
    simulate: (name: string, scenario: TwinScenario) => apiRequest<TwinEnvelope<TwinSimulation>>(`/api/digital-twin/${encodeURIComponent(name)}/simulate`, { auth: true, method: "POST", body: scenario }),
  },

  listUsers: (query: ListQuery = {}) =>
    apiRequest<ApiResponse<AdminListCustomersResponse>>("/api/admin/users", {
      auth: true,
      query: { ...query },
    }).then((r) => r.data!),

  listProviders: (query: ListQuery = {}) =>
    apiRequest<ApiResponse<AdminListProvidersResponse>>("/api/admin/providers", {
      auth: true,
      query: { ...query },
    }).then((r) => r.data!),

  getProviderDetail: (id: string) =>
    apiRequest<ApiResponse<ProviderDetail>>(`/api/admin/providers/${id}`, {
      auth: true,
    }).then((r) => r.data!),

  serviceSkills: {
    board: (providerId: string) =>
      apiRequest<ApiResponse<PartnerServiceSkillBoard>>(`/api/admin/providers/${providerId}/service-skills`, { auth: true }).then((r) => r.data!),
    queue: () =>
      apiRequest<ApiResponse<{ requests: PendingServiceSkillRequest[] }>>("/api/admin/service-skill-requests", { auth: true }).then((r) => r.data!),
    decide: (providerId: string, serviceId: string, action: "approve" | "suspend" | "revoke", reason?: string) =>
      apiRequest<ApiResponse<{ row: unknown }>>(`/api/admin/providers/${providerId}/services/${serviceId}/${action}`, {
        method: "POST",
        auth: true,
        body: reason ? { reason } : {},
      }).then((r) => r.data!),
  },

  getProviderScore: (id: string) =>
    apiRequest<ApiResponse<{
      overallScore: number | null;
      band: string;
      components: Record<string, { value: number | null; weight: number }>;
      calculatedAt: string;
      trends: Record<string, { delta: number | null; insufficient: boolean }>;
    }>>(`/api/admin/providers/${id}/score`, { auth: true }).then((r) => r.data!),

  getProviderCareer: (id: string) =>
    apiRequest<ApiResponse<{
      currentLevel: string;
      nextLevel: string | null;
      progressPct: number;
      benefitsActive: boolean;
      careerPriorityBoost: number;
      badges: Array<{ code: string; label: string }>;
    }>>(`/api/admin/providers/${id}/career`, { auth: true }).then((r) => r.data!),

  getProviderLifecycle: (id: string) =>
    apiRequest<ApiResponse<{
      lifecycleState: string;
      allowedTransitions: string[];
      dispatchEligible: boolean;
      history: Array<{
        id: string;
        previousState: string | null;
        newState: string;
        actorType: string;
        reasonCode: string;
        reasonText: string | null;
        createdAt: string;
      }>;
    }>>(`/api/admin/providers/${id}/lifecycle`, { auth: true }).then((r) => r.data!),

  transitionProviderLifecycle: (id: string, action: "approve" | "pause" | "review" | "suspend" | "reactivate", reason?: string) =>
    apiRequest<ApiResponse<unknown>>(`/api/admin/providers/${id}/lifecycle`, {
      auth: true,
      method: "POST",
      body: { action, reason },
    }),

  getProviderIntelligence: (id: string) =>
    apiRequest<
      ApiResponse<{
        periodDays: number;
        uniqueCustomers: number;
        returningCustomers: number;
        repeatCustomerRatePct: number;
      }>
    >(`/api/admin/providers/${id}/intelligence`, { auth: true }).then((r) => r.data!),

  listBookings: (query: ListQuery = {}) =>
    apiRequest<ApiResponse<AdminListBookingsResponse>>("/api/admin/bookings", {
      auth: true,
      query: { ...query },
    }).then((r) => r.data!),

  getBookingDetail: (id: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/bookings/${id}`, {
      auth: true,
    }).then((r) => r.data!),

  /** Job evidence — ADMIN role is allowed on listForBooking. */
  getBookingEvidence: (id: string) =>
    apiRequest<
      ApiResponse<{
        evidence: Array<{
          id: string;
          stage: string;
          capturedAt: string;
          isCurrent: boolean;
          mediaUrl?: string | null;
          mediaAccessUrl?: string | null;
        }>;
      }>
    >(`/api/bookings/${id}/evidence`, { auth: true }).then((r) => r.data!),

  /** Phase 10 §6 — requirement operations view: items, state, START gate and append-only audit. */
  getBookingRequirements: (id: string) =>
    apiRequest<
      ApiResponse<{
        enforced: boolean;
        serviceVersion: number | null;
        items: Array<{
          code: string;
          label: string;
          kind: string;
          enforcementPoint: "BEFORE_BOOKING" | "BEFORE_ARRIVAL" | "AT_START";
          responsibility: string;
          verification: string;
          optional: boolean;
          state: "UNRESOLVED" | "SATISFIED" | "FAILED" | "EXPIRED";
          resolvedAt: string | null;
          resolvedByRole: string | null;
          note: string | null;
          actions: string[];
          blocking: { reason: string; remediation: { role: string; text: string } } | null;
        }>;
        gate: { arrival: { ok: boolean; blocking: Array<{ code: string; label: string; reason: string }> }; start: { ok: boolean; blocking: Array<{ code: string; label: string; reason: string }> } };
        audit?: Array<{
          id: number;
          code: string;
          action: string;
          fromState: string | null;
          toState: string;
          actorType: string | null;
          actorId: string | null;
          reason: string | null;
          requestId: string | null;
          traceId: string | null;
          evidenceKind: string | null;
          changedAt: string;
        }>;
      }>
    >(`/api/admin/bookings/${id}/requirements`, { auth: true }).then((r) => r.data!),

  /** Phase 10 §9 — safety operations view: frozen rules, holds, open incidents, hold audit. */
  getBookingSafety: (id: string) =>
    apiRequest<
      ApiResponse<{
        gate: { ok: boolean; message: string };
        holdsEnforced: boolean;
        /** The full frozen `safety.v1` snapshot. Fields added later are absent on older bookings. */
        safety: {
          prohibitedConditions: string[];
          warnings: string[];
          customerRequirements?: string[];
          providerRequirements: string[];
          information?: string | null;
          medicalDisclaimer: string | null;
          emergencyProtocol: string | null;
          ppe?: string[];
          chemicalRestrictions?: string[];
          incidentProtocol?: string | null;
        } | null;
        holds: Array<{ id: number; condition: string; source: string; state: string; incidentId: string | null; note: string | null; raisedByRole: string; raisedAt: string; releasedAt: string | null; releaseReason: string | null }>;
        incidents: Array<{ id: string; type: string; status: string }>;
        audit: Array<{ id: number; condition: string; action: string; from_state: string | null; to_state: string; actor_type: string | null; reason: string | null; request_id: string | null; trace_id: string | null; incident_id: string | null; changed_at: string }>;
      }>
    >(`/api/admin/bookings/${id}/safety`, { auth: true }).then((r) => r.data!),

  /** Safety operations clear a hold, with a reason (audited). The linked incident is resolved in the safety queue. */
  adminReleaseSafetyHold: (id: string, holdId: number, reason: string) =>
    apiRequest<ApiResponse<{ released: boolean; gate: { ok: boolean; message: string } }>>(`/api/admin/bookings/${id}/safety/holds/${holdId}/release`, { method: "POST", auth: true, body: { reason } }).then((r) => r.data!),

  /** X-55 — safety operations place a hold themselves (source ADMIN). The condition is shown to the professional and the customer; the reason stays internal. */
  adminPlaceSafetyHold: (id: string, condition: string, reason: string) =>
    apiRequest<ApiResponse<{ holdId: number | null; changed: boolean; gate: { ok: boolean; message: string } }>>(`/api/admin/bookings/${id}/safety/holds`, { method: "POST", auth: true, body: { condition, reason } }).then((r) => r.data!),

  /** Phase 10 §8 — execution operations view: steps, state, completion gate, step audit. */
  getBookingExecution: (id: string) =>
    apiRequest<
      ApiResponse<{
        enforced: boolean;
        serviceVersion: number | null;
        steps: Array<{
          code: string;
          stepNumber: number;
          title: string;
          kind: string;
          mandatory: boolean;
          evidence: string;
          state: string;
          finishedAt: string | null;
          note: string | null;
          reason: string | null;
          actions: string[];
          /** The step as frozen with the booking. Absent on an older backend; empty on older bookings. */
          description?: string | null;
          estimatedMinutes?: number | null;
          ppe?: string[];
          warnings?: string[];
          materials?: string[];
          equipment?: string[];
        }>;
        gate: { ok: boolean; blocking: Array<{ code: string; reason: string }> };
        audit: Array<{ id: number; code: string; action: string; from_state: string | null; to_state: string; actor_type: string | null; actor_id: string | null; reason: string | null; request_id: string | null; trace_id: string | null; evidence_ref: string | null; changed_at: string }>;
      }>
    >(`/api/admin/bookings/${id}/execution`, { auth: true }).then((r) => r.data!),

  /** The one admin step action: reset a FAILED/ESCALATED step for a re-attempt, with a reason. */
  adminResetExecutionStep: (id: string, code: string, reason: string) =>
    apiRequest<ApiResponse<{ state: string }>>(`/api/admin/bookings/${id}/execution/${encodeURIComponent(code)}/reset`, { method: "POST", auth: true, body: { reason } }).then((r) => r.data!),

  /** The one admin action on a requirement: force a re-check, with a reason (audited). */
  adminRecheckRequirement: (id: string, code: string, reason: string) =>
    apiRequest<ApiResponse<{ code: string; state: string; changed: boolean }>>(
      `/api/admin/bookings/${id}/requirements/${encodeURIComponent(code)}/recheck`,
      { method: "POST", auth: true, body: { reason } },
    ).then((r) => r.data!),

  /** Phase 10 §10 — quality operations view: verdict history, completion row, warranty, completion audit. */
  getBookingQuality: (id: string) =>
    apiRequest<ApiResponse<AdminQualityView>>(`/api/admin/bookings/${id}/quality`, { auth: true }).then((r) => r.data!),

  /** The one admin quality action: a new verdict that supersedes the latest, with a reason. Never edits history. */
  adminOverrideQualityVerdict: (id: string, verdict: string, reason: string) =>
    apiRequest<ApiResponse<{ verdict: AdminQualityVerdict; supersedes: number | null }>>(
      `/api/admin/bookings/${id}/quality/override`,
      { method: "POST", auth: true, body: { verdict, reason } },
    ).then((r) => r.data!),

  /** Phase 11 — why this booking matched whom. Read-only: re-runs the matcher, dispatches nothing. */
  getBookingMatchingDiagnostics: (id: string) =>
    apiRequest<ApiResponse<AdminMatchingDiagnostics>>(`/api/admin/bookings/${id}/matching-diagnostics`, { auth: true }).then((r) => r.data!),

  /** Phase 10 §11 — complaint / warranty-claim cases (DISPUTES resource). */
  cases: {
    list: (filters: { state?: string; type?: string; slaBreached?: boolean; bookingId?: string; limit?: number; offset?: number } = {}) =>
      apiRequest<ApiResponse<{ available: boolean; total: number; cases: AdminCaseSummary[] }>>("/api/admin/cases", {
        auth: true,
        query: {
          state: filters.state,
          type: filters.type,
          bookingId: filters.bookingId,
          slaBreached: filters.slaBreached ? "true" : undefined,
          limit: filters.limit,
          offset: filters.offset,
        },
      }).then((r) => r.data!),

    detail: (caseId: string) =>
      apiRequest<ApiResponse<AdminCaseDetail>>(`/api/admin/cases/${caseId}`, { auth: true }).then((r) => r.data!),

    /** The stored photo of one evidence item (DISPUTES:READ). Rejects with a 404 AdminApiError when the bytes are not served. */
    evidenceMedia: (caseId: string, evidenceId: number) =>
      apiRequestBlob(`/api/admin/cases/${encodeURIComponent(caseId)}/evidence/${evidenceId}/media`, { auth: true }),

    /** Between OPEN states only; RESOLVED/REJECTED are reached through resolve. 409 CASE_VERSION_CONFLICT when stale. */
    transition: (caseId: string, input: { to: string; reason: string; expectedVersion?: number }) =>
      apiRequest<ApiResponse<{ case: Record<string, unknown> }>>(`/api/admin/cases/${caseId}/transition`, {
        method: "POST",
        auth: true,
        body: input,
      }).then((r) => r.data!),

    /**
     * Decide the case. refundPaise for REFUND; scheduledDate (ISO) for REWORK/INSPECTION;
     * overrideReason unlocks an action the warranty does not allow (409 ACTION_NOT_ALLOWED otherwise,
     * with details.allowedActions naming what is).
     */
    resolve: (
      caseId: string,
      input: {
        action: AdminResolveAction;
        reason: string;
        refundPaise?: number;
        scheduledDate?: string;
        overrideReason?: string;
        expectedVersion?: number;
      },
    ) =>
      apiRequest<ApiResponse<{ replayed: boolean; state: string; resolution: Record<string, unknown> | null }>>(
        `/api/admin/cases/${caseId}/resolve`,
        { method: "POST", auth: true, body: input },
      ).then((r) => r.data!),
  },

  /** Phase 11 — provider capability review (profile with computed validity + audit; verify/reject/revoke). */
  capabilities: {
    profile: (providerId: string) =>
      apiRequest<ApiResponse<AdminCapabilityProfile>>(`/api/admin/providers/${providerId}/capabilities`, { auth: true }).then((r) => r.data!),

    /** verify: DECLARED/REJECTED rows; reject: DECLARED; revoke: DECLARED/VERIFIED (languages: revoke deactivates). Reason required for reject/revoke. */
    transition: (providerId: string, kind: AdminCapabilityKind, rowId: number, action: "verify" | "reject" | "revoke", reason?: string) =>
      apiRequest<ApiResponse<{ row: Record<string, unknown> }>>(
        `/api/admin/providers/${providerId}/capabilities/${kind}/${rowId}/${action}`,
        { method: "POST", auth: true, body: reason ? { reason } : {} },
      ).then((r) => r.data!),
  },

  /** refundPolicy: "customer_policy" = the published tiers a customer would get; "full" = all refundable. */
  adminCancelBooking: (id: string, reason: string, refundPolicy: "customer_policy" | "full" = "customer_policy") =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/bookings/${id}/cancel`, {
      method: "POST",
      auth: true,
      body: { reason, refundPolicy },
    }).then((r) => r.data!),

  adminRescheduleBooking: (id: string, scheduledDate: string, reason: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/bookings/${id}/reschedule`, {
      method: "POST",
      auth: true,
      body: { scheduledDate, reason },
    }).then((r) => r.data!),

  adminReassignBooking: (id: string, providerId: string, reason: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/bookings/${id}/reassign`, {
      method: "POST",
      auth: true,
      body: { providerId, reason },
    }).then((r) => r.data!),

  adminForceDispatch: (id: string, reason: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/bookings/${id}/dispatch`, {
      method: "POST",
      auth: true,
      body: { reason },
    }).then((r) => r.data!),

  adminCompleteBooking: (id: string, reason: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/bookings/${id}/complete`, {
      method: "POST",
      auth: true,
      body: { reason },
    }).then((r) => r.data!),

  adminRepairBooking: (id: string, reason: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/bookings/${id}/repair`, {
      method: "POST",
      auth: true,
      body: { reason },
    }).then((r) => r.data!),

  adminRefundBooking: (id: string, amount: number, reason: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/bookings/${id}/refund`, {
      method: "POST",
      auth: true,
      body: { amount, reason },
    }).then((r) => r.data!),

  adminRetryBookingRefund: (id: string, reason: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/bookings/${id}/refund/retry`, {
      method: "POST",
      auth: true,
      body: { reason },
    }).then((r) => r.data!),

  analytics: (query: { startDate?: string; endDate?: string } = {}) =>
    apiRequest<ApiResponse<AnalyticsData>>("/api/admin/analytics", {
      auth: true,
      query,
    }).then((r) => r.data!),

  /** Phase 1 ML data pipeline — consumes /api/analytics/* */
  dataPipeline: {
    health: async () => {
      const r = await apiRequest<{
        success: boolean;
        pipeline?: PipelineHealth;
        data?: { pipeline?: PipelineHealth };
      }>("/api/analytics/health", { auth: true });
      const pipeline = r.pipeline ?? r.data?.pipeline;
      if (!pipeline) {
        throw new Error("Pipeline health payload missing");
      }
      return { pipeline };
    },
    etlJobs: () =>
      apiRequest<ApiResponse<{ jobs: Array<Record<string, unknown>> }>>("/api/analytics/etl/jobs", { auth: true }).then((r) => r.data!),
    watermarks: () =>
      apiRequest<ApiResponse<{ watermarks: Array<Record<string, unknown>> }>>("/api/analytics/etl/watermarks", { auth: true }).then((r) => r.data!),
    forecast: (scope: string, granularity: string, horizon = 24) =>
      apiRequest<ApiResponse<{ forecasts: Array<Record<string, unknown>> }>>(
        `/api/analytics/forecast/${scope}/${granularity}`,
        { auth: true, query: { horizon } },
      ).then((r) => r.data!),
    surgePlanning: () =>
      apiRequest<ApiResponse<{ data: Record<string, unknown> }>>("/api/analytics/forecast/surge-planning", { auth: true }).then((r) => r.data!),
    capacityPlanning: (city?: string) =>
      apiRequest<ApiResponse<{ data: Record<string, unknown> }>>("/api/analytics/forecast/capacity", {
        auth: true,
        query: city ? { city } : {},
      }).then((r) => r.data!),
  },

  /** Phase 2 ETA Intelligence — label collection platform (no ML inference) */
  /**
   * The ETA analytics routes answer with a flat envelope — `{ success, ...payload }` — rather
   * than nesting the payload under `data`. These methods used to unwrap `.data`, which is always
   * `undefined` here, and React Query rejects an `undefined` result from a query function. Every
   * ETA query therefore failed, and the page read that as the Phase-2 migration being missing.
   *
   * Returned unwrapped, exactly as `geoIntel` above does for the same envelope shape.
   */
  etaIntelligence: {
    dashboard: () => apiRequest<Record<string, unknown>>("/api/analytics/eta", { auth: true }),
    quality: () => apiRequest<Record<string, unknown>>("/api/analytics/eta/quality", { auth: true }),
    readiness: () => apiRequest<Record<string, unknown>>("/api/analytics/eta/readiness", { auth: true }),
    trips: (limit = 50, offset = 0) =>
      apiRequest<{ trips: Array<Record<string, unknown>> }>("/api/analytics/eta/trips", {
        auth: true,
        query: { limit, offset },
      }),
    google: () => apiRequest<Record<string, unknown>>("/api/analytics/eta/google", { auth: true }),
  },

  verifyProvider: (
    id: string,
    action: VerifyAction,
    notes?: string,
    targetStep?: string,
  ) =>
    apiRequest<
      ApiResponse<{
        provider: {
          id: string;
          isApproved: boolean;
          approvalNotes: string | null;
          registrationStatus?: string;
          changesRequestedStep?: string | null;
        };
      }>
    >(`/api/admin/providers/${id}/verify`, {
      method: "PUT",
      auth: true,
      body: { action, notes, ...(targetStep ? { targetStep } : {}) },
    }).then((r) => r.data!),

  banUser: (id: string, action: BanAction, reason?: string) =>
    apiRequest<
      ApiResponse<{ user: { id: string; isBanned: boolean; bannedReason: string | null } }>
    >(`/api/admin/users/${id}/ban`, {
      method: "PUT",
      auth: true,
      body: { action, reason },
    }).then((r) => r.data!),

  forceLogoutUser: (id: string, reason?: string) =>
    apiRequest<ApiResponse<{ message?: string }>>(`/api/admin/users/${id}/force-logout`, {
      method: "POST",
      auth: true,
      body: reason ? { reason } : {},
    }).then((r) => r.data!),

  processWithdrawal: (id: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(
      `/api/admin/withdrawals/${id}/process`,
      { method: "POST", auth: true },
    ).then((r) => r.data!),

  approveWithdrawal: (id: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/withdrawals/${id}/approve`, {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  rejectWithdrawal: (id: string, reason: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/withdrawals/${id}/reject`, {
      method: "POST",
      auth: true,
      body: { reason },
    }).then((r) => r.data!),

  settlements: () =>
    apiRequest<
      ApiResponse<{
        overview: Record<string, unknown>;
        batches: Array<Record<string, unknown>>;
      }>
    >("/api/admin/settlements", { auth: true }).then((r) => r.data!),

  chargebacks: () =>
    apiRequest<ApiResponse<{ chargebacks: Array<Record<string, unknown>> }>>("/api/admin/chargebacks", {
      auth: true,
    }).then((r) => r.data!),

  financeDashboard: (days = 30) =>
    apiRequest<
      ApiResponse<{ overview: Record<string, unknown>; trend: Array<{ date: string; amount: number }> }>
    >("/api/admin/finance/dashboard", { auth: true, query: { days } }).then((r) => r.data!),

  financeReconciliation: () =>
    apiRequest<
      ApiResponse<{
        runs: Array<Record<string, unknown>>;
        metrics: Record<string, unknown>;
      }>
    >("/api/admin/finance/reconciliation", { auth: true }).then((r) => r.data!),

  financeReconciliationIssues: (reconciliationId?: string) =>
    apiRequest<ApiResponse<{ issues: Array<Record<string, unknown>> }>>(
      "/api/admin/finance/reconciliation/issues",
      { auth: true, query: reconciliationId ? { reconciliationId } : {} },
    ).then((r) => r.data!),

  runFinanceReconciliation: () =>
    apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/finance/reconciliation/run", {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  financeSettlements: () =>
    apiRequest<ApiResponse<{ batches: Array<Record<string, unknown>> }>>("/api/admin/finance/settlements", {
      auth: true,
    }).then((r) => r.data!),

  financePayouts: () =>
    apiRequest<
      ApiResponse<{
        payouts: Array<Record<string, unknown>>;
        queue: Array<Record<string, unknown>>;
        batches: Array<Record<string, unknown>>;
      }>
    >("/api/admin/finance/payouts", { auth: true }).then((r) => r.data!),

  retryPayout: (id: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/payouts/${id}/retry`, {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  processPayoutBatch: (batchId: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/payouts/batch/${batchId}/process`, {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  createPayoutBatch: (withdrawalIds: string[]) =>
    apiRequest<ApiResponse<{ batch: Record<string, unknown> }>>("/api/admin/finance/payouts/batch", {
      method: "POST",
      auth: true,
      body: { withdrawalIds },
    }).then((r) => r.data!),

  submitPayoutBatch: (batchId: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/payouts/batch/${batchId}/submit`, {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  approvePayoutBatch: (batchId: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/payouts/batch/${batchId}/approve`, {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  rejectPayoutBatch: (batchId: string, reason: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/payouts/batch/${batchId}/reject`, {
      method: "POST",
      auth: true,
      body: { reason },
    }).then((r) => r.data!),

  getPayoutBatch: (batchId: string) =>
    apiRequest<ApiResponse<{ batch: Record<string, unknown> }>>(`/api/admin/finance/payouts/batch/${batchId}`, {
      auth: true,
    }).then((r) => r.data!),

  runGatewayReconciliation: () =>
    apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/finance/reconciliation/gateway/run", {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  financeRefunds: () =>
    apiRequest<
      ApiResponse<{
        refunds: Array<Record<string, unknown>>;
        analytics: Record<string, unknown>;
        reasonCodes: string[];
      }>
    >("/api/admin/finance/refunds", { auth: true }).then((r) => r.data!),

  approveRefundRequest: (id: string, notes?: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/refunds/${id}/approve`, {
      method: "POST",
      auth: true,
      body: { notes },
    }).then((r) => r.data!),

  rejectRefundRequest: (id: string, notes: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/refunds/${id}/reject`, {
      method: "POST",
      auth: true,
      body: { notes },
    }).then((r) => r.data!),

  financeRisk: () =>
    apiRequest<
      ApiResponse<{ cases: Array<Record<string, unknown>>; holds: Array<Record<string, unknown>> }>
    >("/api/admin/finance/risk", { auth: true }).then((r) => r.data!),

  escalateFraudCase: (id: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/risk/cases/${id}/escalate`, {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  liftFinancialHold: (userId: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/risk/holds/${userId}/lift`, {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  financeUnitEconomics: (days = 30) =>
    apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/finance/analytics/unit-economics", {
      auth: true,
      query: { days },
    }).then((r) => r.data!),

  financeCanonicalGmv: (days = 30) =>
    apiRequest<ApiResponse<CanonicalGmv>>("/api/admin/finance/gmv", {
      auth: true,
      query: { days },
    }).then((r) => r.data!),

  financeIntelligence: (days = 30) =>
    apiRequest<ApiResponse<FinanceIntelligence>>("/api/admin/finance/intelligence", {
      auth: true,
      query: { days },
    }).then((r) => r.data!),

  cxIntelligence: (days = 30) =>
    apiRequest<ApiResponse<CustomerIntelligence>>("/api/admin/cx/intelligence", {
      auth: true,
      query: { days },
    }).then((r) => r.data!),

  growthIntelligence: (days = 30) =>
    apiRequest<ApiResponse<GrowthIntelligence>>("/api/admin/growth/intelligence", {
      auth: true,
      query: { days },
    }).then((r) => r.data!),

  riskIntelligence: (days = 30) =>
    apiRequest<ApiResponse<RiskIntelligence>>("/api/admin/risk/intelligence", {
      auth: true,
      query: { days },
    }).then((r) => r.data!),

  platformIntelligence: () =>
    apiRequest<ApiResponse<PlatformIntelligence>>("/api/admin/platform/intelligence", { auth: true }).then(
      (r) => r.data!,
    ),

  /**
   * One row per flag key. `environment` must equal the backend runtime environment
   * (`PlatformIntelligence.runtimeEnvironment`) for the flag to be read at all. Omitted, a new row
   * is created for that runtime environment and an existing row keeps its own. The route resets
   * `isKillSwitch` to false when that is omitted — send it deliberately.
   */
  platformFlagUpdate: (payload: {
    key: string;
    enabled: boolean;
    rolloutPct?: number;
    description?: string;
    environment?: string;
    isKillSwitch?: boolean;
    reason?: string;
  }) =>
    apiRequest<ApiResponse<{ flag: PlatformFeatureFlag }>>("/api/admin/platform/flags", {
      auth: true,
      method: "PATCH",
      body: payload,
    }).then((r) => r.data!),

  recoveryStatus: () =>
    apiRequest<ApiResponse<RecoveryIntelligence>>("/api/admin/recovery/status", { auth: true }).then((r) => r.data!),

  recoverySimulate: (target: "database" | "redis" | "queue" | "api" | "region") =>
    apiRequest<ApiResponse<RecoverySimulation>>("/api/admin/recovery/simulate", {
      auth: true,
      method: "POST",
      body: { target },
    }).then((r) => r.data!),

  financeConfigGet: () =>
    apiRequest<ApiResponse<FinanceConfigBundle>>("/api/admin/finance/config", { auth: true }).then(
      (r) => r.data!,
    ),

  financeConfigHistory: (key?: string, limit = 50) =>
    apiRequest<ApiResponse<{ history: FinanceConfigHistoryRow[] }>>("/api/admin/finance/config/history", {
      auth: true,
      query: { key, limit },
    }).then((r) => r.data!),

  financeConfigUpdate: (payload: { key: string; value: number; reason?: string }) =>
    apiRequest<ApiResponse<{ config: FinanceConfigEntry }>>("/api/admin/finance/config", {
      auth: true,
      method: "PATCH",
      body: payload,
    }).then((r) => r.data!),

  runFinanceValidation: () =>
    apiRequest<
      ApiResponse<{
        status: string;
        score: number;
        checks: Array<{ name: string; status: string; details?: string }>;
        beforeScore: Record<string, number>;
        afterScore: Record<string, number>;
      }>
    >("/api/admin/finance/validation/run", { method: "POST", auth: true }).then((r) => r.data!),

  assignChargeback: (id: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/chargebacks/${id}/assign`, {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  respondChargeback: (id: string, responseText: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/chargebacks/${id}/respond`, {
      method: "POST",
      auth: true,
      body: { responseText },
    }).then((r) => r.data!),

  closeChargeback: (id: string, outcome?: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/chargebacks/${id}/close`, {
      method: "POST",
      auth: true,
      body: { outcome },
    }).then((r) => r.data!),

  getChargebackDetail: (id: string) =>
    apiRequest<ApiResponse<{ chargeback: Record<string, unknown> }>>(`/api/admin/finance/chargebacks/${id}`, {
      auth: true,
    }).then((r) => r.data!),

  uploadChargebackEvidence: (id: string, fileBase64: string, fileName: string, description?: string) =>
    apiRequest<ApiResponse<{ evidence: Record<string, unknown> }>>(`/api/admin/finance/chargebacks/${id}/evidence`, {
      method: "POST",
      auth: true,
      body: { fileBase64, fileName, description },
    }).then((r) => r.data!),

  getChargebackEvidenceDownloadToken: (evidenceId: string) =>
    apiRequest<ApiResponse<{ token: string; expiresAt: string; downloadPath?: string }>>(
      `/api/admin/finance/chargebacks/evidence/${evidenceId}/download-token`,
      { method: "POST", auth: true },
    ).then((r) => r.data!),

  downloadChargebackEvidence: async (evidenceId: string, fileName: string) => {
    const tokenData = await apiRequest<ApiResponse<{ token: string; expiresAt: string }>>(
      `/api/admin/finance/chargebacks/evidence/${evidenceId}/download-token`,
      { method: "POST", auth: true },
    ).then((r) => r.data!);
    const blob = await apiRequestBlob(
      `/api/admin/finance/chargebacks/evidence/download/${tokenData.token}`,
      { auth: true },
    );
    if (blob.size < 100) {
      throw new Error("Downloaded file is empty or corrupt. Try uploading the evidence again.");
    }
    const typed = blob.type.includes("pdf")
      ? blob
      : new Blob([await blob.arrayBuffer()], { type: "application/pdf" });
    const href = URL.createObjectURL(typed);
    const a = document.createElement("a");
    a.href = href;
    a.download = fileName || "evidence.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  },

  requestChargebackEvidence: (id: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/chargebacks/${id}/request-evidence`, {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  resolveChargeback: (id: string, outcome: "WON" | "LOST", notes?: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/chargebacks/${id}/resolve`, {
      method: "POST",
      auth: true,
      body: { outcome, notes },
    }).then((r) => r.data!),

  getChargebackEvidencePackage: (id: string) =>
    apiRequest<ApiResponse<{ package: Record<string, unknown> }>>(
      `/api/admin/finance/chargebacks/${id}/evidence-package`,
      { auth: true },
    ).then((r) => r.data!),

  downloadChargebackLegalEvidencePack: async (chargebackId: string) => {
    const blob = await apiRequestBlob(`/api/admin/finance/chargebacks/${chargebackId}/evidence-certificate`, {
      auth: true,
    });
    if (blob.size < 500) {
      throw new Error("Evidence pack generation failed. Please retry.");
    }
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `HOMEEIGO-Legal-Evidence-${chargebackId.slice(-8)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  },

  exportChargebackCase: (id: string) =>
    apiRequestText(`/api/admin/finance/chargebacks/${id}/export`, { auth: true }),

  runFinanceIntegrity: () =>
    apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/finance/integrity/run", {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  financeMigrations: () =>
    apiRequest<ApiResponse<{ latest: Record<string, unknown> | null; runs: Array<Record<string, unknown>> }>>(
      "/api/admin/finance/migrations",
      { auth: true },
    ).then((r) => r.data!),

  verifyMigrations: () =>
    apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/finance/migrations/verify", {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  financeChargebacks: () =>
    apiRequest<
      ApiResponse<{ chargebacks: Array<Record<string, unknown>>; analytics: Record<string, unknown> }>
    >("/api/admin/finance/chargebacks", { auth: true }).then((r) => r.data!),

  financeSettlementSync: () =>
    apiRequest<
      ApiResponse<{
        runs: Array<Record<string, unknown>>;
        metrics: Record<string, unknown>;
        discrepancies: Array<Record<string, unknown>>;
      }>
    >("/api/admin/finance/settlement-sync", { auth: true }).then((r) => r.data!),

  runSettlementSync: () =>
    apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/finance/settlement-sync/run", {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  resolveSettlementDiscrepancy: (id: string, notes?: string) =>
    apiRequest<ApiResponse<{ discrepancy: Record<string, unknown> }>>(
      `/api/admin/finance/settlement-sync/discrepancies/${id}/resolve`,
      { method: "POST", auth: true, body: { notes } },
    ).then((r) => r.data!),

  assignSettlementDiscrepancy: (id: string) =>
    apiRequest<ApiResponse<{ discrepancy: Record<string, unknown> }>>(
      `/api/admin/finance/settlement-sync/discrepancies/${id}/assign`,
      { method: "POST", auth: true },
    ).then((r) => r.data!),

  escalateSettlementDiscrepancy: (id: string, reason: string) =>
    apiRequest<ApiResponse<{ discrepancy: Record<string, unknown> }>>(
      `/api/admin/finance/settlement-sync/discrepancies/${id}/escalate`,
      { method: "POST", auth: true, body: { reason } },
    ).then((r) => r.data!),

  settlementHealthScore: () =>
    apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/finance/settlement-sync/health", {
      auth: true,
    }).then((r) => r.data!),

  financeGatewayReconciliationIssues: () =>
    apiRequest<ApiResponse<{ issues: Array<Record<string, unknown>> }>>(
      "/api/admin/finance/reconciliation/gateway/issues",
      { auth: true },
    ).then((r) => r.data!),

  financeReports: (period = "monthly", days?: number) =>
    apiRequest<
      ApiResponse<{ report: Record<string, unknown>; health: Record<string, unknown> }>
    >("/api/admin/finance/reports", { auth: true, query: { period, days } }).then((r) => r.data!),

  /**
   * Phase-9 executive intelligence (Capability 12).
   *
   * ── One request, deliberately ────────────────────────────────────────────────
   *
   * The brief is a single call because the backend builds the executive context once and hands it to
   * every capability that needs it. Nine per-capability calls would rebuild that context nine times
   * per page load. If a future screen needs only one section, it should slice this response rather
   * than open a second door.
   */
  executiveBrief: (period: ExecutiveBriefPeriod = "daily") =>
    apiRequest<ApiResponse<ExecutiveBrief>>("/api/admin/intelligence/executive-brief", {
      auth: true,
      query: { period },
    }).then((r) => r.data!),

  /** Scheduled-report status. Every field may legitimately be null — the schedule is UNSET. */
  reportScheduleStatus: () =>
    apiRequest<ApiResponse<ReportScheduleStatus>>("/api/admin/intelligence/report-schedule", {
      auth: true,
    }).then((r) => r.data!),

  financeIntegrity: () =>
    apiRequest<
      ApiResponse<{
        latest: Record<string, unknown> | null;
        runs: Array<Record<string, unknown>>;
        alerts: Array<Record<string, unknown>>;
        dashboard?: Record<string, unknown>;
      }>
    >("/api/admin/finance/integrity", { auth: true }).then((r) => r.data!),

  accountDeletions: () =>
    apiRequest<ApiResponse<{ deletions: Array<Record<string, unknown>> }>>("/api/admin/account-deletions", {
      auth: true,
    }).then((r) => r.data!),

  financeLiabilities: () =>
    apiRequest<ApiResponse<{ current: Record<string, number>; snapshots: Record<string, Array<Record<string, unknown>>> }>>(
      "/api/admin/finance/liabilities",
      { auth: true },
    ).then((r) => r.data!),

  financeIntegrityValidate: () =>
    apiRequest<
      ApiResponse<{
        score: number;
        status: string;
        bySeverity: { info: number; warning: number; critical: number };
        issues: Array<{ category: string; level: string; severity: string; details: string; referenceId?: string }>;
      }>
    >("/api/admin/finance/integrity/validate", { auth: true }).then((r) => r.data!),

  adjustments: {
    list: (status?: string) =>
      apiRequest<ApiResponse<{ adjustments: AdminAdjustmentRow[] }>>("/api/admin/finance/adjustments", {
        auth: true,
        query: status ? { status } : {},
      }).then((r) => r.data!.adjustments),
    create: (body: AdminAdjustmentInput) =>
      apiRequest<ApiResponse<{ adjustment: AdminAdjustmentRow }>>("/api/admin/finance/adjustments", {
        method: "POST",
        auth: true,
        body,
      }).then((r) => r.data!.adjustment),
    approve: (id: string, notes?: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/finance/adjustments/${id}/approve`, {
        method: "POST",
        auth: true,
        body: { notes },
      }),
    reject: (id: string, reason: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/finance/adjustments/${id}/reject`, {
        method: "POST",
        auth: true,
        body: { reason },
      }),
    execute: (id: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/finance/adjustments/${id}/execute`, {
        method: "POST",
        auth: true,
      }),
  },

  backfill: {
    history: () =>
      apiRequest<ApiResponse<{ runs: AdminBackfillRun[] }>>("/api/admin/finance/backfill/history", {
        auth: true,
      }).then((r) => r.data!.runs),
    issues: (runId?: string) =>
      apiRequest<ApiResponse<{ issues: Array<Record<string, unknown>> }>>("/api/admin/finance/backfill/issues", {
        auth: true,
        query: runId ? { runId } : {},
      }).then((r) => r.data!.issues),
    run: (types?: string[]) =>
      apiRequest<ApiResponse<{ run: AdminBackfillRun }>>("/api/admin/finance/backfill/run", {
        method: "POST",
        auth: true,
        body: types && types.length ? { types } : {},
      }).then((r) => r.data!.run),
  },

  hcoinExpiry: {
    report: () =>
      apiRequest<ApiResponse<AdminHCoinExpiryReport>>("/api/admin/hcoins/expiry/report", {
        auth: true,
      }).then((r) => r.data!),
    updateConfig: (body: { enabled?: boolean; expiryDays?: number }) =>
      apiRequest<ApiResponse<{ config: Record<string, unknown> }>>("/api/admin/hcoins/expiry/config", {
        method: "PUT",
        auth: true,
        body,
      }),
    run: (dryRun = false) =>
      apiRequest<ApiResponse<{ coinsExpired: number; walletsAffected: number; rupeeValue: number; dryRun: boolean }>>(
        "/api/admin/hcoins/expiry/run",
        { method: "POST", auth: true, body: { dryRun } },
      ).then((r) => r.data!),
  },

  // ----------------------------------------------------------- services CRUD
  services: {
    list: (query: ListQuery = {}) =>
      apiRequest<
        ApiResponse<{
          services: AdminServiceRow[];
          total: number;
          page: number;
          limit: number;
          summary?: ServiceCatalogSummary;
        }>
      >("/api/admin/services", { auth: true, query: { ...query } }).then((r) => r.data!),

    create: (body: ServiceInput) =>
      apiRequest<ApiResponse<{ service: AdminServiceRow }>>("/api/admin/services", {
        method: "POST",
        auth: true,
        body,
      }).then((r) => r.data!),

    update: (id: string, body: Partial<ServiceInput>) =>
      apiRequest<ApiResponse<{ service: AdminServiceRow }>>(`/api/admin/services/${id}`, {
        method: "PUT",
        auth: true,
        body,
      }).then((r) => r.data!),

    setStatus: (id: string, isActive: boolean) =>
      apiRequest<ApiResponse<{ service: AdminServiceRow }>>(`/api/admin/services/${id}/status`, {
        method: "PATCH",
        auth: true,
        body: { isActive },
      }).then((r) => r.data!),

    get: (id: string) =>
      apiRequest<ApiResponse<{ service: AdminServiceRow }>>(`/api/admin/services/${id}`, { auth: true }).then((r) => r.data!),

    transition: (id: string, to: RequestableLifecycle, expectedVersion?: number) =>
      apiRequest<ApiResponse<{ service: AdminServiceRow }>>(`/api/admin/services/${id}/lifecycle`, {
        method: "POST",
        auth: true,
        body: { to, expectedVersion },
      }).then((r) => r.data!),

    versions: (id: string) =>
      apiRequest<ApiResponse<{ currentVersion: number; versions: ServiceVersionRow[] }>>(`/api/admin/services/${id}/versions`, {
        auth: true,
      }).then((r) => r.data!),
    /** Phase 06 — reusable requirement catalogue (materials / equipment / customer preconditions). */
    requirementItems: (includeInactive = false) =>
      apiRequest<ApiResponse<{ items: RequirementItemRow[] }>>(`/api/admin/requirement-items${includeInactive ? "?includeInactive=true" : ""}`, { auth: true }).then((r) => r.data!),
    createRequirementItem: (body: { code: string; kind: RequirementItemRow["kind"]; name: string; customerLabel?: string | null; description?: string | null }) =>
      apiRequest<ApiResponse<{ item: RequirementItemRow }>>("/api/admin/requirement-items", { method: "POST", body, auth: true }).then((r) => r.data!),
    updateRequirementItem: (id: string, body: { expectedVersion: number; name?: string; customerLabel?: string | null; description?: string | null; isActive?: boolean }) =>
      apiRequest<ApiResponse<{ item: RequirementItemRow }>>(`/api/admin/requirement-items/${id}`, { method: "PUT", body, auth: true }).then((r) => r.data!),

    categories: () =>
      apiRequest<ApiResponse<ServiceTaxonomyTree>>("/api/admin/service-categories", { auth: true }).then((r) => r.data!),

    remove: (id: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/services/${id}`, {
        method: "DELETE",
        auth: true,
      }),
  },

  subscriptions: {
    listPlans: (query: ListQuery = {}) =>
      apiRequest<ApiResponse<{ plans: AdminPlanRow[]; summary: AdminPlanSummary }>>(
        "/api/admin/subscriptions/plans",
        { auth: true, query: { ...query } },
      ).then((r) => r.data!),

    createPlan: (body: AdminPlanInput) =>
      apiRequest<ApiResponse<{ plan: AdminPlanRow }>>("/api/admin/subscriptions/plans", {
        method: "POST",
        auth: true,
        body,
      }).then((r) => r.data!.plan),

    updatePlan: (id: string, body: Partial<AdminPlanInput> & { isActive?: boolean }) =>
      apiRequest<ApiResponse<{ plan: AdminPlanRow }>>(`/api/admin/subscriptions/plans/${id}`, {
        method: "PUT",
        auth: true,
        body,
      }).then((r) => r.data!.plan),

    subscribers: (query: ListQuery = {}) =>
      apiRequest<ApiResponse<{ subscribers: AdminSubscriberRow[]; pagination: { page: number; limit: number; total: number; hasMore: boolean } }>>(
        "/api/admin/subscriptions/subscribers",
        { auth: true, query: { ...query } },
      ).then((r) => r.data!),

    revenue: () =>
      apiRequest<ApiResponse<AdminSubscriptionRevenue>>("/api/admin/subscriptions/revenue", {
        auth: true,
      }).then((r) => r.data!),

    analytics: (period = "monthly") =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/membership/analytics", {
        auth: true,
        query: { period },
      }).then((r) => r.data!),

    cashbackDashboard: () =>
      apiRequest<ApiResponse<AdminCashbackDashboard>>("/api/admin/membership/cashback/dashboard", {
        auth: true,
      }).then((r) => r.data!),

    cashbackLiability: () =>
      apiRequest<ApiResponse<AdminCashbackLiability>>("/api/admin/membership/cashback/liability", {
        auth: true,
      }).then((r) => r.data!),

    cashbackReports: (query: ListQuery = {}) =>
      apiRequest<ApiResponse<AdminCashbackReports>>("/api/admin/membership/cashback/reports", {
        auth: true,
        query: { ...query },
      }).then((r) => r.data!),

    queueAnalytics: () =>
      apiRequest<ApiResponse<AdminQueueDesk>>("/api/admin/membership/queue/analytics", {
        auth: true,
      }).then((r) => r.data!),

    insights: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/membership/insights", {
        auth: true,
      }).then((r) => r.data!),

    matchingAnalytics: () =>
      apiRequest<ApiResponse<{
        premiumMatchedBookings: number;
        totalBookings: number;
        premiumMatchRatePct: number;
      }>>("/api/admin/membership/matching/analytics", { auth: true }).then((r) => r.data!),
  },

  membershipCoupons: {
    list: (query: ListQuery = {}) =>
      apiRequest<ApiResponse<{ coupons: AdminMembershipCouponRow[]; total: number; page: number }>>(
        "/api/admin/membership/coupons",
        { auth: true, query: { ...query } },
      ).then((r) => r.data!),
    create: (body: AdminMembershipCouponInput) =>
      apiRequest<ApiResponse<{ coupon: AdminMembershipCouponRow }>>("/api/admin/membership/coupons", {
        method: "POST",
        auth: true,
        body,
      }).then((r) => r.data!.coupon),
    update: (id: string, body: Partial<AdminMembershipCouponInput>) =>
      apiRequest<ApiResponse<{ coupon: AdminMembershipCouponRow }>>(`/api/admin/membership/coupons/${id}`, {
        method: "PUT",
        auth: true,
        body,
      }).then((r) => r.data!.coupon),
    analytics: () =>
      apiRequest<ApiResponse<AdminMembershipCouponAnalytics>>("/api/admin/membership/coupons/analytics", {
        auth: true,
      }).then((r) => r.data!),
    exportCsv: () =>
      apiRequestBlob("/api/admin/membership/coupons/export", { auth: true }),
    bulkGenerate: (body: AdminMembershipCouponBulkInput) =>
      apiRequest<ApiResponse<{ codes: string[]; count: number }>>("/api/admin/membership/coupons/bulk", {
        method: "POST",
        auth: true,
        body,
      }).then((r) => r.data!),
  },

  campaigns: {
    list: (query: ListQuery = {}) =>
      apiRequest<ApiResponse<{ campaigns: AdminCampaignRow[]; total: number; page: number }>>(
        "/api/admin/campaigns",
        { auth: true, query: { ...query } },
      ).then((r) => r.data!),
    create: (body: AdminCampaignInput) =>
      apiRequest<ApiResponse<{ campaign: AdminCampaignRow }>>("/api/admin/campaigns", {
        method: "POST",
        auth: true,
        body,
      }).then((r) => r.data!.campaign),
    update: (id: string, body: Partial<AdminCampaignInput>) =>
      apiRequest<ApiResponse<{ campaign: AdminCampaignRow }>>(`/api/admin/campaigns/${id}`, {
        method: "PUT",
        auth: true,
        body,
      }).then((r) => r.data!.campaign),
    analytics: (campaignId?: string) =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/campaigns/analytics", {
        auth: true,
        query: campaignId ? { campaignId } : {},
      }).then((r) => r.data!),
  },

  support: {
    tickets: (query: ListQuery & { priority?: string; assigned?: string; providerId?: string; bookingId?: string } = {}) =>
      apiRequest<ApiResponse<{ tickets: AdminSupportTicket[]; total: number; page: number }>>(
        "/api/admin/support/tickets",
        { auth: true, query: { ...query } },
      ).then((r) => r.data!),
    ticketById: (id: string) =>
      apiRequest<ApiResponse<{ ticket: AdminSupportTicketDetail }>>(
        `/api/admin/support/tickets/${id}`,
        { auth: true },
      ).then((r) => r.data!.ticket),
    /** The persisted recommendation history for one ticket — the audit trail behind the panel. */
    recommendations: (id: string) =>
      apiRequest<ApiResponse<{ history: SupportRecommendationRow[] }>>(
        `/api/admin/support/tickets/${id}/recommendations`,
        { auth: true },
      ).then((r) => r.data!.history),

    /**
     * Record a person's verdict on the current recommendation.
     *
     * Records agreement only. Nothing is executed here — the existing respond / escalate / resolve
     * controls remain the only way anything happens to a ticket.
     */
    recommendationVerdict: (id: string, verdict: "APPROVED" | "REJECTED", note?: string) =>
      apiRequest<ApiResponse<{ matched: boolean; recommendationId: string | null }>>(
        `/api/admin/support/tickets/${id}/recommendation/verdict`,
        { auth: true, method: "POST", body: { verdict, note } },
      ).then((r) => r.data!),

    /** Phase-10 intelligence for one ticket. Read-only; gated by the ticket's own DISPUTES/READ. */
    intelligence: (id: string) =>
      apiRequest<ApiResponse<SupportIntelligence>>(
        `/api/admin/support/tickets/${id}/intelligence`,
        { auth: true },
      ).then((r) => r.data!),
    analytics: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/support/analytics", {
        auth: true,
      }).then((r) => r.data!),
    respond: (id: string, resolution: string, internal = false) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/support/tickets/${id}/respond`, {
        method: "POST",
        auth: true,
        body: { resolution, internal },
      }),
    resolve: (id: string, resolution: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/support/tickets/${id}/resolve`, {
        method: "POST",
        auth: true,
        body: { resolution },
      }),
    escalate: (id: string, note?: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/support/tickets/${id}/escalate`, {
        method: "POST",
        auth: true,
        body: { note },
      }),
    merge: (id: string, duplicateId: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/support/tickets/${id}/merge`, {
        method: "POST",
        auth: true,
        body: { duplicateId },
      }),
  },

  referrals: {
    analytics: () =>
      apiRequest<ApiResponse<AdminReferralAnalytics>>("/api/admin/referrals/analytics", {
        auth: true,
      }).then((r) => r.data!),
    partnerOverview: () =>
      apiRequest<ApiResponse<AdminPartnerReferralOverview>>("/api/admin/partner-referrals/overview", {
        auth: true,
      }).then((r) => r.data!),
    partnerQueue: (query: Record<string, string | number | undefined> = {}) =>
      apiRequest<ApiResponse<AdminPartnerReferralList>>("/api/admin/partner-referrals/queue", {
        auth: true,
        query,
      }).then((r) => r.data!),
    partnerAction: (id: string, action: string, reason?: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/partner-referrals/${id}/action`, {
        method: "POST",
        auth: true,
        body: { action, reason },
      }),
  },

  fraud: {
    overview: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/fraud/overview", {
        auth: true,
      }).then((r) => r.data!),
    highRiskUsers: () =>
      apiRequest<ApiResponse<{ users: AdminFraudUser[] }>>("/api/admin/fraud/high-risk-users", {
        auth: true,
      }).then((r) => r.data!.users),
    reviewQueue: (query: ListQuery = {}) =>
      apiRequest<ApiResponse<{ commissions: AdminFrozenCommission[]; total: number }>>(
        "/api/admin/fraud/review-queue",
        { auth: true, query: { ...query } },
      ).then((r) => r.data!),
    alerts: (query: ListQuery = {}) =>
      apiRequest<ApiResponse<{ alerts: AdminFraudAlert[]; total: number }>>("/api/admin/fraud/alerts", {
        auth: true,
        query: { ...query },
      }).then((r) => r.data!),
    monthlyReport: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/fraud/analytics/monthly", {
        auth: true,
      }).then((r) => r.data!),
    approveCommission: (id: string, note?: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/fraud/commissions/${id}/approve`, {
        method: "POST",
        auth: true,
        body: { note },
      }),
    rejectCommission: (id: string, reason: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/fraud/commissions/${id}/reject`, {
        method: "POST",
        auth: true,
        body: { reason },
      }),
    freezeCommission: (id: string, reason?: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/fraud/commissions/${id}/freeze`, {
        method: "POST",
        auth: true,
        body: { reason },
      }),
    /**
     * The counterpart to `freezeCommission`, which the console has always had.
     *
     * The backend endpoint existed with no caller, so a frozen referral commission could be put on
     * hold from the fraud console and then only released by someone with database access. Freezing
     * is reversible by design — the endpoint moves the commission back to review rather than
     * approving it — so an operator who froze one in error had no way to undo it.
     */
    unfreezeCommission: (id: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/fraud/commissions/${id}/unfreeze`, {
        method: "POST",
        auth: true,
      }),
    blacklistUser: (id: string, reason: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/fraud/users/${id}/blacklist`, {
        method: "POST",
        auth: true,
        body: { reason },
      }),
  },

  transfers: {
    list: (query: ListQuery = {}) =>
      apiRequest<ApiResponse<AdminTransfersResponse>>("/api/admin/transfers", {
        auth: true,
        query: { ...query },
      }).then((r) => r.data!),
  },

  giftCards: {
    list: (query: ListQuery = {}) =>
      apiRequest<ApiResponse<AdminGiftCardsResponse>>("/api/admin/giftcards", {
        auth: true,
        query: { ...query },
      }).then((r) => r.data!),
  },

  invoices: {
    list: (query: ListQuery & { search?: string } = {}) =>
      apiRequest<ApiResponse<AdminInvoicesResponse>>("/api/admin/invoices", {
        auth: true,
        query: { ...query },
      }).then((r) => r.data!),
    revenueReport: () =>
      apiRequest<ApiResponse<AdminRevenueReport>>("/api/admin/revenue-report", {
        auth: true,
      }).then((r) => r.data!),
  },

  hcoins: {
    analytics: () =>
      apiRequest<ApiResponse<AdminHCoinAnalytics>>("/api/admin/hcoins/analytics", {
        auth: true,
      }).then((r) => r.data!),
    updateRule: (id: string, body: { coins?: number; isActive?: boolean }) =>
      apiRequest<ApiResponse<{ rule: HCoinRule }>>(`/api/admin/hcoins/rules/${id}`, {
        method: "PUT",
        auth: true,
        body,
      }).then((r) => r.data!.rule),
    grant: (body: { userId: string; coins: number; note?: string }) =>
      apiRequest<ApiResponse<unknown>>("/api/admin/hcoins/grant", {
        method: "POST",
        auth: true,
        body,
      }),
  },

  /**
   * Vision Intelligence admin surface.
   *
   * Routed through `apiRequest` with `auth: true` like every other admin call — the page
   * previously used a bare `fetch()`, which sent no Authorization header and therefore always
   * got 401 (verified against the running backend), and read fields straight off the response
   * instead of unwrapping `{ success, data }`, so every stat rendered undefined.
   */
  vision: {
    status: () =>
      apiRequest<ApiResponse<VisionStatus>>("/api/vision/status", { auth: true }).then((r) => r.data!),
    purgeExpired: () =>
      apiRequest<ApiResponse<{ purged: number; failed: number }>>("/api/vision/admin/purge", {
        method: "POST",
        auth: true,
      }).then((r) => r.data!),
  },

  observability: {
    health: () =>
      apiRequest<ApiResponse<ObservabilityHealth>>("/api/admin/observability/health", {
        auth: true,
      }).then((r) => r.data!),
    emailHealth: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/observability/email-health", {
        auth: true,
      }).then((r) => r.data!),
    alerts: (query: { limit?: number; resolved?: boolean } = {}) =>
      apiRequest<ApiResponse<{ alerts: ObservabilityAlert[] }>>("/api/admin/observability/alerts", {
        auth: true,
        query: {
          ...query,
          ...(query.resolved !== undefined ? { resolved: String(query.resolved) } : {}),
        },
      }).then((r) => r.data!.alerts),
    resolveAlert: (source: "ops" | "finance", id: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/observability/alerts/${source}/${id}/resolve`, {
        method: "POST",
        auth: true,
      }),
    evaluateAlerts: () =>
      apiRequest<ApiResponse<{ raised: number }>>("/api/admin/observability/alerts/evaluate", {
        method: "POST",
        auth: true,
      }).then((r) => r.data!),
    logs: (query: LogSearchQuery = {}) =>
      apiRequest<ApiResponse<LogSearchResult>>("/api/admin/observability/logs", {
        auth: true,
        query: { ...query },
      }).then((r) => r.data!),
    exportLogsCsv: (query: LogSearchQuery = {}) =>
      apiRequestText("/api/admin/observability/logs/export.csv", {
        auth: true,
        query: { ...query },
      }),
    runValidation: () =>
      apiRequest<ApiResponse<ProductionValidationReport>>("/api/admin/observability/validation/run", {
        method: "POST",
        auth: true,
      }).then((r) => r.data!),
    archivalStrategy: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/observability/archival/strategy", {
        auth: true,
      }).then((r) => r.data!),
  },

  automation: {
    overview: () =>
      apiRequest<ApiResponse<AutomationOverview>>("/api/admin/automation/overview", {
        auth: true,
      }).then((r) => r.data!),
    instances: (query: { workflowId?: string; status?: string; limit?: number } = {}) =>
      apiRequest<ApiResponse<AutomationInstance[]>>("/api/admin/automation/instances", {
        auth: true,
        query,
      }).then((r) => r.data!),
    deadLetters: (limit = 50) =>
      apiRequest<ApiResponse<AutomationDeadLetter[]>>("/api/admin/automation/dead-letters", {
        auth: true,
        query: { limit },
      }).then((r) => r.data!),
    outbox: (query: { status?: string; limit?: number } = {}) =>
      apiRequest<ApiResponse<AutomationOutboxRow[]>>("/api/admin/automation/outbox", {
        auth: true,
        query,
      }).then((r) => r.data!),
    replayDeadLetter: (id: string) =>
      apiRequest<ApiResponse<{ replayed: boolean; reason: string }>>(
        `/api/admin/automation/dead-letters/${id}/replay`,
        { method: "POST", auth: true },
      ).then((r) => r.data!),

    /**
     * Instances that cannot make progress. The backend has exposed these since Phase 14 and
     * nothing called it: 16 stuck instances were being counted in `/metrics` with no way for an
     * operator to see, let alone resolve, any of them.
     */
    stuckWorkflows: () =>
      apiRequest<ApiResponse<StuckWorkflowInstance[]>>("/api/admin/governance/workflows/stuck", {
        auth: true,
      }).then((r) => r.data!),

    /**
     * `observedStatus` / `observedUpdatedAt` are the state the operator was looking at. The backend
     * requires them so two simultaneous recoveries resolve to exactly one winner instead of
     * scheduling two wake-ups on one instance — so they are passed through, never defaulted.
     */
    recoverWorkflow: (input: {
      instanceId: string;
      action: "REQUEUE" | "CANCEL";
      reason: string;
      observedStatus: string;
      observedUpdatedAt: string;
    }) =>
      apiRequest<ApiResponse<{ ok: boolean; reason?: string }>>(
        `/api/admin/governance/workflows/${encodeURIComponent(input.instanceId)}/recover`,
        {
          method: "POST",
          auth: true,
          body: {
            action: input.action,
            reason: input.reason,
            observedStatus: input.observedStatus,
            observedUpdatedAt: input.observedUpdatedAt,
          },
        },
      ).then((r) => r.data!),
  },

  compliance: {
    listRequests: (opts: { limit?: number; status?: string } = {}) =>
      apiRequest<ApiResponse<{ requests: ComplianceRequest[] }>>("/api/compliance/admin/requests", {
        auth: true,
        query: {
          ...(opts.limit ? { limit: opts.limit } : {}),
          ...(opts.status ? { status: opts.status } : {}),
        },
      }).then((r) => r.data!.requests),
    approve: (id: string) =>
      apiRequest<ApiResponse<{ request: ComplianceRequest }>>(
        `/api/compliance/admin/requests/${id}/approve`,
        { method: "POST", auth: true },
      ),
    reject: (id: string, reason: string) =>
      apiRequest<ApiResponse<{ request: ComplianceRequest }>>(
        `/api/compliance/admin/requests/${id}/reject`,
        { method: "POST", body: { reason }, auth: true },
      ),
    retentionReport: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/compliance/admin/retention/report", {
        auth: true,
      }).then((r) => r.data!),
  },

  trustSafety: {
    overview: () =>
      apiRequest<ApiResponse<{ expiring: number; expired: number; restricted: number; openIncidents: number; sosOpen: number; riskReview: number }>>(
        "/api/admin/trust-safety/overview",
        { auth: true },
      ).then((r) => r.data!),
    compliance: (query: { filter?: string; page?: number } = {}) =>
      apiRequest<ApiResponse<{ items: Array<Record<string, unknown>>; total: number; page: number }>>(
        "/api/admin/trust-safety/compliance",
        { auth: true, query },
      ).then((r) => r.data!),
    unrestrict: (providerId: string, reason?: string) =>
      apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/trust-safety/compliance/${providerId}/unrestrict`, {
        method: "POST",
        auth: true,
        body: { reason },
      }),
    risk: (query: { level?: string; reviewStatus?: string; page?: number } = {}) =>
      apiRequest<ApiResponse<{ items: Array<Record<string, unknown>>; total: number }>>("/api/admin/trust-safety/risk", {
        auth: true,
        query,
      }).then((r) => r.data!),
    riskDetail: (providerId: string) =>
      apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/trust-safety/risk/${providerId}`, { auth: true }).then(
        (r) => r.data!,
      ),
    review: (providerId: string, action: string, notes?: string) =>
      apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/trust-safety/risk/${providerId}/review`, {
        method: "POST",
        auth: true,
        body: { action, notes },
      }),
    incidents: (query: { status?: string; type?: string; severity?: string; page?: number } = {}) =>
      apiRequest<ApiResponse<{ items: Array<Record<string, unknown>>; total: number }>>(
        "/api/admin/trust-safety/incidents",
        { auth: true, query },
      ).then((r) => r.data!),
    incident: (id: string) =>
      apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/trust-safety/incidents/${id}`, { auth: true }).then(
        (r) => r.data!,
      ),
    assignIncident: (id: string, assignedTo: string) =>
      apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/trust-safety/incidents/${id}/assign`, {
        method: "POST",
        auth: true,
        body: { assignedTo },
      }),
    acknowledgeIncident: (id: string) =>
      apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/trust-safety/incidents/${id}/acknowledge`, {
        method: "POST",
        auth: true,
      }),
    resolveIncident: (id: string, notes: string) =>
      apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/trust-safety/incidents/${id}/resolve`, {
        method: "POST",
        auth: true,
        body: { notes },
      }),
  },

  // Phase 17.4 / 16.4 / 16.3 — operations map, heatmap, geofence management (existing APIs).
  opsMap: () => apiRequest<ApiResponse<OpsMapData>>("/api/admin/ops-map", { auth: true }).then((r) => r.data!),
  /** Shared, audited alert acknowledgements (server-side; every admin sees the same set). */
  opsAlertAcks: () =>
    apiRequest<ApiResponse<{ acks: OpsAlertAck[] }>>("/api/admin/ops-alerts/acks", { auth: true }).then((r) => r.data!.acks),
  acknowledgeOpsAlerts: (keys: string[]) =>
    apiRequest<ApiResponse<{ acknowledged: number; rejected: string[] }>>("/api/admin/ops-alerts/acks", {
      method: "POST",
      auth: true,
      body: { keys },
    }).then((r) => r.data!),
  partnerAvailability: (query: {
    status?: string;
    zone?: string;
    skill?: string;
    capacity?: "full" | "available";
    search?: string;
    page?: number;
    limit?: number;
  } = {}) =>
    apiRequest<
      ApiResponse<{
        items: Array<{
          id: string;
          name: string;
          status: string;
          isOnline: boolean;
          lifecycleState: string;
          city: string | null;
          zones: string[];
          skills: string[];
          currentJobs: number;
          maxConcurrent: number;
          dailyQuota: number | null;
          jobsToday: number;
          availableSlots: number;
          utilization: number;
          lastSeen: string | null;
          nextAvailable: string | null;
          rating: number;
          presence: "FRESH" | "STALE" | "EXPIRED";
          lastHeartbeatAt: string | null;
          locationFreshness: "FRESH" | "STALE" | "EXPIRED";
          lastLocationAt: string | null;
          dispatchEligible: boolean;
          dispatchBlockedBy: string | null;
          dispatchReasons: string[];
        }>;
        total: number;
        page: number;
        limit: number;
      }>
    >("/api/admin/partner-availability", { auth: true, query }).then((r) => r.data!),
  workforceAnalytics: () =>
    apiRequest<ApiResponse<WorkforceAnalytics>>("/api/admin/workforce/analytics", { auth: true }).then((r) => r.data!),
  academyModules: () =>
    apiRequest<ApiResponse<AcademyCatalog>>("/api/admin/academy/modules", { auth: true }).then((r) => r.data!),
  createAcademyModule: (input: AcademyModuleInput) =>
    apiRequest<ApiResponse<{ module: AcademyModule }>>("/api/admin/academy/modules", {
      method: "POST",
      auth: true,
      body: input,
    }).then((r) => r.data!),
  patchAcademyModule: (id: string, patch: AcademyModulePatch) =>
    apiRequest<ApiResponse<{ module: AcademyModule }>>(`/api/admin/academy/modules/${id}`, {
      method: "PATCH",
      auth: true,
      body: patch,
    }).then((r) => r.data!),
  incentiveRules: () =>
    apiRequest<ApiResponse<{ rules: unknown[] }>>("/api/admin/incentives/rules", { auth: true }).then((r) => r.data!),

  pendingDocuments: () =>
    apiRequest<
      ApiResponse<{
        documents: PendingPartnerDocument[];
      }>
    >("/api/admin/documents/pending", { auth: true }).then((r) => r.data!),

  verifyPartnerDocument: (providerId: string, docId: string, notes?: string) =>
    apiRequest<ApiResponse<{ document: PendingPartnerDocument }>>(
      `/api/admin/providers/${providerId}/documents/${docId}/verify`,
      { method: "PUT", auth: true, body: notes ? { notes } : {} },
    ),

  rejectPartnerDocument: (providerId: string, docId: string, reason: string) =>
    apiRequest<ApiResponse<{ document: PendingPartnerDocument }>>(
      `/api/admin/providers/${providerId}/documents/${docId}/reject`,
      { method: "PUT", auth: true, body: { reason } },
    ),

  partnerAcquisition: {
    dashboard: (range: "7d" | "30d" | "90d" = "30d") =>
      apiRequest<ApiResponse<PartnerAcquisitionDashboard>>("/api/admin/partner-acquisition/dashboard", {
        auth: true,
        query: { range },
      }).then((r) => r.data!),
    sources: (range: "7d" | "30d" | "90d" = "30d") =>
      apiRequest<ApiResponse<PartnerLeadSourceMetric[]>>("/api/admin/partner-acquisition/sources", {
        auth: true,
        query: { range },
      }).then((r) => r.data!),
    listLeads: (query: PartnerLeadListQuery = {}) =>
      apiRequest<ApiResponse<PartnerLeadListResult>>("/api/admin/partner-acquisition/leads", {
        auth: true,
        query: query as Record<string, string | number | undefined>,
      }).then((r) => r.data!),
    getLead: (id: string) =>
      apiRequest<ApiResponse<PartnerLeadDetail>>(`/api/admin/partner-acquisition/leads/${id}`, {
        auth: true,
      }).then((r) => r.data!),
    getLeadTransitions: (id: string) =>
      apiRequest<ApiResponse<{ current: PartnerLeadStatus; allowed: PartnerLeadStatus[] }>>(
        `/api/admin/partner-acquisition/leads/${id}/transitions`,
        { auth: true },
      ).then((r) => r.data!),
    checkDuplicates: (body: { phone?: string; email?: string }) =>
      apiRequest<ApiResponse<{ matches: PartnerDuplicateMatch[] }>>(
        "/api/admin/partner-acquisition/leads/check-duplicates",
        { method: "POST", auth: true, body },
      ).then((r) => r.data!),
    createLead: (body: PartnerLeadCreateInput) =>
      apiRequest<ApiResponse<PartnerLead>>(`/api/admin/partner-acquisition/leads`, {
        method: "POST",
        auth: true,
        body,
      }).then((r) => r.data!),
    updateStatus: (id: string, body: { status: string; reason?: string }) =>
      apiRequest<ApiResponse<PartnerLead>>(`/api/admin/partner-acquisition/leads/${id}/status`, {
        method: "PATCH",
        auth: true,
        body,
      }).then((r) => r.data!),
    assignLead: (id: string, assignedToAdminId: string) =>
      apiRequest<ApiResponse<PartnerLead>>(`/api/admin/partner-acquisition/leads/${id}/assign`, {
        method: "PATCH",
        auth: true,
        body: { assignedToAdminId },
      }).then((r) => r.data!),
    setFollowUp: (id: string, body: { nextFollowUpAt: string; followUpReason?: string }) =>
      apiRequest<ApiResponse<PartnerLead>>(`/api/admin/partner-acquisition/leads/${id}/follow-up`, {
        method: "PATCH",
        auth: true,
        body,
      }).then((r) => r.data!),
    logActivity: (id: string, body: { type: string; title: string; description?: string }) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/partner-acquisition/leads/${id}/activity`, {
        method: "POST",
        auth: true,
        body,
      }).then((r) => r.data!),
    updateNotes: (id: string, notes: string) =>
      apiRequest<ApiResponse<PartnerLead>>(`/api/admin/partner-acquisition/leads/${id}/notes`, {
        method: "PATCH",
        auth: true,
        body: { notes },
      }).then((r) => r.data!),
    startApplication: (id: string) =>
      apiRequest<
        ApiResponse<{
          lead: PartnerLead;
          applicationUrl: string;
          smsBody: string;
          inviteExpiresInDays: number;
        }>
      >(`/api/admin/partner-acquisition/leads/${id}/start-application`, {
        method: "POST",
        auth: true,
      }).then((r) => r.data!),
    activationChecklist: (providerId: string) =>
      apiRequest<ApiResponse<PartnerActivationChecklist>>(
        `/api/admin/partner-acquisition/applications/${providerId}/checklist`,
        { auth: true },
      ).then((r) => r.data!),
    verifyBackgroundCheck: (providerId: string, notes?: string) =>
      apiRequest<ApiResponse<PartnerActivationChecklist>>(
        `/api/admin/partner-acquisition/applications/${providerId}/background-check/verify`,
        { method: "POST", auth: true, body: { notes } },
      ).then((r) => r.data!),
    previewMerge: (primaryId: string, duplicateId: string) =>
      apiRequest<ApiResponse<PartnerLeadMergePreview>>(
        `/api/admin/partner-acquisition/leads/${primaryId}/merge-preview`,
        { auth: true, query: { duplicateId } },
      ).then((r) => r.data!),
    markDuplicate: (id: string, body: { duplicateOfLeadId: string; reason: string }) =>
      apiRequest<ApiResponse<PartnerLead>>(`/api/admin/partner-acquisition/leads/${id}/mark-duplicate`, {
        method: "POST",
        auth: true,
        body,
      }).then((r) => r.data!),
    mergeLeads: (
      id: string,
      body: { duplicateLeadId: string; reason: string; resolutions?: Record<string, "primary" | "duplicate"> },
    ) =>
      apiRequest<ApiResponse<{ primaryLeadId: string; mergedLeadId: string; idempotent: boolean; lead: PartnerLead }>>(
        `/api/admin/partner-acquisition/leads/${id}/merge`,
        { method: "POST", auth: true, body },
      ).then((r) => r.data!),
    applications: (query: Record<string, string | number | undefined> = {}) =>
      apiRequest<ApiResponse<PartnerQueueResult<PartnerApplicationRow>>>(
        "/api/admin/partner-acquisition/applications",
        { auth: true, query },
      ).then((r) => r.data!),
    verification: (query: Record<string, string | number | undefined> = {}) =>
      apiRequest<ApiResponse<PartnerQueueResult<PartnerVerificationRow>>>(
        "/api/admin/partner-acquisition/verification",
        { auth: true, query },
      ).then((r) => r.data!),
    approvals: (query: Record<string, string | number | undefined> = {}) =>
      apiRequest<ApiResponse<PartnerQueueResult<PartnerApprovalRow>>>("/api/admin/partner-acquisition/approvals", {
        auth: true,
        query,
      }).then((r) => r.data!),
    listSpend: () =>
      apiRequest<ApiResponse<AcquisitionSpendRow[]>>("/api/admin/partner-acquisition/spend", { auth: true }).then(
        (r) => r.data!,
      ),
    createSpend: (body: AcquisitionSpendInput) =>
      apiRequest<ApiResponse<AcquisitionSpendRow>>("/api/admin/partner-acquisition/spend", {
        method: "POST",
        auth: true,
        body,
      }).then((r) => r.data!),
    deleteSpend: (id: string) =>
      apiRequest<ApiResponse<{ id: string }>>(`/api/admin/partner-acquisition/spend/${id}`, {
        method: "DELETE",
        auth: true,
      }).then((r) => r.data!),
  },

  heatmap: (params: { gridSize?: number; days?: number } = {}) =>
    apiRequest<ApiResponse<HeatmapData>>("/api/admin/heatmap", { auth: true, query: { ...params } }).then((r) => r.data!),

  // --- Customer intelligence (CLV, churn, RFM) — real per-user analytics ---
  customerIntel: {
    profile: (userId: string) =>
      apiRequest<ApiResponse<CustomerIntel>>(`/api/customer-intel/${encodeURIComponent(userId)}`, {
        auth: true,
      }).then((r) => r.data!),
    match: (lat: number, lng: number) =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/customer-intel/match", {
        auth: true,
        query: { lat, lng },
      }).then((r) => r.data!),
  },

  // --- MLOps / AI model registry (BigQuery-backed; may be empty if GCP unset) ---
  mlops: {
    registry: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/mlops/registry", { auth: true }).then((r) => r.data!),
    dataQuality: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/mlops/data-quality", { auth: true }).then((r) => r.data!),
    /** Whole response: `available: false` (warehouse down) must not read as an empty registry (X-88). */
    health: () => apiRequest<MlopsHealthResponse>("/api/mlops/health", { auth: true }),
  },

  // --- RBAC: roles, admins, current permissions (real) ---
  rbac: {
    roles: () =>
      apiRequest<ApiResponse<{ roles: Array<Record<string, unknown>> }>>("/api/admin/rbac/roles", {
        auth: true,
      }).then((r) => r.data!),
    admins: () =>
      apiRequest<ApiResponse<{ admins: Array<Record<string, unknown>> }>>("/api/admin/rbac/admins", {
        auth: true,
      }).then((r) => r.data!),
    me: () =>
      apiRequest<ApiResponse<{ role?: string; permissions?: string[]; userId?: string; adminId?: string }>>(
        "/api/admin/rbac/me",
        { auth: true },
      ).then((r) => r.data!),
    grantRole: (userId: string, roleId: string) =>
      apiRequest<ApiResponse<unknown>>("/api/admin/rbac/grant-role", { method: "POST", auth: true, body: { userId, roleId } }),
    revokeRole: (adminUserId: string) =>
      apiRequest<ApiResponse<unknown>>("/api/admin/rbac/revoke-role", { method: "POST", auth: true, body: { adminUserId } }),
  },

  // --- Membership time-series (retention / churn per period) ---
  membershipTrends: (period = "monthly") =>
    apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/membership/analytics/trends", {
      auth: true,
      query: { period },
    }).then((r) => r.data!),

  geofences: {
    list: (query: { city?: string; activeOnly?: boolean } = {}) =>
      apiRequest<ApiResponse<{ geofences: Geofence[] }>>("/api/geo/geofences", { auth: true, query: { ...query } }).then((r) => r.data!.geofences),
    create: (body: GeofenceInput) =>
      apiRequest<ApiResponse<{ geofence: Geofence }>>("/api/geo/geofences", { method: "POST", auth: true, body }).then((r) => r.data!.geofence),
    update: (id: string, body: Partial<GeofenceInput> & { isActive?: boolean }) =>
      apiRequest<ApiResponse<{ geofence: Geofence }>>(`/api/geo/geofences/${id}`, { method: "PATCH", auth: true, body }).then((r) => r.data!.geofence),
    remove: (id: string) =>
      apiRequest<ApiResponse<{ ok: boolean }>>(`/api/geo/geofences/${id}`, { method: "DELETE", auth: true }).then((r) => r.data!),
    events: (query: { geofenceId?: string; eventType?: string; limit?: number } = {}) =>
      apiRequest<ApiResponse<{ events: GeofenceEvent[] }>>("/api/geo/geofence-events", { auth: true, query: { ...query } }).then((r) => r.data!.events),
  },

  aiBrain: {
    timeline: (days = 7) =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/ai/timeline", { auth: true, query: { days } }).then((r) => r.data!),
    memoryStats: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/ai/memory/stats", { auth: true }).then((r) => r.data!),
    memories: (query: { type?: string; q?: string; limit?: number } = {}) =>
      apiRequest<ApiResponse<Array<Record<string, unknown>>>>("/api/ai/memory", { auth: true, query }).then((r) => r.data!),
    prompts: (category?: string) =>
      apiRequest<ApiResponse<{ prompts: Array<Record<string, unknown>>; categories: string[] }>>("/api/ai/prompts", {
        auth: true,
        query: category ? { category } : {},
      }).then((r) => r.data!),
    promptVersions: (promptId: string) =>
      apiRequest<ApiResponse<Array<Record<string, unknown>>>>(`/api/ai/prompt-versions/${promptId}`, { auth: true }).then((r) => r.data!),
    contextHistory: (limit = 20) =>
      apiRequest<ApiResponse<Array<Record<string, unknown>>>>("/api/ai/context/history", { auth: true, query: { limit } }).then((r) => r.data!),
    health: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/ai/health", { auth: true }).then((r) => r.data!),
    usage: (days = 7) =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/ai/usage", { auth: true, query: { days } }).then((r) => r.data!),
  },

  aiTools: {
    health: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/ai/tools/health").then((r) => r.data!),
    registry: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/ai/tools/registry", { auth: true }).then((r) => r.data!),
    list: (query: { category?: string; status?: string; source?: string } = {}) =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/ai/tools", { auth: true, query }).then((r) => r.data!),
    get: (toolId: string) =>
      apiRequest<ApiResponse<Record<string, unknown>>>(`/api/ai/tools/${encodeURIComponent(toolId)}`, { auth: true }).then((r) => r.data!),
    execute: (body: { toolId: string; arguments?: Record<string, unknown>; idempotencyKey?: string; approvalId?: string }) =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/ai/tools/execute", { auth: true, method: "POST", body }).then((r) => r.data!),
    history: (query: { toolId?: string; status?: string; limit?: number } = {}) =>
      apiRequest<ApiResponse<Array<Record<string, unknown>>>>("/api/ai/tools/history", { auth: true, query }).then((r) => r.data!),
    approvals: (query: { toolId?: string; limit?: number } = {}) =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/ai/tools/approvals", { auth: true, query }).then((r) => r.data!),
    decideApproval: (approvalId: string, body: { decision: "APPROVED" | "REJECTED"; reason?: string }) =>
      apiRequest<ApiResponse<Record<string, unknown>>>(`/api/ai/tools/approvals/${approvalId}/decide`, { auth: true, method: "POST", body }).then((r) => r.data!),
    policies: (query: { toolId?: string; decision?: string; limit?: number } = {}) =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/ai/tools/policies", { auth: true, query }).then((r) => r.data!),
    denied: (limit = 50) =>
      apiRequest<ApiResponse<Array<Record<string, unknown>>>>("/api/ai/tools/denied", { auth: true, query: { limit } }).then((r) => r.data!),
    highRisk: (limit = 50) =>
      apiRequest<ApiResponse<Array<Record<string, unknown>>>>("/api/ai/tools/high-risk", { auth: true, query: { limit } }).then((r) => r.data!),
    metrics: (days = 7) =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/ai/tools/metrics", { auth: true, query: { days } }).then((r) => r.data!),
  },
};

export type CanonicalGmv = {
  periodDays: number;
  generatedAt: string;
  gmv: number;
  canonicalDefinition: string;
  basis: "payment";
  successfulPayments: number;
  reconciliation: {
    paymentBased: number;
    bookingBased: number;
    completedBookings: number;
    deltaPct: number;
    note: string;
  };
};

export type FinanceConfigEntry = {
  id: string;
  key: string;
  value: number;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FinanceConfigHistoryRow = {
  id: string;
  configKey: string;
  valueBefore: number | null;
  valueAfter: number;
  changedBy: string;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

export type FinanceConfigBundle = {
  entries: FinanceConfigEntry[];
  resolved: {
    operatingExpenseMonthly: number | null;
    cashOnHand: number | null;
    gatewayFeePct: number;
    sources: {
      operatingExpenseMonthly: "db" | "env" | "missing";
      cashOnHand: "db" | "env" | "missing";
      gatewayFeePct: "db" | "env" | "default";
    };
    updatedAt: Record<string, string | null>;
    updatedBy: Record<string, string | null>;
  };
  keys: string[];
};

export type FinanceIntelligence = {
  periodDays: number;
  generatedAt: string;
  assumptions: FinanceConfigBundle["resolved"] & { source: "finance_config" };
  missingInputs: string[];
  canonicalGmv: CanonicalGmv;
  revenue: {
    grossRevenue: number;
    commissionRevenue: number;
    subscriptionRevenue: number;
    netRevenue: number;
    refunds: number;
  };
  cogs: { gatewayFees: number; gatewayFeePct: number; refunds: number; total: number };
  grossMargin: { grossProfit: number; grossMarginPct: number | null; basis: string };
  ebitda: {
    available: boolean;
    operatingExpenseMonthly: number | null;
    ebitda: number | null;
    ebitdaMarginPct: number | null;
    note?: string;
  };
  burnRate: {
    available: boolean;
    netMonthlyCashFlow: number | null;
    monthlyBurn: number | null;
    isProfitable: boolean | null;
    note?: string;
  };
  cashRunway: {
    available: boolean;
    cashOnHand: number | null;
    runwayMonths: number | null;
    status: "profitable" | "finite" | "input_required";
    note?: string;
  };
  forecast: {
    contributionForecastMonthly: number;
    contributionForecastAnnual: number;
    profitForecastMonthly: number | null;
    profitForecastAnnual: number | null;
    note?: string;
  };
  liabilities: { totalLiabilities: number; providerPayable: number };
};

export type CustomerIntelligence = {
  periodDays: number;
  generatedAt: string;
  nps: { score: number | null; source: string; sampleSize: number; definition: string };
  csat: { scorePct: number | null; source: string; sampleSize: number; definition: string };
  complaintTrend: Array<{ date: string; count: number }>;
  customerHappinessScore: number | null;
  serviceSatisfactionIndex: number | null;
  components: {
    avgRating: number | null;
    slaCompliancePct: number | null;
    repeatCustomerRatePct: number | null;
    ratingsCount: number;
    ticketsCount: number;
    surveyNpsCount: number;
    surveyCsatCount: number;
  };
};

export type GrowthIntelligence = {
  periodDays: number;
  generatedAt: string;
  cac: number;
  ltv: number;
  ltvCacRatio: number | null;
  roas: { value: number | null; marketingSpend: number; attributedRevenue: number; spendSource: string };
  paybackMonths: { value: number | null; monthlyArpu: number; grossMarginPct: number };
  campaignRoi: Array<{ code: string; name: string; revenue: number; cost: number; redemptions: number; roi: number | null; costConfigured: boolean }>;
  referralRoi: { roiPct: number | null; referredGmv: number; commissionPaid: number };
  attribution: { channels: Array<{ channel: string; revenue: number; touches: number }>; touchTablePopulated: boolean; note?: string };
  newCustomers: number;
};

export type RiskIntelligence = {
  periodDays: number;
  generatedAt: string;
  unifiedTrustScore: {
    score: number;
    breakdown: { customerTrust: number; partnerTrust: number; paymentRisk: number; fraudRisk: number; complianceRisk: number };
    definition: string;
  };
  fraudConfidence: { score: number; avgRiskScore: number; highRiskUsers: number; openAlerts: number };
  paymentRisk: { score: number; chargebackRatioPct: number; openExposure: number };
  complianceRisk: { score: number; openRequests: number; overdueRequests: number };
  financeHealthScore: number;
  riskTimeline: Array<{ id: string; type: string; severity: string; title: string; at: string }>;
};

export type PlatformFeatureFlag = {
  id: string;
  key: string;
  description: string | null;
  enabled: boolean;
  rolloutPct: number;
  environment: string;
  isKillSwitch: boolean;
};

export type PlatformDispatchPolicyState = { enabled: boolean; source: "FLAG" | "ENVIRONMENT_DEFAULT" };

export type PlatformIntelligence = {
  generatedAt: string;
  /**
   * The backend's own environment: a flag row takes effect there only when its `environment`
   * equals this. Absent on an older backend — treat as unknown, never as "production".
   * `featureFlags` lists rows of every environment; the others are stored but inert.
   */
  runtimeEnvironment?: string;
  /**
   * What dispatch is doing right now on this backend, and why. A missing flag row is not always
   * off: the demo-partner fallback is on by default in demo environments (ENVIRONMENT_DEFAULT).
   * Absent on an older backend — only then is the state derived from the rows.
   */
  dispatchPolicy?: {
    seedPartnerFallback: PlatformDispatchPolicyState;
    strictServiceCapability: PlatformDispatchPolicyState;
  };
  featureFlags: PlatformFeatureFlag[];
  killSwitches: PlatformFeatureFlag[];
  experiments: Array<{ key: string; description?: string; status: string; variants?: unknown[]; source?: string }>;
  experimentMetrics: string[];
  flagCount: number;
  enabledFlags: number;
};

export type RecoveryIntelligence = {
  generatedAt: string;
  backup: {
    health: string;
    totalBackups: number;
    lastSuccessAt: string | null;
    sizeBytes: number;
    successRatePct: number | null;
    retentionDeleted: number;
    backupDir: string;
  };
  disasterRecovery: {
    readinessScore: number;
    rtoTargetSeconds: number;
    rtoLastDrillSeconds: number | null;
    rpoTargetSeconds: number;
    rpoCurrentSeconds: number | null;
    lastRestoreValidation: string | null;
  };
};

export type RecoverySimulation = {
  target: string;
  simulatedAt: string;
  destructive: boolean;
  estimatedRtoSeconds: number;
  estimatedRpoSeconds: number;
  steps: string[];
};

export type CustomerIntel = {
  userId?: string;
  clv?: { lifetimeValue?: number; projectedRevenue?: number };
  churn?: { churn30?: number; churn60?: number; churn90?: number };
  rfm?: { recency?: number; frequency?: number; monetary?: number; segment?: string };
  health?: { score?: number; tier?: string };
  [key: string]: unknown;
};

export type OpsMapProvider = { providerId: string; name: string; lat: number; lng: number; status: "ONLINE" | "BUSY" | "OFFLINE"; lastUpdate: string };
export type OpsMapBooking = { bookingId: string; providerId: string | null; status: string; lat: number; lng: number; eta: number | null };
export type OpsAlertAck = { alertKey: string; acknowledgedBy: string; acknowledgedAt: string; expiresAt: string };
export type OpsMapAlert = { type: string; severity: "warning" | "critical"; bookingId?: string; providerId?: string; message: string };
export type OpsMapData = {
  providers: OpsMapProvider[];
  bookings: OpsMapBooking[];
  geofences: Array<{ id: string; name: string; centerLat: number; centerLng: number; radiusMeters: number; zoneType: string }>;
  heatmap: HeatmapCell[];
  alerts: OpsMapAlert[];
  metrics: { onlineProviders: number; busyProviders: number; totalProviders: number; activeBookings: number; averageEtaMin: number; serviceGaps: number; alerts: number };
};
export type HeatmapCell = { lat: number; lng: number; demand: number; completed: number; cancelled: number; cancellationRate: number; revenue: number; supplyOnline: number; supplyTotal: number; demandScore: number; supplyGap: number };
export type HeatmapData = { gridSize: number; days: number; cells: HeatmapCell[]; totals: { demand: number; revenue: number; supplyOnline: number; cells: number } };
export type WorkforceAnalytics = {
  onlineProviders: number;
  totalProviders: number;
  activeJobs: number;
  attendanceCheckInsToday: number;
  avgAcceptanceRate: number;
  avgCompletionRate: number;
  avgCancellationRate: number;
  avgOnTimeRate: number;
  avgRating: number;
  busyProviders: number;
  idleOnline: number;
  offlineProviders: number;
  openSessions: number;
  jobsByStatus: Array<{ status: string; count: number }>;
  checkInsByDay: Array<{ date: string; count: number }>;
  checkInsByHour: Array<{ hour: number; count: number }>;
  topPartners: Array<{
    id: string;
    name: string;
    city: string | null;
    online: boolean;
    rating: number;
    acceptanceRate: number;
    completionRate: number;
    completedBookings: number;
  }>;
  cities: Array<{ city: string; count: number }>;
  generatedAt: string;
};
export type Geofence = { id: string; name: string; zoneType: string; shape?: string; polygon?: Array<{ lat: number; lng: number }> | null; city: string | null; state: string | null; centerLat: number; centerLng: number; radiusMeters: number; serviceCategories: string[]; surgeMultiplier?: number; isActive: boolean; createdAt: string };
export type GeofenceInput = { name: string; centerLat: number; centerLng: number; radiusMeters: number; city?: string; state?: string; serviceCategories?: string[]; zoneType?: string; shape?: string; polygon?: Array<{ lat: number; lng: number }>; surgeMultiplier?: number };
export type GeofenceEvent = { id: string; geofenceId: string; userId: string | null; providerId: string | null; eventType: string; latitude: number; longitude: number; createdAt: string; geofence?: { name: string; city: string | null } };

export type AdminAdjustmentRow = {
  id: string;
  reference: string;
  type: string;
  direction: string;
  amount: number;
  targetUserId: string | null;
  debitAccountCode: string | null;
  creditAccountCode: string | null;
  reason: string;
  supportingNotes: string | null;
  status: string;
  makerId: string;
  approverId: string | null;
  rejectedReason: string | null;
  journalId: string | null;
  createdAt: string;
  executedAt: string | null;
};

export type AdminAdjustmentInput = {
  type: "CREDIT" | "DEBIT" | "CORRECTION" | "WRITE_OFF" | "LIABILITY_ADJUSTMENT" | "LEDGER_FIX";
  direction: "CREDIT" | "DEBIT";
  amount: number;
  reason: string;
  supportingNotes?: string;
  targetUserId?: string;
  debitAccountCode?: string;
  creditAccountCode?: string;
};

export type AdminBackfillRun = {
  id: string;
  types: string;
  status: string;
  recordsScanned: number;
  recordsBackfilled: number;
  recordsSkipped: number;
  recordsFailed: number;
  createdAt: string;
  completedAt: string | null;
};

export type AdminHCoinExpiryReport = {
  config: { enabled: boolean; expiryDays: number; lastRunAt: string | null };
  runs: Array<{ id: string; coinsExpired: number; walletsAffected: number; rupeeValue: number; createdAt: string }>;
  totals: { coinsExpired: number; breakageRevenue: number };
};

export type AdminInvoiceRow = {
  id: string;
  invoiceNumber: string;
  customer: string;
  email: string;
  service: string;
  amount: number;
  refunded: number;
  status: string;
  date: string;
};
export type AdminInvoicesResponse = {
  invoices: AdminInvoiceRow[];
  pagination: { page: number; limit: number; total: number; hasMore: boolean };
};
export type AdminRevenueReport = {
  streams: { bookings: number; subscriptions: number; giftCards: number };
  counts: { bookings: number; subscriptions: number; giftCards: number };
  grossRevenue: number;
  refunds: number;
  netRevenue: number;
};
export type AdminGiftCardsResponse = {
  cards: { id: string; code: string; amount: number; balance: number; status: string; recipient: string; createdAt: string }[];
  pagination: { page: number; limit: number; total: number; hasMore: boolean };
  stats: { issued: number; redeemed: number; refunded: number; outstanding: number; count: number };
};
export type AdminTransfersResponse = {
  transfers: { id: string; sender: string; recipient: string; amount: number; status: string; createdAt: string }[];
  pagination: { page: number; limit: number; total: number; hasMore: boolean };
  totals: { completedCount: number; completedVolume: number };
};
export type HCoinRule = {
  id: string;
  event: string;
  label: string;
  coins: number;
  isActive: boolean;
};
export type AdminHCoinAnalytics = {
  totalIssued: number;
  totalRedeemed: number;
  totalExpired: number;
  outstanding: number;
  liabilityRupees: number;
  holders: number;
  rules: HCoinRule[];
};

export type AdminFraudUser = {
  userId: string;
  name: string;
  email: string;
  score: number;
  level: string;
  factors: string[];
  isBanned: boolean;
};

export type AdminFrozenCommission = {
  id: string;
  referrerId: string;
  referrer: string;
  email: string;
  amount: number;
  status: string;
  riskScore: number | null;
  frozenAt: string | null;
  createdAt: string;
};

export type AdminFraudAlert = {
  id: string;
  userId: string | null;
  user: string | null;
  email?: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  status: string;
  createdAt: string;
};

export type AdminReferralAnalytics = {
  totalReferrals: number;
  qualified: number;
  pending: number;
  totalCommission: number;
  totalWithdrawn: number;
  leaderboard: { rank: number; name: string; referrals: number; earned: number }[];
  fraudFlags: { userId: string; name: string; email: string; pendingReferrals: number; reason: string }[];
};

export type AdminPartnerReferralOverview = {
  funnel: Record<string, number>;
  reached: {
    invited: number;
    registered: number;
    verified: number;
    training: number;
    active: number;
    firstJob: number;
    qualified: number;
    rewarded: number;
  };
  sources: Array<{ source: string; referrals: number }>;
  topReferrers: Array<{ providerId: string; name: string; referrals: number }>;
  qualification: Record<string, number>;
  conversion: {
    invitedToRegisteredPct: number | null;
    registeredToActivePct: number | null;
    qualifiedPct: number | null;
  };
  economics: {
    released: number;
    releasedCount: number;
    held: number;
    pending: number;
    blocked: number;
    qualifiedAwaitingReward: number;
    rewardAmount: number;
    liabilityEstimate: number;
  };
  riskOpen: number;
};

export type AdminPartnerReferralList = {
  total: number;
  page: number;
  limit: number;
  items: Array<{
    id: string;
    status: string;
    qualificationStatus: string;
    reviewStatus: string;
    successfulJobs: number;
    campaign: string | null;
    source: string;
    signalCount: number;
    referrer: { id: string; name: string; city: string | null };
    referred: { id: string | null; name: string; city: string | null; lifecycle: string | null };
    reward: { status: string; amount: number } | null;
    createdAt: string;
  }>;
};

export type AdminPlanRow = {
  id: string;
  name: string;
  tier: string;
  interval: "MONTHLY" | "QUARTERLY" | "YEARLY";
  price: number;
  currency: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  benefits: { id: string; label: string; type?: string | null; value?: number | null }[];
  _count?: { subscriptions: number };
  activeSubscribers?: number;
  totalSubscribers?: number;
};
export type AdminPlanSummary = {
  total: number;
  active: number;
  inactive: number;
  liveMembers: number;
  expiringSoon: number;
  churnedThisMonth: number;
  liveMrr: number;
};
export type AdminPlanInput = {
  name: string;
  interval: "MONTHLY" | "QUARTERLY" | "YEARLY";
  price: number;
  tier?: string;
  description?: string;
  benefits?: string[];
  sortOrder?: number;
};
export type AdminSubscriberRow = {
  id: string;
  status: string;
  startsAt: string | null;
  expiresAt: string | null;
  autoRenew: boolean;
  cancelledAt: string | null;
  plan: { name: string; interval: string; price: number };
  user: { id?: string; firstName: string | null; lastName: string | null; email: string };
};
export type AdminSubscriptionRevenue = {
  totalRevenue: number;
  monthRevenue: number;
  activeSubscribers: number;
  invoiceCount: number;
};

export type AdminQueueBooking = {
  bookingId: string;
  bookingNumber: string;
  position: number;
  queuePriority: string;
  queuePosition: number | null;
  priorityScore: number | null;
  estimatedWaitTimeMs: number | null;
  queuedAt: string | null;
  waitTimeMs: number | null;
  user: string;
  service: string;
  scheduledDate: string | null;
};

export type AdminQueueAnalytics = {
  pendingHigh: number;
  pendingNormal: number;
  avgWaitHighMs: number;
  avgWaitNormalMs: number;
  historicalAvgWaitHighMs: number;
  historicalAvgWaitNormalMs: number;
  totalAssignedHigh: number;
  totalAssignedNormal: number;
  queueByMembership: Record<string, number>;
  averageWaitTimeMs: number;
};

export type AdminPriorityAnalytics = {
  priorityServedCount: number;
  highPriorityBookings: number;
  normalPriorityBookings: number;
  premiumSharePct: number;
};

export type AdminDispatchSnapshot = {
  queueHealth: {
    pendingJobs: number;
    inFlight: number;
    acceptedJobs: number;
    exhaustedJobs: number;
    totalJobs: number;
  };
  dispatchMetrics: {
    dispatchAttempts: number;
    avgDispatchAttemptsPerJob: number;
    acceptanceRatePct: number;
    averageDispatchTimeMs: number;
    queueWaitTimeMs: number;
    autoReassignCount: number;
  };
  assignmentFunnel: {
    created: number;
    dispatched: number;
    accepted: number;
    exhausted: number;
    conversionPct: number;
  };
};

export type AdminQueueDesk = {
  queue: AdminQueueAnalytics;
  priority: AdminPriorityAnalytics;
  assignmentQueue: AdminQueueBooking[];
  dispatch: AdminDispatchSnapshot;
};

export type AdminCashbackTopUser = {
  userId: string;
  name: string;
  totalCashback: number;
};

export type AdminCashbackDashboard = {
  totalCredited: number;
  totalTransactions: number;
  thisMonthCredited: number;
  thisMonthCount: number;
  pendingLiability: number;
  pendingCount: number;
  topUsers: AdminCashbackTopUser[];
};

export type AdminCashbackPctBucket = {
  cashbackPct: number;
  total: number;
  count: number;
};

export type AdminCashbackLiability = {
  netLiability: number;
  creditedTotal: number;
  creditedCount: number;
  reversedTotal: number;
  reversedCount: number;
  byCashbackPct: AdminCashbackPctBucket[];
};

export type AdminCashbackReportRow = {
  id: string;
  userId: string;
  bookingId: string;
  user: string;
  email: string;
  bookingNumber: string;
  amount: number;
  cashbackPct: number;
  settledAmount: number;
  status: string;
  createdAt: string;
};

export type AdminCashbackReports = {
  reports: AdminCashbackReportRow[];
  total: number;
  page: number;
  totalAmount: number;
};

export type AdminCampaignRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  status: string;
  premiumOnly: boolean;
  discountPct: number | null;
  discountAmount: number | null;
  redemptionCount: number;
  maxRedemptions: number | null;
  startsAt: string | null;
  expiresAt: string | null;
};

export type AdminMembershipCouponRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  discountPct: number | null;
  discountAmount: number | null;
  redemptionCount: number;
  maxRedemptions: number | null;
  perUserLimit: number;
  planRestricted: string[];
  startsAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  campaign?: { name: string } | null;
};

export type AdminMembershipCouponInput = {
  code: string;
  name: string;
  discountPct?: number;
  planRestricted?: string[];
  maxRedemptions?: number;
  perUserLimit?: number;
  expiresAt?: string;
  status?: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
};

export type AdminMembershipCouponBulkInput = {
  prefix: string;
  count: number;
  name: string;
  discountPct?: number;
  planRestricted?: string[];
  status?: "ACTIVE";
};

export type AdminMembershipCouponAnalytics = {
  issued: number;
  active: number;
  paused: number;
  draft: number;
  archived: number;
  expiredLive: number;
  redeemed: number;
  conversionPct: number;
  avgDiscountPct: number;
  byPlan: Record<string, number>;
  revenueImpact: {
    discountGiven: number;
    revenueBefore: number;
    revenueAfter: number;
  };
};

export type AdminCampaignInput = {
  code: string;
  name: string;
  description?: string;
  type: "COUPON" | "PROMOTION" | "BUNDLE" | "OFFER";
  premiumOnly?: boolean;
  discountPct?: number;
  discountAmount?: number;
  minOrderAmount?: number;
  maxRedemptions?: number;
  startsAt?: string;
  expiresAt?: string;
  status?: "DRAFT" | "ACTIVE" | "DISABLED" | "EXPIRED";
};

export type AdminSupportTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  category: string;
  priorityLevel: string;
  status: string;
  slaDueAt: string | null;
  slaBreached: boolean;
  responseTimeMs: number | null;
  user: string | null;
  email?: string;
  providerName?: string | null;
  source?: "customer" | "partner";
  bookingNumber?: string | null;
  createdAt: string;
};

export type AdminSupportTicketDetail = AdminSupportTicket & {
  description: string;
  providerName?: string | null;
  bookingId?: string | null;
  bookingNumber?: string | null;
  attachments: string[];
  messages: Array<{
    id: string;
    body: string;
    authorRole: string;
    isInternal: boolean;
    createdAt: string;
  }>;
};

export type AdminServiceRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  detailedDescription: string | null;
  category: string;
  subcategory: string | null;
  basePrice: number;
  minPrice: number | null;
  maxPrice: number | null;
  estimatedDuration: number;
  icon: string | null;
  isActive: boolean;
  isFeatured: boolean;
  isPopular: boolean;
  premiumOnly?: boolean;
  bookingCount: number;
  availableCities: string[];
  createdAt: string;
  rating?: number | null;
  reviewCount?: number;
  pricingModel?: string;
  thumbnail?: string | null;
  images?: string[];
  includedServices?: string[];
  excludedServices?: string[];
  requirements?: string[];
  /** Full admin view of the booking/content config (null when none). */
  catalogConfig?: ServiceCatalogConfig | null;
  /** Stored config failed validation and is being ignored by the customer app. */
  catalogConfigInvalid?: boolean;
  /** What is still missing — computed by the backend. */
  configGaps?: string[];
  configSections?: { id: string; label: string; status: "ok" | "warn" | "missing"; issues: string[] }[];
  publishBlocked?: { code: string; path: string; message: string }[];
  bookable?: boolean;
  serviceCode?: string | null;
  /** Operational identifier (ops / ERP). Admin-only, unique when set. */
  internalServiceCode?: string | null;
  displayName?: string | null;
  shortName?: string | null;
  capabilityProfile?: string;
  lifecycleStatus?: string;
  /** Lifecycle moves the backend will accept from the current state. */
  allowedTransitions?: string[];
  configStatus?: string;
  isCustomerVisible?: boolean;
  isBookable?: boolean;
  version?: number;
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoKeywords?: string | null;
  ownerTeam?: string | null;
  operationsNotes?: string | null;
  categoryId?: string | null;
  subcategoryId?: string | null;
  taxonomy?: { category: { slug: string; name: string } | null; subcategory: { slug: string; name: string } | null };
  updatedAt?: string;
  publishedAt?: string | null;
  publishedBy?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  lastReviewedAt?: string | null;
  duration?: ServiceDuration;
  /** D1: DURATION reserves the appointment length; FIXED keeps the 60-minute block (turnaround services). */
  partnerSlotPolicy?: "DURATION" | "FIXED";
  /** Minutes a default booking reserves on the partner calendar under the policy (incl. ±30-min buffers). */
  reservedSlotMinutes?: number;
};

/** Mirror of backend ResolvedDuration (lib/service-catalog-config.ts resolveServiceDuration). */
export type ServiceDuration = {
  serviceMinutes: number;
  addonMinutes: number;
  preparationMinutes: number;
  cleanupMinutes: number;
  totalMinutes: number;
  customerEstimate: { estimatedMinutes: number; minMinutes: number | null; maxMinutes: number | null };
};

export type ServiceTaxonomyTree = {
  categories: Array<{
    id: string;
    slug: string;
    name: string;
    shortName: string | null;
    sortOrder: number;
    isActive: boolean;
    operationalCategories: string[];
    serviceCount: number;
    subcategories: Array<{ id: string; slug: string; name: string; sortOrder: number; isActive: boolean; serviceCount: number }>;
  }>;
};

export type ServiceVersionRow = {
  version: number;
  status: string;
  createdBy: string | null;
  createdAt: string;
  publishedAt: string | null;
  snapshot: Record<string, unknown>;
};

export const REQUESTABLE_LIFECYCLES = ["DRAFT", "READY_FOR_REVIEW", "ACTIVE", "PAUSED", "DEPRECATED", "ARCHIVED"] as const;
export type RequestableLifecycle = (typeof REQUESTABLE_LIFECYCLES)[number];

/** Mirror of apps/backend src/lib/service-catalog-config.ts serviceCatalogConfigSchema. */
/** Phase 06 — mirror of backend RequirementItemInfo + admin row fields. */
export type RequirementItemRow = {
  id: string;
  code: string;
  kind: "MATERIAL" | "EQUIPMENT" | "CUSTOMER_PRECONDITION";
  name: string;
  customerLabel: string | null;
  description: string | null;
  isActive: boolean;
  version: number;
  activeAssignments?: number;
};

/** Phase 06 — mirror of backend requirementAssignmentSchema (lib/service-requirements.ts). */
export type RequirementAssignment = {
  id: string;
  itemCode: string;
  responsibility: "CUSTOMER" | "PROFESSIONAL" | "PLATFORM" | "SHARED" | "UNKNOWN";
  procurement?: "CUSTOMER" | "PROFESSIONAL" | "PLATFORM";
  charge?: "INCLUDED" | "CHARGEABLE" | "SEPARATE_QUOTE" | "NOT_APPLICABLE";
  optional?: boolean;
  enforcement?: "INFORMATIONAL" | "WARNING" | "REQUIRED_BEFORE_BOOKING" | "REQUIRED_BEFORE_ARRIVAL" | "REQUIRED_AT_START";
  verification?: "NONE" | "CUSTOMER_ATTESTATION" | "PARTNER_CHECK";
  quantity?: number;
  unit?: string;
  quantityBasis?: "PER_BOOKING" | "PER_SELECTED_UNIT";
  when?: { variantIds?: string[]; addonIds?: string[]; minQuantity?: number };
  customerNote?: string;
  customerWarning?: string;
  partnerInstructions?: string;
  handlingNote?: string;
  internalNote?: string;
  sortOrder?: number;
  active?: boolean;
};

/** Phase 10 §7 — mirror of backend executionStepSchema (lib/service-execution.ts). */
export type ExecutionStepConfig = {
  id: string;
  title: string;
  description?: string;
  kind: "PREPARATION" | "WORK" | "SAFETY_CHECK" | "QUALITY_CHECK" | "CLOSEOUT";
  mandatory?: boolean;
  /** A mandatory step must be NOT_SKIPPABLE (the backend refuses anything else). */
  skipPolicy?: "NOT_SKIPPABLE" | "SKIP_WITH_REASON";
  evidence?: "NONE" | "NOTE" | "PHOTO" | "BEFORE_AFTER_PHOTOS";
  estimatedMinutes?: number;
  dependsOn?: string[];
  /** A requirement assignment id of this service that must be SATISFIED before the step may start. */
  safetyRequirement?: string;
  ppe?: string[];
  warnings?: string[];
  materials?: string[];
  equipment?: string[];
  when?: { variantIds?: string[]; addonIds?: string[]; minQuantity?: number };
  sortOrder?: number;
  active?: boolean;
};

export type WarrantyIssueType = "QUALITY" | "INCOMPLETE" | "DAMAGE" | "BEHAVIOUR" | "NO_SHOW" | "BILLING" | "OTHER";

export type ServiceCatalogConfig = {
  bookingMode?: "STANDARD" | "HOURLY";
  comingSoon?: boolean;
  sameDayAvailable?: boolean;
  video?: string;
  quantity?: {
    type: "NONE" | "HOUR" | "UNIT" | "SEAT" | "ROOM" | "BATHROOM" | "SOFA_SEAT" | "MATTRESS" | "WINDOW" | "FAN" | "APPLIANCE" | "SQ_FT" | "AREA" | "LOAD" | "ITEM" | "PACKAGE";
    unitLabel: string;
    unitLabelPlural?: string;
    min: number;
    max: number;
    step?: number;
    default?: number;
    unitPrice?: number;
    minimumCharge?: number;
    durationPerUnitMin?: number;
    required?: boolean;
  };
  variants?: {
    id: string;
    name: string;
    price: number;
    durationMin?: number;
    description?: string;
    inclusions?: string[];
    exclusions?: string[];
    requirements?: string[];
    sortOrder?: number;
    audiences?: ("women" | "men" | "girls" | "boys" | "senior-women" | "senior-men")[];
    professionalPreferences?: ("NO_PREFERENCE" | "FEMALE" | "MALE")[];
    quantity?: { unitPrice?: number; min?: number; max?: number };
    active?: boolean;
  }[];
  /** When variants exist, one must be chosen (no silent base-price fallback). */
  variantRequired?: boolean;
  audiences?: ("women" | "men" | "girls" | "boys" | "senior-women" | "senior-men")[];
  eligibility?: string;
  materialPolicy?: "CUSTOMER_PROVIDED" | "PROFESSIONAL_PROVIDED" | "PACKAGE_INCLUDED" | "MIXED" | "NOT_REQUIRED" | "NOT_SPECIFIED";
  equipmentPolicy?: "CUSTOMER_PROVIDED" | "PROFESSIONAL_PROVIDED" | "PACKAGE_INCLUDED" | "MIXED" | "NOT_REQUIRED" | "NOT_SPECIFIED";
  sparePartsPolicy?: "NOT_APPLICABLE" | "INCLUDED" | "CUSTOMER_PAYS" | "APPROVAL_REQUIRED";
  preparation?: string[];
  safetyNotes?: string[];
  faqs?: { q: string; a: string }[];
  addons?: {
    id: string;
    name: string;
    price: number;
    durationMin?: number;
    description?: string;
    quantityAllowed?: boolean;
    maxQuantity?: number;
    active?: boolean;
    compatibleVariantIds?: string[];
    requiresAddonIds?: string[];
    conflictsWithAddonIds?: string[];
    sortOrder?: number;
  }[];
  /** Phase 06 assignments (mirrored to service_requirements by the backend in the same save). */
  requirements?: RequirementAssignment[];
  /** Server-attached catalogue facts for assigned items; read-only (the backend strips it from writes). */
  requirementItems?: Record<string, { code: string; kind: RequirementItemRow["kind"]; name: string; customerLabel?: string | null; isActive: boolean }>;
  duration?: {
    estimatedMin?: number;
    minMin?: number;
    maxMin?: number;
    unit?: "MINUTE" | "HOUR";
    preparationMin?: number;
    serviceMin?: number;
    cleanupMin?: number;
    totalSlotMin?: number;
  };
  availability?: {
    sameDay?: boolean;
    minimumLeadTimeMinutes?: number;
    maximumAdvanceDays?: number;
  };
  bookingRules?: { cancellationPolicy?: string; reschedulePolicy?: string };
  /**
   * Phase 11 hard matching gates (backend lib/provider-capability.ts). `requiredSkills` is the legacy
   * comma list matched against service categories; `skills` is the typed list.
   */
  providerRequirements?: {
    requiredSkills?: string[];
    skillLevel?: string;
    trainingRequired?: boolean;
    certifications?: string[];
    kycRequired?: boolean;
    verifiedProfessionalRequired?: boolean;
    experienceYears?: number;
    backgroundCheckRequired?: boolean;
    /** Academy module slugs a professional must have completed to be matched. */
    trainingModules?: string[];
    skills?: { code: string; minLevel?: "BASIC" | "SKILLED" | "EXPERT"; verifiedOnly?: boolean }[];
    requiredCertifications?: { type: string; verificationRequired?: boolean }[];
    requiredEquipment?: { type: string; requirement: "REQUIRED" | "OPTIONAL" | "NOT_REQUIRED" | "CUSTOMER_PROVIDED" }[];
    requiredInsurance?: { type: string }[];
    languages?: { code: string; minProficiency?: "BASIC" | "CONVERSATIONAL" | "FLUENT" | "NATIVE" }[];
  };
  /** Phase 10 §7 — the execution plan (work steps), versioned with the service. */
  execution?: { steps: ExecutionStepConfig[] };
  /** Phase 10 §9 — structured safety content; `safetyNotes` above is the legacy free text. */
  safety?: {
    information?: string;
    warnings?: string[];
    prohibitedConditions?: string[];
    customerRequirements?: string[];
    providerRequirements?: string[];
    medicalDisclaimer?: string;
    emergencyProtocol?: string;
    ppe?: string[];
    chemicalRestrictions?: string[];
    incidentProtocol?: string;
  };
  /** Phase 10 §11 — warranty policy, frozen per booking. Once present it replaces `quality.warrantyDays`. */
  warranty?: {
    enabled?: boolean;
    durationDays?: number;
    startEvent?: "COMPLETION" | "CONFIRMATION";
    eligibleIssueTypes?: WarrantyIssueType[];
    exclusions?: string[];
    proofRequired?: boolean;
    reworkFirst?: boolean;
    refundAllowed?: boolean;
    damagePolicy?: string;
    guarantee?: string;
  };
  rework?: { fee?: "WAIVED" | "QUOTED"; sameProviderPreferred?: boolean; windowDays?: number };
  /** Phase 10 — age policy evaluated at booking. A mode other than NONE needs its matching number. */
  customerPolicy?: {
    age?: {
      mode: "NONE" | "MINIMUM_AGE" | "ADULT_ONLY" | "GUARDIAN_REQUIRED";
      minimumAge?: number;
      adultAge?: number;
      guardianMinimumAge?: number;
    };
    version?: number;
  };
  /**
   * Mirrors `payment` / `quality` / `matching` in the backend's catalog-config schema
   * (apps/backend/src/lib/service-catalog-config.ts). This type is a HAND-WRITTEN MIRROR — the apps
   * do not import backend types — so a field the backend accepts is invisible here until it is
   * added. The service editor wrote splitPaymentAllowed, membershipAllowed, the quality checklist
   * and the whole matching block against a mirror that stopped at two payment flags, which left the
   * admin typecheck red (14 errors) and `next build` unable to run. Field sets below are copied
   * from that schema; the backend strips `matching` from customer-facing responses.
   */
  payment?: {
    paymentRequired?: boolean;
    paymentTiming?: "BEFORE_DISPATCH" | "AFTER_COMPLETION" | "SPLIT";
    walletAllowed?: boolean;
    couponAllowed?: boolean;
    membershipAllowed?: boolean;
    splitPaymentAllowed?: boolean;
    invoiceRequired?: boolean;
    refundPolicy?: string;
  };
  matching?: {
    strategy?: string;
    skillWeight?: number;
    distanceWeight?: number;
    ratingWeight?: number;
    availabilityWeight?: number;
    responseWeight?: number;
    completionWeight?: number;
    preferredProvider?: boolean;
  };
  inspectionRequired?: boolean;
  content?: {
    customerSummary?: string;
    valueProposition?: string;
    highlights?: string[];
    keyBenefits?: string[];
    limitations?: string[];
    importantNotes?: string[];
    customerDisclosures?: string[];
    process?: string[];
  };
  media?: {
    heroImage?: string;
    heroVideo?: string;
    gallery?: string[];
    instructional?: string[];
    beforeAfter?: { before: string; after: string; caption?: string }[];
    documents?: { label: string; url: string }[];
  };
  quality?: {
    checklist?: string[];
    completionCriteria?: string[];
    proofRequired?: boolean;
    beforeAfterPhotos?: boolean;
    customerConfirmation?: boolean;
    /** The professional must attest the completion criteria were met before the job can complete. */
    professionalConfirmation?: boolean;
    warrantyDays?: number;
    revisitPolicy?: string;
    complaintWindowDays?: number;
    /** Hours the customer has to confirm or report an issue (1–720; unset = platform 48h). */
    confirmationWindowHours?: number;
    notApplicable?: boolean;
  };
  seo?: { noindex?: boolean; canonicalUrl?: string };
  /**
   * Fields this console does not edit (coverage, materials, equipment, safety, trust, …) still
   * arrive here and are preserved on save — the editor merges onto the stored document.
   */
  [key: string]: unknown;
};

export type ServiceCatalogSummary = {
  total: number;
  active: number;
  inactive: number;
  featured: number;
  premium: number;
  popular: number;
  categories: Array<{ category: string; count: number }>;
};

export type ServiceInput = {
  name: string;
  description: string;
  category: string;
  basePrice: number;
  estimatedDuration: number;
  subcategory?: string;
  detailedDescription?: string;
  minPrice?: number;
  maxPrice?: number;
  icon?: string;
  isActive?: boolean;
  isFeatured?: boolean;
  premiumOnly?: boolean;
  availableCities?: string[];
  slug?: string;
  pricingModel?: string;
  thumbnail?: string;
  images?: string[];
  includedServices?: string[];
  excludedServices?: string[];
  requirements?: string[];
  /** null clears the configuration. */
  catalogConfig?: ServiceCatalogConfig | null;
  capabilityProfile?: string;
  displayName?: string;
  shortName?: string;
  serviceCode?: string;
  internalServiceCode?: string;
  /** Customer taxonomy by slug. null clears it. */
  categorySlug?: string | null;
  subcategorySlug?: string | null;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  ownerTeam?: string;
  operationsNotes?: string;
  /** Optimistic concurrency: the version the editor loaded. A mismatch is 409 VERSION_CONFLICT. */
  expectedVersion?: number;
  /** Why this change was made — recorded with before/after values in the pricing audit trail. */
  changeReason?: string;
  partnerSlotPolicy?: "DURATION" | "FIXED";
};

export type AdminCustomerRow = AdminCustomer;
export type AdminProviderRow = AdminProvider;
export type AdminBookingRow = AdminBooking;

export type ObservabilityAlert = {
  id: string;
  source: "ops" | "finance";
  alertType: string;
  severity: string;
  message: string;
  metadata: unknown;
  resolved: boolean;
  createdAt: string;
  resolvedAt: string | null;
};

/** Shape returned by GET /api/vision/status (verified against the live backend). */
export type VisionStatus = {
  observationMode: "REAL_PROVIDER" | "FALLBACK";
  totalAnalyses: number;
  recentAnalyses: number;
  successCount: number;
  failureCount: number;
  geminiCount: number;
  fallbackCount: number;
  lastAnalysisAt: string | null;
  averageLatency: number | null;
};

export type ObservabilityHealth = {
  timestamp: string;
  instanceId: string;
  wsInstanceId: string;
  sentry: { enabled: boolean };
  serviceHealth: {
    database: { status: string; latencyMs?: number };
    redis: { status: string; topology: string; connectedClients: number; hitRate: number };
    websocket: { status: string; totalConnections: number; totalRooms: number; redisFanout: boolean };
    queue: { status: string; assignmentBacklog: number };
    payments: { status: string; pending: number };
    finance: { status: string; lastIntegrityStatus: string; openAlerts: number };
  };
  alerts: { opsOpen: number; financeOpen: number };
  logs: { total: number; last24h: number };
  tracing: { bufferSize: number; domainCounts: Record<string, number> };
};

export type ComplianceRequest = {
  id: string;
  userId: string;
  requestType: string;
  status: string;
  submittedAt: string;
  dueDateAt: string;
  completedAt?: string | null;
  rejectionReason?: string | null;
  user?: { email?: string; firstName?: string; lastName?: string };
};

export type LogSearchQuery = {
  requestId?: string;
  traceId?: string;
  userId?: string;
  bookingId?: string;
  paymentId?: string;
  category?: string;
  level?: string;
  search?: string;
  cursor?: string;
  limit?: number;
  startDate?: string;
  endDate?: string;
};

export type LogSearchResult = {
  logs: Array<{
    id: string;
    level: string;
    category: string;
    message: string;
    requestId: string | null;
    traceId: string | null;
    userId: string | null;
    bookingId: string | null;
    paymentId: string | null;
    createdAt: string;
  }>;
  nextCursor: string | null;
  hasMore: boolean;
};

export type CommandTile<T> =
  | { status: "ok"; data: T }
  | { status: "unauthorized" }
  | { status: "unavailable"; reason: string };

export type CommandCenterOverview = {
  generatedAt: string;
  partners: CommandTile<{ total: number; active: number; suspended: number }>;
  applications: CommandTile<{ openLeads: number; pendingProviders: number }>;
  availability: CommandTile<{ online: number; available: number }>;
  jobs: CommandTile<{ active: number; today: number }>;
  earnings: CommandTile<{ todayCount: number; todayNet: number }>;
  payouts: CommandTile<{ pending: number }>;
  kyc: CommandTile<{ pendingDocs: number; expiring: number }>;
  risk: CommandTile<{ review: number }>;
  safety: CommandTile<{ openIncidents: number; sosOpen: number }>;
  referrals: CommandTile<{ pendingQualification: number }>;
  automation: CommandTile<{ live: number; shadow: number; outboxPending: number; dlq: number }>;
};

export type AuditLogQuery = {
  action?: string;
  actor?: string;
  resource?: string;
  resourceId?: string;
  traceId?: string;
  requestId?: string;
  correlationId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  cursor?: string;
  limit?: number;
};

export type AuditLogRow = {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  actor: string | null;
  actorType: string;
  changesSummary: string | null;
  status: string;
  traceId: string;
  deviceId: string | null;
  createdAt: string;
  errorMessage: string | null;
};

export type AuditLogResult = {
  items: AuditLogRow[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type ProductionValidationReport = {
  status: "PASS" | "FAIL";
  score: number;
  checks: Array<{ domain: string; name: string; status: string; details?: string }>;
  reports: Record<string, unknown>;
  beforeScore: Record<string, number>;
  afterScore: Record<string, number>;
};

export type WeatherCity = {
  city: string;
  available: boolean;
  tempC?: number;
  feelsLikeC?: number;
  humidity?: number;
  windSpeedKmh?: number;
  rain1hMm?: number;
  condition?: string;
  description?: string;
  severity?: "clear" | "mild" | "moderate" | "severe" | "extreme";
  surgeMultiplier?: number;
  etaFactor?: number;
  vendorImpact?: { impact: "none" | "reduced" | "severe"; factor: number; reason: string };
  alerts?: Array<{ type: string; level: "advisory" | "warning" | "severe"; message: string }>;
};
export type WeatherOverview = {
  available: boolean;
  reason?: string;
  generatedAt?: string;
  citiesTracked?: number;
  citiesWithData?: number;
  severeAreas?: number;
  cities: WeatherCity[];
};

export type ZoneAnalyticsRow = {
  id: string; name: string; city: string | null; zoneType: string; shape: string;
  surgeMultiplier: number; supply: number; demand: number; revenue: number; utilization: number;
  completed: number; cancelled: number;
};
export type ZoneAnalytics = {
  zones: ZoneAnalyticsRow[];
  totals: { zones: number; supply: number; demand: number; revenue: number };
};

export type PartnerLeadStatus =
  | "NEW"
  | "CONTACTED"
  | "INTERESTED"
  | "APPLICATION_STARTED"
  | "APPLICATION_SUBMITTED"
  | "KYC_PENDING"
  | "VERIFICATION"
  | "TRAINING"
  | "APPROVED"
  | "ACTIVATED"
  | "DORMANT"
  | "REJECTED"
  | "DUPLICATE"
  | "INVALID"
  | "WITHDRAWN";

export type PartnerLeadSource =
  | "APNA"
  | "JOBHAI"
  | "REFERRAL"
  | "RWA"
  | "CONTRACTOR"
  | "LOCAL_SHOP"
  | "DIRECT"
  | "SOCIAL"
  | "CAMPAIGN"
  | "PARTNER_REFERRAL";

export type PartnerLead = {
  id: string;
  source: PartnerLeadSource;
  sourceCampaign?: string | null;
  channel?: string | null;
  name: string;
  phone: string;
  email?: string | null;
  skillInterest?: string | null;
  city?: string | null;
  zone?: string | null;
  status: PartnerLeadStatus;
  assignedToAdminId?: string | null;
  nextFollowUpAt?: string | null;
  followUpReason?: string | null;
  preferredContactMethod?: string | null;
  leadScore: number;
  lastActivityAt?: string | null;
  notes?: string | null;
  createdAt: string;
};

export type PartnerLeadCreateInput = {
  name: string;
  phone: string;
  email?: string;
  source: PartnerLeadSource;
  sourceCampaign?: string;
  channel?: string;
  skillInterest?: string;
  city?: string;
  zone?: string;
  notes?: string;
  assignedToAdminId?: string;
  forceCreate?: boolean;
  duplicateJustification?: string;
};

export type PartnerDuplicateMatch = {
  type: "lead" | "provider" | "user";
  id: string;
  name: string;
  phoneMasked: string;
  status: string;
  skill?: string | null;
  city?: string | null;
  source?: string | null;
  lastActivityAt: string | null;
};

export type PartnerLeadListQuery = {
  status?: PartnerLeadStatus;
  source?: PartnerLeadSource;
  assignedTo?: string;
  city?: string;
  zone?: string;
  skill?: string;
  campaign?: string;
  minScore?: number;
  maxScore?: number;
  createdFrom?: string;
  createdTo?: string;
  lastActivityFrom?: string;
  lastActivityTo?: string;
  followUp?: "today" | "overdue" | "upcoming" | "tomorrow" | "none";
  stalled?: boolean | string;
  noNextAction?: boolean | string;
  search?: string;
  page?: number;
  limit?: number;
};

export type PartnerLeadListResult = {
  leads: PartnerLead[];
  total: number;
  page: number;
  limit: number;
};

export type PartnerLeadDetail = PartnerLead & {
  activities: Array<{
    id: string;
    type: string;
    title: string;
    description?: string | null;
    actorId?: string | null;
    createdAt: string;
  }>;
  statusHistory: Array<{
    id: string;
    fromStatus?: PartnerLeadStatus | null;
    toStatus: PartnerLeadStatus;
    reason?: string | null;
    createdAt: string;
  }>;
  provider?: { id: string; registrationStatus: string; city?: string | null; serviceCategories: string[] } | null;
  mergedIntoLeadId?: string | null;
  duplicateOfLeadId?: string | null;
  duplicateCandidates?: PartnerDuplicateMatch[];
};

export type PartnerLeadMergeField = {
  key: string;
  label: string;
  primaryValue: string | null;
  duplicateValue: string | null;
  shared: boolean;
  conflict: boolean;
  suggested: "primary" | "duplicate";
  critical: boolean;
};

export type PartnerLeadMergePreview = {
  primary: PartnerLead;
  duplicate: PartnerLead;
  fields: PartnerLeadMergeField[];
  conflicts: PartnerLeadMergeField[];
  blocking: string[];
  alreadyMerged: boolean;
};

export type PartnerQueueResult<T> = { items: T[]; total: number; page: number; limit: number };
export type PartnerApplicationRow = {
  providerId: string;
  leadId: string | null;
  name: string;
  city: string | null;
  skill: string | null;
  source: string | null;
  registrationStatus: string;
  leadStatus: string | null;
  pipeline: string;
  submittedAt: string | null;
};
export type PartnerVerificationRow = {
  providerId: string;
  leadId: string | null;
  name: string;
  city: string | null;
  status: string;
  kyc: string;
  documents: string;
  background: string | null;
  assessment: string;
};
export type PartnerApprovalRow = {
  providerId: string;
  leadId: string | null;
  name: string;
  city: string | null;
  skill: string | null;
  registrationStatus: string;
  status: string;
  assessmentPassed: boolean;
  trainingComplete: boolean;
  submittedAt: string | null;
  rejectionReason: string | null;
};
export type AcquisitionSpendRow = {
  id: string;
  source: PartnerLeadSource;
  campaign?: string | null;
  periodStart: string;
  periodEnd: string;
  amount: number;
  currency: string;
  notes?: string | null;
};
export type AcquisitionSpendInput = {
  source: PartnerLeadSource;
  campaign?: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  notes?: string;
};

export type PartnerLeadSourceMetric = {
  source: PartnerLeadSource;
  leads: number;
  applications: number;
  kycStarted: number;
  verified: number;
  training: number;
  activated: number;
  active: number;
  activationRate: number;
  applicationRate?: number;
  spend?: number | null;
  costPerActivation?: number | null;
};

export type PartnerAcquisitionDashboard = {
  range?: "7d" | "30d" | "90d";
  historyLimited?: boolean;
  historyNote?: string | null;
  kpis: {
    totalLeads: number;
    newToday: number;
    applications: number;
    verified: number;
    training: number;
    activated: number;
    activePartners: number;
    conversionRate: number;
    followUpToday: number;
    followUpOverdue: number;
    followUpTomorrow?: number;
    stalled?: number;
    noNextAction?: number;
  };
  kpiDeltas?: { leads: number | null; applications: number | null; activated: number | null; previousPeriodDays: number };
  trends: {
    conversion7Day: number;
    conversion30Day: number;
    series?: Array<{ date: string; leads: number; applications: number; activated: number }>;
  };
  cost?: {
    available: boolean;
    spend: number | null;
    cpl: number | null;
    costPerApplication: number | null;
    costPerActivation: number | null;
    activationRate: number;
    note: string | null;
  };
  funnel: Array<{ key: string; label: string; count: number }>;
  sources: PartnerLeadSourceMetric[];
  recentActivity: Array<{
    id: string;
    leadId: string;
    leadName: string;
    leadStatus: PartnerLeadStatus;
    type: string;
    title: string;
    description?: string | null;
    createdAt: string;
  }>;
};

export type PartnerActivationChecklist = {
  checks: Record<string, boolean>;
  items: Array<{
    key: string;
    label: string;
    description: string;
    category: string;
    complete: boolean;
  }>;
  ready: boolean;
  missing: string[];
  missingLabels: string[];
  completedCount: number;
  totalCount: number;
  progressPercent: number;
  completedModules: number;
  requiredModules: number;
  suggestedChangeStep?: string;
  suggestedChangeStepLabel?: string;
};
