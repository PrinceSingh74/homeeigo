export type PartnerRequirementLine = {
  label: string;
  quantity: string | null;
  instructions: string | null;
  handling: string | null;
  customerWasTold: string | null;
  optional: boolean;
  chargeable: boolean;
};

export type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  message?: string;
};

export type PartnerUser = {
  id: string;
  email: string;
  phoneNumber?: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImage?: string | null;
  role?: string;
  isEmailVerified?: boolean;
  isPhoneVerified?: boolean;
};

export type ProviderProfile = {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phoneNumber: string | null;
  bio: string | null;
  city: string | null;
  rating: number;
  totalReviews: number;
  totalBookings: number;
  completedBookings: number;
  completionRate: number;
  responseRate: number;
  onTimeRate: number;
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
    weeklyTakeHomePct: number;
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
    availableSlots: number;
    utilization: number;
    capacityFull: boolean;
    maxConcurrentJobs: number;
    maxJobsPerDay: number | null;
    jobsToday: number;
    nextAvailableAt: string | null;
  };
  readiness: { ready: boolean; blockers: Array<{ code: string; message: string }> };
  preferredAreaLabel: string;
};

export type PartnerBooking = {
  id: string;
  bookingNumber: string;
  status: string;
  scheduledDate: string;
  completedAt: string | null;
  /** Travel start. Set by the explicit "On my way" action or the GPS geofence. */
  enRouteAt: string | null;
  /** Arrival. Does not change `status`, so it must be read to know the real stage. */
  arrivedAt: string | null;
  startedAt: string | null;
  /** Present when start OTP gate has been cleared (optional on list payloads). */
  startOtpVerifiedAt?: string | null;
  amount: number;
  finalAmount: number;
  paymentStatus: string;
  description: string | null;
  eta: number | null;
  customer: {
    firstName: string | null;
    lastName: string | null;
    profileImage: string | null;
    /** Masked customer phone — never raw phoneNumber on booking payloads. */
    phoneMasked?: string | null;
  };
  /** basePrice is null when the backend did not send one — it is never inferred from the job total. */
  service: { id: string; name: string; icon: string | null; basePrice: number | null };
  address: { fullAddress: string; latitude: number | null; longitude: number | null };
  /** Purchased add-ons; `price` is the line total. */
  addons?: { id: string; name: string; price: number; unitPrice?: number; quantity?: number }[];
  /** What was booked (variant, quantity, add-on units, duration) — backend partnerJobBrief. */
  job?: {
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
  /** Phase 06 preparation checklist recorded at booking (backend PartnerRequirementsBrief); null before Phase 06. */
  requirements?: {
    bringMaterials: PartnerRequirementLine[];
    bringEquipment: PartnerRequirementLine[];
    customerProvides: PartnerRequirementLine[];
    preconditions: Array<PartnerRequirementLine & { check: "CONFIRMED_BY_CUSTOMER" | "VERIFY_ON_ARRIVAL" | "VERIFY_AT_START" | "INFORMATIONAL" }>;
    empty: boolean;
  } | null;
  execution?: {
    materials: string | null;
    equipment: string | null;
    quality: {
      proofRequired: boolean;
      beforeAfterPhotos: boolean;
      checklist: string[];
      warrantyDays: number;
    } | null;
    durationMinutes: number | null;
  };
  /**
   * The live dispatch window, present ONLY on rows in the pending tab.
   *
   * `null` means the row is not an open offer (an accepted or finished job), never "an offer with
   * no deadline" — the backend returns a pending row only while its window is open, so an offer and
   * its deadline arrive together or not at all. The requests screen does not render a countdown
   * yet; the field is declared so this mirror stays honest about what the API sends.
   */
  offer?: { dispatchedAt: string; expiresAt: string } | null;
  /** §11: set on a case-created rework / revisit visit (backend partnerFollowUpFromSnapshot); null otherwise. */
  followUp?: { kind: string; parentBookingNumber: string | null; caseNumber: string | null } | null;
  /** The server's payment exemption (fee-waived follow-up or audited override); the action mirror reads it. */
  paymentExempt?: boolean;
};

export type PartnerBookingsResponse = {
  bookings: PartnerBooking[];
  total: number;
  page: number;
  limit: number;
};

export type PartnerEarningsSummary = {
  totalEarnings: number;
  periodEarnings: number;
  avgPerJob: number;
  totalJobs: number;
  breakdown: Array<{ date: string; earnings: number; jobs: number }>;
  byService: Array<{ serviceName: string; earnings: number; jobs: number }>;
};

export type WalletBalance = {
  balance: number;
  currency: string;
  lastTransaction?: {
    type: string;
    amount: number;
    reason?: string;
    createdAt: string;
  } | null;
};

export type WalletTransaction = {
  id: string;
  type: string;
  amount: number;
  description: string;
  status: string;
  createdAt: string;
};

export type WalletTransactionsResponse = {
  transactions: WalletTransaction[];
  total: number;
  page: number;
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

export type PartnerPayoutsData = {
  currentBalance: number;
  availableBalance: number;
  pendingBalance: number;
  lifetimeEarnings: number;
  lifetimeGross: number;
  nextPayoutDate: string | null;
  withdrawals: PartnerWithdrawalRow[];
  analytics?: {
    daily: Array<{ period: string; amount: number }>;
    weekly: Array<{ period: string; amount: number }>;
    monthly: Array<{ period: string; amount: number }>;
    yearly: Array<{ period: string; amount: number }>;
  };
};

export type PartnerReview = {
  id: string;
  rating: number;
  comment: string | null;
  response: string | null;
  createdAt: string;
  customer: { firstName: string | null; lastName: string | null };
  service: { name: string };
};

export type PartnerReviewsResponse = {
  reviews: PartnerReview[];
  total: number;
  page: number;
  averageRating: number;
  breakdown: Record<string, number>;
};

export type PartnerNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  data?: Record<string, unknown>;
};

export type PartnerNotificationsResponse = {
  notifications: PartnerNotification[];
  total: number;
  unreadCount: number;
};

export type PartnerMembershipPlan = {
  id: string;
  name: string;
  price: number;
  interval: string;
  features: string[];
};

export type PartnerMembershipData = {
  active: {
    id: string;
    planId: string;
    plan?: { id: string; name: string };
    expiresAt: string | null;
    autoRenew: boolean;
  } | null;
  history: unknown[];
};

export type PartnerEntitlements = {
  tier: string | null;
  benefits: Array<{ type: string; value: number | null; label: string }>;
};

export type PartnerSupportTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  category: string;
  priorityLevel: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type PartnerSupportTicketDetail = PartnerSupportTicket & {
  messages: Array<{ id: string; body: string; authorRole: string; createdAt: string }>;
};

export type RouteStop = {
  bookingId: string;
  order: number;
  lat: number;
  lng: number;
  status: string | null;
  distanceFromPrevKm: number;
  etaFromPrevMin: number;
  cumulativeEtaMin: number;
};

export type RouteOptimizeResult = {
  sequence: RouteStop[];
  metrics: {
    stops: number;
    optimizedDistanceKm: number;
    optimizedEtaMin: number;
    naiveDistanceKm: number;
    naiveEtaMin: number;
    timeSavedMin: number;
    source: string;
  };
  polyline: string | null;
};

export type PartnerAttendance = {
  checkIn: string | null;
  checkOut: string | null;
  isCheckedIn: boolean;
  workingHoursToday: number;
  weeklyAttendance: number;
  monthlyAttendance: number;
  workingHoursStart?: string | null;
  workingHoursEnd?: string | null;
  sessions: Array<{
    id: string;
    checkInAt: string;
    checkOutAt: string | null;
    source: string;
    durationHours: number | null;
  }>;
};

export type PartnerIncentives = {
  rules: Array<{
    id: string;
    code: string;
    name: string;
    period: string;
    metric: string;
    threshold: number;
    bonusAmount: number;
    current: number;
    eligible: boolean;
    progressPct: number;
    paid?: boolean;
    payoutStatus?: string | null;
    payoutAmount?: number | null;
    payoutId?: string | null;
    payoutAt?: string | null;
    periodKey?: string;
  }>;
  streakDays: number;
  payouts: Array<{
    id: string;
    amount: number;
    periodKey: string;
    status: string;
    createdAt: string;
    rule?: { name: string; code: string };
  }>;
};

export type PartnerForecast = {
  todayProjection: number;
  weeklyProjection: number;
  monthlyProjection: number;
  inputs: Record<string, number>;
};

export type PartnerIntelligence = {
  periodDays: number;
  uniqueCustomers: number;
  returningCustomers: number;
  repeatCustomerRatePct: number;
};

export type PartnerRankings = {
  cityRank: number;
  cityTotal: number;
  areaRank: number;
  areaTotal: number;
  areaName?: string;
  city: string;
  compositeScore: number;
  categoryRanks: Array<{ category: string; rank: number; total: number; score: number }>;
};

export type PartnerScorecard = {
  policyVersion: string;
  overallScore: number | null;
  band: string;
  components: Record<string, { value: number | null; weight: number }>;
  sample: { completedJobs: number; ratings: number; arrivals: number; assignments: number };
  calculatedAt: string;
  trends: Record<string, { delta: number | null; insufficient: boolean }>;
};

export type PartnerCareer = {
  currentLevel: string;
  nextLevel: string | null;
  progressPct: number;
  requirements: Array<{ id: string; label: string; current: number; target: number; met: boolean; unit: string }>;
  remainingRequirements: Array<{ id: string; label: string; current: number; target: number; met: boolean }>;
  qualificationState: string;
  benefitsActive: boolean;
  careerPriorityBoost: number;
  badges: Array<{ code: string; label: string; awardedAt: string; reason: string }>;
};

export type PartnerLifecycle = {
  lifecycleState: string;
  dispatchEligible: boolean;
  availability: { isOnline: boolean; currentStatus: string };
};

export type PartnerAcademy = {
  modules: Array<{
    id: string;
    slug: string;
    title: string;
    contentType: string;
    contentUrl: string | null;
    body: string | null;
    completedAt: string | null;
    score: number | null;
  }>;
  certifications: string[];
  completedCount: number;
};

export type PartnerCompliance = {
  status?: string;
  explanation?: string;
  restricted?: boolean;
  restrictionReason?: string | null;
  documents: Array<{
    id: string;
    documentType: string;
    documentName: string | null;
    isVerified: boolean;
    expiryDate: string | null;
    expiryState?: string;
    daysToExpiry?: number | null;
    cta?: string;
    expiringSoon: boolean;
  }>;
  verification: Record<string, unknown>;
  complianceScore: number;
  expiringSoon: number;
  certifications: string[];
};

export type PartnerWellbeing = {
  sosPhone: string | null;
  insuranceUrl: string | null;
  communityUrl: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
};

export type PartnerRewards = {
  badges: string[];
  milestones: Array<{ label: string; target: number; current: number; achieved: boolean; progressPct: number }>;
  referralCount: number;
  referralCode: string | null;
  incentiveEarnings: number;
};

export type PartnerServiceHistory = {
  completed: number;
  cancelled: number;
  rescheduled: number;
  upcoming: number;
};

export type PartnerDocument = {
  id: string;
  documentType: string;
  documentName: string | null;
  documentUrl: string;
  isVerified: boolean;
  uploadedAt: string;
};

export type PartnerInvoices = {
  earnings: Array<{
    id: string;
    invoiceNumber: string;
    service: string;
    gross: number;
    commission: number;
    net: number;
    date: string;
  }>;
  settlements: Array<{
    id: string;
    settlementNumber: string;
    amount: number;
    netAmount: number;
    status: string;
    date: string;
  }>;
};

export type PartnerTaxSummary = {
  financialYear: number;
  grossEarnings: number;
  platformCommission: number;
  netEarnings: number;
  settledOut: number;
  estimatedTax: number;
  gstOnCommission?: number;
  tdsEstimate?: number;
};

export type SurgeZone = {
  zoneId: string;
  name: string;
  city: string | null;
  supply: number;
  activeBookings: number;
  weatherSurge: number;
  predictedSurge: number;
  demandDeltaPct: number | null;
};

export type DensityZone = {
  zoneId: string;
  name: string;
  city: string | null;
  centerLat: number;
  centerLng: number;
  providers: number;
  areaKm2: number;
  densityPerKm2: number;
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

export type ZoneScoring = {
  ranked: ZoneScore[];
  bestEarning: ZoneScore[];
  bestOpportunity?: ZoneScore[];
  worstService: ZoneScore[];
  highRisk: ZoneScore[];
};

export type DemandForecast = {
  horizonHours: number;
  points: Array<{ zone_id: string; hour: string; predicted: number; lo: number; hi: number }>;
  totalPredicted: number;
};

export type GeoIntel<T> = {
  success: boolean;
  data: T;
  confidence: number;
  freshness: string;
  source: string;
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
