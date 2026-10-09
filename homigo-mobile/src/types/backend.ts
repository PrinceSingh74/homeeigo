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
    faqs?: { q: string; a: string }[];
  } | null;
};

/** One line of the customer's preparation view (service-requirements CustomerRequirement). */
export type CustomerRequirement = {
  /** Only used to confirm blocking requirements on booking; never rendered. */
  code: string;
  label: string;
  quantity: string | null;
  note: string | null;
  warning: string | null;
  chargeText: string | null;
  procurementText: string | null;
  timingText: string | null;
  mustConfirm: boolean;
};

export type CustomerRequirementsView = {
  weBring: CustomerRequirement[];
  youProvide: CustomerRequirement[];
  shared: CustomerRequirement[];
  beforeArrival: CustomerRequirement[];
  beforeBooking: CustomerRequirement[];
  optional: CustomerRequirement[];
  empty: boolean;
};

/**
 * Phase 10 customer visit promise (backend lib/customer-visit CustomerVisit). Every sentence is
 * produced by the server from the engines that enforce it; an absent rule is null / empty.
 */
export type CustomerVisit = {
  process: { code: "ARRIVAL" | "VERIFICATION" | "SERVICE" | "CONFIRMATION"; title: string; detail: string }[];
  safety: {
    warnings: string[];
    customerRequirements: string[];
    /** Products not used, or used only under a stated condition. Verbatim. */
    chemicalRestrictions: string[];
    information: string | null;
    medicalDisclaimer: string | null;
    emergencyProtocol: string | null;
  } | null;
  proof: { statements: string[] } | null;
  /** `statements` can be empty when only `guarantee` / `damagePolicy` (the service's own text) are set. */
  warranty: { statements: string[]; exclusions: string[]; guarantee: string | null; damagePolicy: string | null } | null;
  age: { statement: string } | null;
};

/** GET /api/services/:id (catalog.service byId) — only the fields the app reads are mirrored. */
export type BackendServiceDetail = BackendService & {
  /** Catalogue version the server rendered (catalog.service byId emits it); analytics attributes to it. */
  version?: number;
  detailedDescription?: string | null;
  /** False when the server would refuse a booking for this service. */
  bookable?: boolean;
  comingSoon?: boolean;
  content?: {
    summary: string;
    valueProposition: string | null;
    highlights: string[];
    keyBenefits: string[];
    included: string[];
    excluded: string[];
    limitations: string[];
    importantNotes: string[];
    customerDisclosures: string[];
  };
  /** Base selection duration from the server's one duration calculator. */
  duration?: {
    totalMinutes: number;
    customerEstimate: { estimatedMinutes: number; minMinutes: number | null; maxMinutes: number | null };
  };
  /** Preparation for the base selection, customer view. null = configuration invalid. */
  preparation?: CustomerRequirementsView | null;
  visit?: CustomerVisit | null;
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
  /** Lifecycle timestamps from GET /api/bookings/:id — null until the server records the event. */
  enRouteAt?: string | null;
  arrivedAt?: string | null;
  startedAt?: string | null;
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
