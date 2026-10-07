/** A single field-level validation detail, or a plain message string. */
export type ApiErrorDetail = string | { field?: string; message: string; code?: string };

export type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  message?: string;
  details?: ApiErrorDetail[];
  retryAfter?: number;
};

export type Paginated<T> = T & {
  total: number;
  page: number;
  limit?: number;
};

export type PartnerUser = {
  id: string;
  email: string;
  phoneNumber: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImage: string | null;
  role: "CUSTOMER" | "VENDOR" | "PROVIDER" | "ADMIN";
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  isActive?: boolean;
  isBanned?: boolean;
  createdAt?: string;
};

export type ProviderProfile = {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phoneNumber: string | null;
  profileImage: string | null;
  businessName: string | null;
  bio: string | null;
  city: string | null;
  rating: number;
  totalReviews: number;
  totalBookings: number;
  completedBookings: number;
  completionRate: number;
  responseRate: number;
  onTimeRate: number;
  avgResponseTime: number;
  cancellationRate: number;
  acceptanceRate: number;
  walletBalance: number;
  totalEarnings: number;
  isOnline: boolean;
  onlineSince: string | null;
  currentStatus?: string;
  pausedAt?: string | null;
  pauseReason?: string | null;
  timezone?: string;
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
  workingDays: string[];
  maxJobsPerDay?: number | null;
  maxConcurrentJobs?: number;
  breakWindows?: Array<{ start: string; end: string }>;
  serviceRadiusKm?: number | null;
  baseLatitude?: number | null;
  baseLongitude?: number | null;
  services: Array<{ id: string; name: string }>;
  serviceCategories: string[];
  certifications: string[];
  serviceRegions?: string[];
  paymentMethodPreference?: string;
  upiId?: string | null;
  bankName?: string | null;
  isApproved: boolean;
  isVerified: boolean;
  isActive?: boolean;
  isBanned?: boolean;
  kycStatus: string;
  badges: string[];
  backgroundCheckStatus: string;
};

export type PartnerDashboard = {
  earnings: {
    today: number;
    todayChange: number;
    yesterday: number;
    thisWeek: number;
    thisMonth: number;
    lifetime: number;
    sparkline: Array<{ date: string; amount: number }>;
    weeklyCommission: number;
    weeklyGross: number;
    /** Net take-home % of gross this week (server-computed). */
    weeklyTakeHomePct: number;
    /** Current commission tier as a percentage: 20 | 18 | 15 | 12. */
    commissionRate: number;
  };
  counts: {
    completedToday: number;
    completedTodayDelta: number;
    pendingRequests: number;
    activeBookings: number;
    completedLifetime: number;
    totalBookings: number;
    totalReviews: number;
  };
  rates: {
    acceptanceRate: number;
    completionRate: number;
    responseRate: number;
    onTimeRate: number;
    cancellationRate: number;
  };
  rating: number;
  walletBalance: number;
  isOnline: boolean;
  onlineSince: string | null;
};

export type PartnerOperations = {
  axis?: "AVAILABILITY";
  availabilityState?: string;
  operationalStatus: string;
  uiOnline: boolean;
  isOnline: boolean;
  isPaused: boolean;
  isSuspended: boolean;
  suspendedMessage: string | null;
  pauseReason: string | null;
  pausedAt: string | null;
  onlineSince: string | null;
  lastSeenAt: string | null;
  timezone: string;
  workingDays: string[];
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
  breakWindows: Array<{ start: string; end: string }>;
  maxJobsPerDay: number | null;
  maxConcurrentJobs: number;
  serviceRadiusKm: number | null;
  serviceRegions: string[];
  city: string | null;
  baseLatitude: number | null;
  baseLongitude: number | null;
  capacity: {
    currentJobs: number;
    reservedOffers: number;
    jobsToday: number;
    maxConcurrentJobs: number;
    maxJobsPerDay: number | null;
    availableSlots: number;
    utilization: number;
    capacityFull: boolean;
    nextAvailableAt: string | null;
  };
  readiness: { ready: boolean; blockers: Array<{ code: string; message: string }> };
  preferredAreaLabel: string;
};

export type PartnerBookingStatus =
  | "pending"
  | "accepted"
  | "assigned"
  | "en_route"
  | "in_progress"
  | "completed"
  // Backend `BookingStatus.REJECTED`, serialised lowercase like every other value.
  | "rejected"
  | "cancelled"
  | "cancelled_by_user"
  | "cancelled_by_provider";

/** Mirror of backend PartnerJobBrief (lib/service-domain.ts). Execution facts only. */
export type PartnerJobBrief = {
  variant: string | null;
  audience: string | null;
  quantity: number;
  unit: string | null;
  addons: { name: string; quantity: number }[];
  durationMinutes: number | null;
  duration: {
    preparationMinutes: number;
    serviceMinutes: number;
    addonMinutes: number;
    cleanupMinutes: number;
    totalMinutes: number;
  } | null;
};

/** Mirror of backend PartnerRequirementsBrief (lib/service-requirements.ts) — from the booking snapshot. */
export type PartnerRequirement = {
  label: string;
  quantity: string | null;
  instructions: string | null;
  handling: string | null;
  customerWasTold: string | null;
  optional: boolean;
  chargeable: boolean;
};
export type PartnerRequirementsBrief = {
  bringMaterials: PartnerRequirement[];
  bringEquipment: PartnerRequirement[];
  customerProvides: PartnerRequirement[];
  preconditions: Array<PartnerRequirement & { check: "CONFIRMED_BY_CUSTOMER" | "VERIFY_ON_ARRIVAL" | "VERIFY_AT_START" | "INFORMATIONAL" }>;
  empty: boolean;
};

export type PartnerBooking = {
  id: string;
  bookingNumber: string;
  status: PartnerBookingStatus;
  scheduledDate: string;
  completedAt: string | null;
  /** Travel start. Set by the explicit "On my way" action or the GPS geofence. */
  enRouteAt: string | null;
  /** Arrival. Does not change `status`, so it must be read to know the real stage. */
  arrivedAt: string | null;
  startedAt: string | null;
  amount: number;
  finalAmount: number;
  /** Catalog snapshot of purchased add-ons from the backend. `price` is the line total. */
  addons?: { id: string; name: string; price: number; unitPrice?: number; quantity?: number }[];
  /** What was booked (variant, quantity, add-on units, duration) — backend partnerJobBrief. */
  job?: PartnerJobBrief;
  /** Phase 06 preparation checklist recorded at booking (null for bookings made before Phase 06). */
  requirements?: PartnerRequirementsBrief | null;
  paymentStatus: string;
  /** The server's payment exemption (fee-waived rework / revisit or audited override); the action mirror reads it. */
  paymentExempt?: boolean;
  /** §11: set on a case-created rework / revisit visit; null for an ordinary booking. */
  followUp?: { kind: string; parentBookingNumber: string | null; caseNumber: string | null } | null;
  /** The customer's note. The server sends it non-null only while this partner holds the job. */
  description: string | null;
  eta: number | null;
  customer: {
    firstName: string | null;
    lastName: string | null;
    profileImage: string | null;
    /** Masked customer phone from list API — never raw phoneNumber. */
    phoneMasked?: string | null;
  };
  service: {
    id: string;
    name: string;
    icon: string | null;
    basePrice: number;
  };
  address: {
    fullAddress: string;
    latitude: number | null;
    longitude: number | null;
    /** Access details from `GET /api/bookings/:id` — null unless this partner holds an active job. */
    flatNumber?: string | null;
    buildingName?: string | null;
    landmark?: string | null;
    specialInstructions?: string | null;
  };
  ratingGiven: boolean;
  rating: number | null;
  /**
   * The live dispatch window, present ONLY on rows in the pending tab.
   *
   * `null` means this row is not an open offer — an accepted or finished job — so nothing should
   * render a countdown for it. It is never "an offer with no deadline": the backend only returns a
   * pending row while its window is still open, so an offer and a deadline arrive together or not
   * at all.
   */
  offer: { dispatchedAt: string; expiresAt: string } | null;
};

export type JobAction =
  | "ACCEPT"
  | "DECLINE"
  | "START_NAVIGATION"
  | "MARK_ARRIVED"
  | "START_SERVICE"
  | "COMPLETE_SERVICE"
  | "CALL_CUSTOMER"
  | "OPEN_CHAT"
  | "UPLOAD_EVIDENCE"
  | "REPORT_NO_SHOW";

export type JobLifecycleStage =
  | "OFFERED"
  | "ACCEPTED"
  | "EN_ROUTE"
  | "ARRIVED"
  | "STARTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "REJECTED"
  | "EXPIRED"
  | "CUSTOMER_NO_SHOW"
  | "PROVIDER_NO_SHOW";

export type JobActionResult = {
  stage: JobLifecycleStage;
  availableActions: JobAction[];
  primaryAction: JobAction | null;
  requiredGates: string[];
  disabledReasons: Partial<Record<JobAction, string>>;
  /** §6: the server's START requirement gate. Only the server can compute it; null = not deployed. */
  requirementGate?: { ok: boolean; blocking: number; message: string } | null;
  /** §9: the server's safety gate (ACTIVE holds + open incidents). */
  safetyGate?: { ok: boolean; blocking: number; message: string } | null;
  /** The server's payment exemption for this booking. */
  paymentExempt?: boolean;
  /**
   * §52: what a no-show report would do. Sent only while REPORT_NO_SHOW is on offer (at the door,
   * not started) and only to the partner holding the job; absent otherwise.
   */
  noShow?: NoShowPreview;
};

/**
 * Mirror of the backend's `NoShowPreview` (services/booking-no-show.service.ts), field for field —
 * `tests/no-show.test.ts` compares the two. It never carries an amount; `message` is the server's
 * sentence and the only one the page shows about fees.
 */
export type NoShowPreview = {
  canReport: boolean;
  waitedMinutes: number | null;
  graceMinutes: number;
  minutesLeft: number | null;
  feeWillApply: boolean;
  feePercent: number;
  /** NOT_PREPAID: nothing was paid in advance, so there is no fee to take (no photo is asked for). */
  reason: "NO_DOOR_PHOTO" | "ARRIVAL_VOUCHED" | "NOT_AT_ADDRESS" | "CUSTOMER_PRESENT" | "NOT_PREPAID" | null;
  hasDoorPhoto: boolean;
  message: string;
};

/** `POST /api/bookings/:id/no-show` → the response's `message` plus its `data` block. */
export type NoShowReportResult = {
  message: string;
  status: string;
  feeAmount: number;
  feeWithheld?: "NO_DOOR_PHOTO" | "ARRIVAL_VOUCHED" | "NOT_AT_ADDRESS" | "CUSTOMER_PRESENT";
  feeNote?: string;
};

/* ---- Phase 10 §6 — booking requirement state (mirror of backend BookingRequirementsView) ---- */
export type RequirementEnforcementPoint = "BEFORE_BOOKING" | "BEFORE_ARRIVAL" | "AT_START";
export type RequirementEffectiveState = "UNRESOLVED" | "SATISFIED" | "FAILED" | "EXPIRED";
export type BlockingRequirement = {
  code: string;
  label: string;
  kind: string;
  enforcementPoint: RequirementEnforcementPoint;
  responsibility: string;
  verification: string;
  state: RequirementEffectiveState;
  reason: string;
  remediation: { role: "PARTNER" | "CUSTOMER"; text: string };
};
export type RequirementGateResult = { target: "ARRIVAL" | "START"; ok: boolean; evaluated: number; blocking: BlockingRequirement[] };
export type RequirementItemView = {
  code: string;
  label: string;
  kind: string;
  enforcementPoint: RequirementEnforcementPoint;
  responsibility: string;
  verification: string;
  optional: boolean;
  state: RequirementEffectiveState;
  resolvedAt: string | null;
  resolvedByRole: string | null;
  note: string | null;
  actions: Array<"CHECK" | "READY" | "ATTEST" | "RECHECK">;
  blocking: Pick<BlockingRequirement, "reason" | "remediation"> | null;
};
export type BookingRequirementsView = {
  enforced: boolean;
  serviceVersion: number | null;
  items: RequirementItemView[];
  gate: { arrival: RequirementGateResult; start: RequirementGateResult };
};

export type JobEvidenceItem = {
  id: string;
  stage: "ARRIVAL" | "START" | "COMPLETION" | string;
  mediaUrl?: string | null;
  mediaAccessUrl?: string | null;
  capturedAt: string;
  isCurrent: boolean;
  // No coordinates: the server does not send where a proof was captured to the partner.
};

export type JobChatMessage = {
  id: string;
  senderUserId: string;
  body: string;
  clientMessageId: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
};

export type JobChatList = {
  conversationId: string;
  messages: JobChatMessage[];
  nextCursor: string | null;
};

export type PartnerBookingsResponse = Paginated<{ bookings: PartnerBooking[] }>;

/* ---- Phase 13 P2 — the partner's earning for ONE job (mirror of backend lib/earning-settlement.ts) ----
 * `GET /api/providers/me/bookings/:bookingId/earning`. The row exists only once the job completed and
 * paid out; before that the server answers 404 `EARNING_NOT_FOUND` and nothing is estimated here.
 * `lines` are the server's own labels and numbers (gross, commission, a derived "Performance bonus" /
 * "Adjustment" when net ≠ gross − commission, net) — rendered verbatim, never recomputed.
 */
export type PartnerEarningLine = {
  key: "gross" | "commission" | "adjustment" | "net";
  label: string;
  /** Always positive; `kind` says which way it moves. */
  amount: number;
  kind: "base" | "debit" | "credit" | "total";
};
export type PartnerJobEarning = {
  earningId: string;
  /** The same `ERN-…` number the invoices page lists. */
  invoiceNumber: string;
  bookingId: string;
  settlement: "CREDITED" | "REVERSED";
  earnedAt: string;
  lines: PartnerEarningLine[];
  net: number;
};

export type PartnerEarningsSummary = {
  period: string;
  totalJobs: number;
  totalGross: number;
  totalCommission: number;
  totalNet: number;
  averagePerJob: number;
  series: Array<{ date: string; amount: number }>;
};

export type PartnerReview = {
  id: string;
  rating: number;
  reviewText: string | null;
  user: { firstName: string | null; profileImage: string | null };
  photos: string[];
  tipAmount: number | null;
  helpfulCount: number;
  createdAt: string;
  providerResponse?: string | null;
  respondedAt?: string | null;
};

export type PartnerReviewsResponse = Paginated<{
  reviews: PartnerReview[];
  ratingBreakdown: Record<string, number>;
}>;

export type WalletBalance = {
  balance: number;
  currency: string;
  lastTransaction?: WalletTransaction;
};

export type WalletTransaction = {
  id: string;
  transactionNumber?: string;
  type: "credit" | "debit" | string;
  amount: number;
  description?: string;
  reason?: string;
  createdAt: string;
  status?: string;
};

export type WalletTransactionsResponse = Paginated<{
  transactions: WalletTransaction[];
}>;

export type LoginPayload = {
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    profileImage: string | null;
    role?: string;
  };
  accessToken: string;
  /** Web receives no refresh token — it is an HttpOnly cookie. Present only for non-web clients. */
  refreshToken?: string;
  userId: string;
  expiresIn: number;
};

export type PartnerPayoutsData = {
  currentBalance: number;
  availableBalance: number;
  pendingBalance: number;
  lifetimeEarnings: number;
  lifetimeGross: number;
  nextPayoutDate: string | null;
  withdrawals: PartnerWithdrawalRow[];
  analytics: {
    daily: Array<{ period: string; amount: number }>;
    weekly: Array<{ period: string; amount: number }>;
    monthly: Array<{ period: string; amount: number }>;
    yearly: Array<{ period: string; amount: number }>;
  };
};

export type PartnerWithdrawalRow = {
  id: string;
  reference: string;
  amount: number;
  fee?: number;
  tax?: number;
  netAmount: number;
  status: string;
  bank?: string | null;
  settlementDate?: string | null;
  failureReason?: string | null;
  requestedAt?: string;
};

export type PartnerNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  referenceId?: string | null;
  isRead: boolean;
  imageUrl?: string | null;
  createdAt: string;
};

export type PartnerNotificationsResponse = Paginated<{
  notifications: PartnerNotification[];
  unreadCount: number;
}>;

export type MembershipPlanBenefit = {
  id: string;
  label: string;
  type?: string | null;
  value?: number | null;
};

export type PartnerMembershipPlan = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  interval: "MONTHLY" | "QUARTERLY" | "YEARLY";
  isActive: boolean;
  benefits: MembershipPlanBenefit[];
};

export type PartnerSubscription = {
  id: string;
  status: string;
  startsAt: string | null;
  expiresAt: string | null;
  autoRenew: boolean;
  cancelledAt: string | null;
  plan: PartnerMembershipPlan;
};

export type PartnerMembershipData = {
  active: PartnerSubscription | null;
  history: PartnerSubscription[];
};

export type PartnerEntitlements = {
  hasMembership: boolean;
  tier: string | null;
  planName: string | null;
  expiresAt: string | null;
  discountPct: number;
  cashbackPct: number;
  premiumAccess: boolean;
  priorityBooking: boolean;
  prioritySupport: boolean;
  freeDelivery: boolean;
  benefits: Array<{ type: string; value: number | null; label: string }>;
};

/* ---- Phase 11 — partner capability self-service (mirror of backend provider-capability) ----
 * `GET /api/providers/me/capabilities` (partner view: no `verifiedBy`). Rows are the table rows with
 * camelCased columns; timestamps arrive as ISO strings. `validity` and `nearExpiry` are computed by
 * the server against ITS clock — the UI shows them, it does not recompute them.
 */
export type CapabilityKind = "skills" | "certifications" | "equipment" | "insurance" | "languages";
export type CapabilityStatus = "DECLARED" | "VERIFIED" | "REJECTED" | "REVOKED";
export type SkillLevel = "BASIC" | "SKILLED" | "EXPERT";
export type LanguageProficiency = "BASIC" | "CONVERSATIONAL" | "FLUENT" | "NATIVE";
export type EquipmentOwnership = "OWNED" | "RENTED" | "EMPLOYER";
export type EquipmentOperational = "OPERATIONAL" | "OUT_OF_SERVICE";

export type SkillCatalogueEntry = {
  code: string;
  category: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProviderSkillRow = {
  id: number;
  providerId: string;
  skillCode: string;
  level: SkillLevel | null;
  status: CapabilityStatus;
  source: "SELF" | "ADMIN" | "DOCUMENT" | "IMPORT" | "LEGACY";
  sourceRef: string | null;
  verifiedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  skillName: string;
  skillCategory: string;
  skillActive: boolean;
  validity: "VALID" | "EXPIRED" | "REVOKED" | "UNVERIFIED" | "REJECTED";
  nearExpiry: boolean;
};

export type ProviderCertificationRow = {
  id: number;
  providerId: string;
  certificationType: string;
  issuer: string | null;
  referenceNumber: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  status: CapabilityStatus;
  verificationSource: string | null;
  documentId: string | null;
  verifiedAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  createdAt: string;
  updatedAt: string;
  validity: "VALID" | "EXPIRED" | "REVOKED" | "UNVERIFIED" | "REJECTED";
  nearExpiry: boolean;
};

export type ProviderEquipmentRow = {
  id: number;
  providerId: string;
  equipmentType: string;
  ownership: EquipmentOwnership;
  operational: EquipmentOperational;
  status: CapabilityStatus;
  verifiedAt: string | null;
  inspectionDueAt: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  validity: "VALID" | "REVOKED" | "REJECTED" | "UNVERIFIED" | "OUT_OF_SERVICE" | "INSPECTION_OVERDUE";
  /** For equipment this flags the inspection due date, not an expiry. */
  nearExpiry: boolean;
};

export type ProviderInsuranceRow = {
  id: number;
  providerId: string;
  insuranceType: string;
  insurer: string | null;
  policyReference: string | null;
  effectiveFrom: string | null;
  expiresAt: string;
  status: CapabilityStatus;
  documentId: string | null;
  verifiedAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  createdAt: string;
  updatedAt: string;
  validity: "VALID" | "EXPIRED" | "REVOKED" | "UNVERIFIED" | "NOT_YET_EFFECTIVE" | "REJECTED";
  nearExpiry: boolean;
};

/** Languages have no verification lifecycle: a row is the partner's (SELF) or an admin's record. */
export type ProviderLanguageRow = {
  id: number;
  providerId: string;
  languageCode: string;
  proficiency: LanguageProficiency;
  source: "SELF" | "ADMIN";
  active: boolean;
  createdAt: string;
  updatedAt: string;
  validity: "ACTIVE" | "INACTIVE";
};

/**
 * The certification / equipment / insurance codes operational services require, sorted. A kind's
 * list may be empty; the whole block is absent on a backend that predates it.
 */
export type RequirementCatalogue = { certifications: string[]; equipment: string[]; insurance: string[] };

/**
 * Every row also carries `dataOrigin` (and certifications / insurance a `proofRef`); the profile
 * also carries `services` and `memberships`. They are not read by this app and are left untyped.
 * Write responses (declare / edit) additionally carry `verifiedBy: null | "ADMIN"` — a constant,
 * never an admin's id — which nothing here reads or shows.
 */
export type ProviderCapabilityProfile = {
  requirementCatalogue?: RequirementCatalogue;
  providerId: string;
  dataOrigin: string | null;
  generatedAt: string;
  services: unknown[];
  memberships: unknown[];
  skills: ProviderSkillRow[];
  certifications: ProviderCertificationRow[];
  equipment: ProviderEquipmentRow[];
  insurance: ProviderInsuranceRow[];
  languages: ProviderLanguageRow[];
  summary: { nearExpiry: number; expired: number; pendingReview: number };
  /** Active skills the partner may declare (`code` is what `POST /skills` takes). */
  skillCatalogue: SkillCatalogueEntry[];
};

/** Request bodies of `POST /api/providers/me/capabilities/<kind>`. Only facts — never a status. */
export type DeclareSkillBody = { skillCode: string; level?: SkillLevel | null };
export type DeclareCertificationBody = {
  certificationType: string;
  issuer?: string | null;
  referenceNumber?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  documentId?: string | null;
};
export type DeclareEquipmentBody = {
  equipmentType: string;
  ownership?: EquipmentOwnership | null;
  operational?: EquipmentOperational | null;
  note?: string | null;
};
export type DeclareInsuranceBody = {
  insuranceType: string;
  insurer?: string | null;
  policyReference?: string | null;
  effectiveFrom?: string | null;
  /** Required by the server. */
  expiresAt: string;
  documentId?: string | null;
};
export type DeclareLanguageBody = { languageCode: string; proficiency?: LanguageProficiency | null };
/** `PATCH /:kind/:rowId` — certifications and insurance only, DECLARED or REJECTED rows only. */
export type EditCapabilityBody = {
  issuer?: string | null;
  referenceNumber?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  insurer?: string | null;
  policyReference?: string | null;
  effectiveFrom?: string | null;
  documentId?: string | null;
};

/* ---- Service readiness (mirror of backend partner-service-skills `ServiceReadiness`) ----
 * On `performing` cards of `GET /api/providers/me/service-skills` only; absent on an older backend.
 * `code` is a matching rejection reason (kept as a string: an unknown one must still render).
 */
export type ServiceReadinessGap = { code: string; detail: string; title?: string };
export type ServiceReadiness = { ready: boolean; missing: ServiceReadinessGap[] };

/* ---- Phase 10 §11 — reported issues, partner view (mirror of bookingCaseService.partnerView) ---- */
export type PartnerCaseEvidence = {
  id: number;
  kind: string;
  jobEvidenceId?: string | null;
  mediaUrl?: string | null;
  note: string | null;
  /**
   * The customer's photo is stored privately: fetch it from
   * `GET /api/bookings/:id/cases/:caseId/evidence/:evidenceId/media` with the session's token —
   * it is not a URL an `<img>` can load. Absent on a backend that predates the field.
   */
  hasStoredMedia?: boolean;
  createdAt: string;
};

export type PartnerCase = {
  id: string;
  caseNumber: string;
  bookingId: string;
  type: string;
  category: string;
  state: string;
  description: string | null;
  createdAt: string;
  closedAt: string | null;
  resolution: { action: string | null; followUpBookingId: string | null } | null;
  evidence: PartnerCaseEvidence[];
};

export type AuthStatus = "idle" | "initializing" | "authenticated" | "unauthenticated";

export type OtpLoginPayload = {
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role?: string;
  };
  accessToken: string;
  /** Web receives no refresh token — it is an HttpOnly cookie. */
  refreshToken?: string;
  isPhoneVerified: boolean;
};
