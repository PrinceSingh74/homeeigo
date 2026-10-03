export type BackendService = {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  category?: string;
  basePrice?: number;
  minPrice?: number;
  maxPrice?: number;
  /** Real aggregate from reviews; null when a service has none (backend no longer sends 4.8). */
  rating?: number | null;
  reviewCount?: number;
  bookingCount?: number;
  icon?: string | null;
  thumbnail?: string | null;
  isFeatured?: boolean;
  /** Minutes, from the backend service record. */
  estimatedDuration?: number;
  /** Public admin configuration — only the parts the booking flow prices with are mirrored. */
  catalogConfig?: {
    comingSoon?: boolean;
    audiences?: string[];
    quantity?: { type?: string; unitLabel?: string; min: number; max?: number; step?: number; default?: number };
    variants?: { id: string; name: string; price: number; active: boolean; audiences?: string[] }[];
    addons?: { id: string; name: string; price: number; durationMin?: number; active: boolean }[];
  } | null;
};

export type BackendProvider = {
  id: string;
  name: string;
  profileImage?: string | null;
  rating?: number;
  reviewCount?: number;
  isOnline?: boolean;
  availableNow?: boolean;
  availabilityLabel?: "Available now" | "Limited availability" | "Confirming professional" | "Unavailable";
  distance?: number;
  eta?: number;
  basePrice?: number;
};

export type BackendMatchedProvider = {
  providerId: string;
  name: string;
  rating: number;
  totalReviews: number;
  distance: number;
  eta: number;
  totalScore: number;
  isOnline: boolean;
  availableNow?: boolean;
  availabilityLabel?: "Available now" | "Limited availability" | "Confirming professional" | "Unavailable";
  availability: boolean;
  profileImage?: string | null;
};

export type BackendBooking = {
  id: string;
  bookingNumber?: string;
  serviceId?: string;
  serviceName?: string;
  serviceIcon?: string | null;
  providerId?: string;
  providerName?: string;
  providerImage?: string | null;
  // Full backend BookingStatus enum (lowercased) — was missing assigned/en_route/rejected.
  status:
    | "pending"
    | "accepted"
    | "assigned"
    | "en_route"
    | "in_progress"
    | "completed"
    | "rejected"
    | "cancelled"
    | "cancelled_by_user"
    | "cancelled_by_provider"
    /** PAYMENT_PENDING_TTL closed the window before payment completed; the slot was released. */
    | "expired"
    /** Nobody was served; which one it is decides the money and the wording. */
    | "customer_no_show"
    | "provider_no_show";
  scheduledDate?: string;
  completedAt?: string | null;
  amount?: number;
  finalAmount?: number;
  addons?: BookingAddon[];
  paymentStatus?: string;
  description?: string | null;
};

/** Catalog snapshot of a purchased add-on, stored on the booking at create time. */
export type BookingAddon = {
  id: string;
  name: string;
  price: number;
};

export type BackendWalletTransaction = {
  id: string;
  transactionNumber?: string;
  type: "credit" | "debit";
  amount: number;
  description?: string;
  reason?: string;
  createdAt: string;
  status?: string;
};

export type BackendNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  referenceId?: string | null;
  isRead: boolean;
  imageUrl?: string | null;
  createdAt: string;
};

export type BackendTracking = {
  id: string;
  bookingId: string;
  status: string;
  providerLatitude?: number;
  providerLongitude?: number;
  distance?: number;
  eta?: number;
  /** Travel heading in compass degrees (Uber-style marker rotation). */
  bearing?: number;
  /** Ground speed in m/s. */
  speed?: number;
  estimatedArrivalTime?: string;
  locationUpdatedAt?: string;
};

export type BackendAddress = {
  id: string;
  label?: string | null;
  type?: string | null;
  line1: string;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  isDefault?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type BackendRating = {
  id: string;
  bookingId: string;
  rating: number;
  reviewText?: string | null;
  photos?: string[];
  tipAmount?: number | null;
  liked?: string[];
  couldImprove?: string[];
  providerResponse?: string | null;
  respondedAt?: string | null;
  createdAt: string;
};

export type BackendProviderReview = {
  id: string;
  userName?: string | null;
  userImage?: string | null;
  rating: number;
  reviewText?: string | null;
  photos?: string[];
  providerResponse?: string | null;
  respondedAt?: string | null;
  serviceName?: string | null;
  createdAt: string;
};

export type BackendProviderDetail = {
  id: string;
  name: string;
  bio?: string | null;
  profileImage?: string | null;
  rating?: number;
  reviewCount?: number;
  isOnline?: boolean;
  availableNow?: boolean;
  availabilityLabel?: "Available now" | "Limited availability" | "Confirming professional" | "Unavailable";
  yearsOfExperience?: number;
  badges?: string[];
  services?: Array<{ id: string; name: string; basePrice?: number }>;
  gallery?: string[];
  completedJobs?: number;
  responseTime?: number;
  acceptanceRate?: number;
  isVerified?: boolean;
  city?: string | null;
};

export type BackendAvailabilitySlot = {
  start: string;
  end: string;
  available: boolean;
};

export type BackendProviderAvailability = {
  date: string;
  slots: BackendAvailabilitySlot[];
  timezone?: string;
};

export type BackendRefund = {
  id: string;
  paymentId: string;
  bookingId?: string;
  amount: number;
  reason?: string;
  status: string;
  createdAt: string;
  refundedAt?: string | null;
};

export type BackendWithdrawal = {
  id: string;
  withdrawalNumber?: string;
  amount: number;
  status: string;
  createdAt: string;
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
