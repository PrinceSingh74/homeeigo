export type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  message?: string;
  details?: string[];
};

export type Paginated<T> = T & {
  total: number;
  page: number;
  limit?: number;
};

export type AdminUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string | null;
  profileImage: string | null;
  role: "CUSTOMER" | "PROVIDER" | "ADMIN";
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  isActive: boolean;
  isBanned: boolean;
  createdAt: string;
};

export type AdminCustomer = {
  id: string;
  email: string;
  firstName: string | null;
  lastName?: string | null;
  totalBookings: number;
  totalSpent: number;
  walletBalance?: number;
  referralCount?: number;
  preferredCity?: string | null;
  lastActivityAt?: string | null;
  kycStatus: string;
  isActive: boolean;
  createdAt: string;
};

export type AdminProvider = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  rating: number;
  totalBookings: number;
  completedBookings: number;
  isVerified: boolean;
  isApproved: boolean;
  isOnline?: boolean;
  lastSeenAt?: string | null;
  completionRate?: number;
  acceptanceRate?: number;
  totalReviews?: number;
  currentStatus?: string | null;
  businessName?: string | null;
  registrationStatus?: "PENDING" | "APPROVED" | "REJECTED";
  serviceCategories?: string[];
  city?: string | null;
  experienceYears?: number;
  registeredAt?: string;
  rejectionReason?: string | null;
  totalEarnings: number;
  createdAt: string;
};

export type AdminBooking = {
  id: string;
  bookingNumber: string | null;
  user: string;
  provider: string;
  service: string;
  amount: number;
  status: string;
  rating?: number | null;
  completedAt?: string | null;
  userId?: string;
  providerId?: string | null;
  paymentStatus?: string;
  scheduledDate?: string | null;
  createdAt?: string;
  cancelledAt?: string | null;
  city?: string | null;
  eta?: number | null;
  premiumMatched?: boolean;
  queuePriority?: string;
};

export type DashboardStats = {
  totalUsers: number;
  totalProviders: number;
  totalBookings: number;
  completedBookings: number;
  cancelledBookings?: number;
  /** fulfillment-rates.ts. Null when nothing has finished. */
  completionRatePct?: number | null;
  cancellationRatePct?: number | null;
  totalRevenue: number;
  thisMonthRevenue: number;
  /** Mean of partner ratings. Null when no business partner has a rating. Not the review average. */
  partnerRatingMean?: number | null;
  averageRating: number | null;
  activeNow: number;
};

export type DashboardCharts = {
  bookingsByDay: Array<{ date: string; count: number }>;
  revenueByDay: Array<{ date: string; revenue: number }>;
};

export type DashboardData = {
  stats: DashboardStats;
  charts: DashboardCharts;
};

export type AnalyticsData = {
  period: { startDate: string; endDate: string };
  overview: {
    totalBookings: number;
    completedBookings: number;
    cancelledBookings: number;
    totalRevenue: number;
    platformCommission: number;
    providerPayouts: number;
    /** Platform take rate as a percentage (server-computed). */
    commissionPercentage: number;
  };
  topServices: Array<{
    name: string;
    bookings: number;
    revenue: number;
    /** Actual recorded commission for this service (from Earning rows). */
    commission: number;
    netEarning: number;
  }>;
  topProviders: Array<{
    id?: string;
    name?: string;
    bookings?: number;
    earnings?: number;
  }>;
  userMetrics: {
    newUsers: number;
    activeUsers: number;
    /** Null when no business customer booked in the window. Percent, not a 0–1 ratio. */
    repeatCustomerRatePct: number | null;
  };
  metrics?: {
    completionRatePct: number | null;
    cancellationRatePct: number | null;
    quoteToBookingPct: number | null;
    repeatCustomerRatePct: number | null;
    capturedGmv: number;
    netCaptured: number;
    gatewayCaptured: number;
    walletCaptured: number;
    refunds: number;
  };
};

export type AdminListCustomersResponse = Paginated<{ users: AdminCustomer[] }>;
export type AdminListProvidersResponse = Paginated<{ providers: AdminProvider[] }>;
export type AdminListBookingsResponse = Paginated<{ bookings: AdminBooking[] }>;

export type VerifyAction = "approve" | "reject" | "request_changes";
export type BanAction = "ban" | "unban";

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
  /** Web receives no refresh token — it is an HttpOnly cookie. */
  refreshToken?: string;
  userId: string;
  expiresIn: number;
};

export type CurrentUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profileImage: string | null;
  phoneNumber: string | null;
  role: string;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  isActive?: boolean;
  isBanned?: boolean;
  createdAt?: string;
};

/**
 * Phase-9 executive intelligence, Capability 12.
 *
 * These types mirror the backend contract exactly. Nothing is widened to `any`, and no field is made
 * optional to make a component compile — a nullable field here means the platform genuinely does not
 * know the value, and the UI is required to say so rather than render a zero.
 */
export type ExecutiveBriefPeriod = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

/** What a line in the brief *is*. A forecast rendered as a fact is a lie about certainty. */
export type ReportItemKind =
  | "FACT"
  | "ANOMALY"
  | "FORECAST"
  | "WARNING"
  | "RECOMMENDATION"
  | "LIMITATION";

export type ExecutiveBriefItem = {
  kind: ReportItemKind;
  label: string;
  /** Exactly what the source produced. Never re-rounded or re-derived in the UI. */
  value: number | string | null;
  unit?: string;
  /** The producing service's own state string, carried verbatim. */
  state: string;
  source: string;
  observedAt: string | null;
  freshness: string | null;
  confidence: number | null;
  reasonCode?: string;
};

export type ExecutiveBrief = {
  reportType: "EXECUTIVE_BRIEF";
  period: ExecutiveBriefPeriod;
  periodDays: number;
  state: "GENERATED" | "STALE" | "INCOMPLETE" | "FAILED";
  generatedAt: string;
  items: ExecutiveBriefItem[];
  narrative: { text: string; generatedBy: "DETERMINISTIC" | "LLM"; reasonCode: string };
  /** Sources stale or failed at generation. */
  staleSources: string[];
  unavailableSources: string[];
  /** Domains the platform has never implemented — permanent, not an incident. */
  structuralGaps: string[];
  versions: {
    reportRulesVersion: string;
    contextRulesVersion: string | null;
    modelVersions: Record<string, string | null>;
  };
  humanDecisions: string[];
  timings: { totalMs: number; sourceMs: Record<string, number> };
};

export type ReportScheduleStatus = {
  capabilityState: string;
  /** All three are independently nullable. A UI must not report "configured" on a partial set. */
  schedule: {
    status: "UNSET" | "APPROVED";
    approved: boolean;
    localTime: string | null;
    recurrence: string | null;
    timezoneStrategy: string | null;
  };
  featureFlag: { key: string; enabled: boolean; reason?: string };
  deliveryMode: "SHADOW";
  lastRun: { at: string | null; status: string; attempts: number } | null;
  nextRun: { at: string } | null;
  recentJobs: Array<{
    id: string; status: string; runAt: string;
    completedAt: string | null; attempts: number; lastError: string | null;
  }>;
  recipientCount: number;
  humanDecisions: string[];
};


/**
 * Phase 10 — support intelligence for one ticket.
 *
 * Mirrors the backend contract exactly. `modelConfidence` is nullable and named for what it is: the
 * model's self-report, not a measured probability that the classification is right.
 */
export type SupportIntelligence = {
  classification: {
    state: "CLASSIFIED" | "MODEL_UNAVAILABLE" | "OUTPUT_INVALID" | "SKIPPED";
    intent: string | null;
    suggestedPriority: string | null;
    sentiment: string | null;
    modelConfidence: number | null;
    rationale: string | null;
    provider: string | null;
    model: string | null;
    usedFallback: boolean;
    reasonCode?: string;
  };
  recommendation: {
    action: string;
    reason: string;
    evidence: Array<{ signal: string; value: string; source: string }>;
    risk: "LOW" | "MEDIUM" | "HIGH";
    requiresHumanReview: boolean;
    limitations: string[];
  };
  eligibility: {
    eligible: boolean;
    checks: Array<{ name: string; passed: boolean; detail: string }>;
    blockingReasons: string[];
    stage: string;
  };
  context: {
    declaredCategory: string;
    slaBreached: boolean | null;
    messageCount: number;
    limitations: string[];
    booking: { state: string; source: string; freshness: string };
    payment: { state: string; source: string; freshness: string };
    refund: { state: string; source: string; freshness: string };
    partner: { state: string; source: string; freshness: string };
  };
  humanDecisions: string[];
  featureFlag: { key: string; enabled: boolean };
  policyStatus: string;
  timings: { totalMs: number; contextMs: number; classificationMs: number };
};


/** Phase 10 — one persisted recommendation, as the audit surface returns it. */
export type SupportRecommendationRow = {
  id: string;
  createdAt: string;
  rulesVersion: string;
  intent: string | null;
  sentiment: string | null;
  modelConfidence: number | null;
  classificationState: string;
  usedFallback: boolean;
  provider: string | null;
  model: string | null;
  action: string;
  risk: string;
  requiresHumanReview: boolean;
  /** The seven canonical states. Never collapsed with the ticket's own status. */
  lifecycle: "RECOMMENDATION" | "REVIEW_REQUIRED" | "APPROVED" | "REJECTED" | "EXECUTED" | "FAILED" | "EXPIRED";
  actedBy: string | null;
  actedAt: string | null;
  actedAction: string | null;
  /** True when the human did something other than what was advised. */
  overridden: boolean | null;
  approvalId: string | null;
  failureReason: string | null;
  automationEligible: boolean;
  latencyMs: number | null;
  limitations: string[];
};
