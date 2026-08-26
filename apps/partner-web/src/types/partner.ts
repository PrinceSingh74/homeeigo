/** A single field-level validation detail, or a plain message string. */
export type ApiErrorDetail = string | { field?: string; message: string; code?: string };

export type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  message?: string;
  details?: ApiErrorDetail[];
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
  | "cancelled"
  | "cancelled_by_user"
  | "cancelled_by_provider";

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
  /** Catalog snapshot of purchased add-ons ({id,name,price}) from the backend. */
  addons?: { id: string; name: string; price: number }[];
  paymentStatus: string;
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
  };
  ratingGiven: boolean;
  rating: number | null;
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
  | "UPLOAD_EVIDENCE";

export type JobLifecycleStage =
  | "PENDING"
  | "ACCEPTED"
  | "EN_ROUTE"
  | "ARRIVED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "EARNINGS_POSTED"
  | "CANCELLED"
  | "REJECTED";

export type JobActionResult = {
  stage: JobLifecycleStage;
  availableActions: JobAction[];
  primaryAction: JobAction | null;
  requiredGates: string[];
  disabledReasons: Partial<Record<JobAction, string>>;
};

export type JobEvidenceItem = {
  id: string;
  stage: "ARRIVAL" | "START" | "COMPLETION" | string;
  mediaUrl?: string | null;
  mediaAccessUrl?: string | null;
  capturedAt: string;
  isCurrent: boolean;
  latitude?: number | null;
  longitude?: number | null;
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
  refreshToken: string;
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
  refreshToken: string;
  isPhoneVerified: boolean;
};
