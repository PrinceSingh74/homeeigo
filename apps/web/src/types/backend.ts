export type Paginated<T> = {
  total?: number;
  page?: number;
  limit?: number;
} & T;

export type BackendService = {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  category?: string;
  subcategory?: string | null;
  basePrice?: number;
  minPrice?: number;
  maxPrice?: number;
  /** Real aggregate from the ratings table; null when there are no reviews. */
  rating?: number | null;
  reviewCount?: number;
  bookingCount?: number;
  estimatedDuration?: number;
  durationRange?: string | null;
  icon?: string | null;
  thumbnail?: string | null;
  isFeatured?: boolean;
  isPopular?: boolean;
  premiumOnly?: boolean;
  /** Admin-set pricing model ("fixed" is the column default). */
  pricingModel?: string;
  tags?: string[];
  /** Public admin configuration (inactive items and unsupported options removed server-side). */
  catalogConfig?: PublicCatalogConfig | null;
  /** Customer taxonomy (service_categories). Absent on responses from older backends. */
  taxonomy?: ServiceTaxonomyRef;
  /** Server-resolved service-line price per selectable quantity (quantity-priced services only). */
  quantityPrices?: { quantity: number; servicePrice: number; servicePricePaise: number }[] | null;
};

export type ServiceTaxonomyRef = {
  category: { slug: string; name: string } | null;
  subcategory: { slug: string; name: string } | null;
};

/**
 * Mirror of apps/backend src/lib/service-catalog-config.ts (public projection).
 * Keep in lockstep — see memory "frontend types mirror, not import".
 */
export type QuantityType =
  | "NONE"
  | "HOUR"
  | "UNIT"
  | "SEAT"
  | "ROOM"
  | "BATHROOM"
  | "SOFA_SEAT"
  | "MATTRESS"
  | "WINDOW"
  | "FAN"
  | "APPLIANCE"
  | "SQ_FT"
  | "AREA"
  | "LOAD"
  | "ITEM"
  | "PACKAGE";
export type ResponsibilityPolicy =
  | "CUSTOMER_PROVIDED"
  | "PROFESSIONAL_PROVIDED"
  | "PACKAGE_INCLUDED"
  | "MIXED"
  | "NOT_REQUIRED"
  | "NOT_SPECIFIED";
export type SparePartsPolicy = "NOT_APPLICABLE" | "INCLUDED" | "CUSTOMER_PAYS" | "APPROVAL_REQUIRED";
export type ProfessionalPreference = "NO_PREFERENCE" | "FEMALE" | "MALE";
export type CatalogAudience = "women" | "men" | "girls" | "boys" | "senior-women" | "senior-men";

export type QuantityRule = {
  type: QuantityType;
  unitLabel: string;
  unitLabelPlural?: string;
  min: number;
  max: number;
  step: number;
  default?: number;
  unitPrice?: number;
  minimumCharge?: number;
  durationPerUnitMin?: number;
  required?: boolean;
};

export type PublicCatalogConfig = {
  bookingMode?: "STANDARD" | "HOURLY";
  comingSoon?: boolean;
  sameDayAvailable?: boolean;
  video?: string;
  media?: {
    heroImage?: string;
    heroVideo?: string;
    gallery?: string[];
  };
  quantity?: QuantityRule;
  variants?: {
    id: string;
    name: string;
    price: number;
    durationMin?: number;
    audiences?: CatalogAudience[];
    quantity?: { unitPrice?: number; min?: number; max?: number };
    active: boolean;
  }[];
  /** When variants exist, one must be chosen. */
  variantRequired?: boolean;
  audiences?: CatalogAudience[];
  eligibility?: string;
  professionalPreferences?: ProfessionalPreference[];
  materialPolicy?: ResponsibilityPolicy;
  equipmentPolicy?: ResponsibilityPolicy;
  sparePartsPolicy?: SparePartsPolicy;
  preparation?: string[];
  safetyNotes?: string[];
  faqs?: { q: string; a: string }[];
  addons?: {
    id: string;
    name: string;
    price: number;
    durationMin?: number;
    maxQuantity?: number;
    compatibleVariantIds?: string[];
    requiresAddonIds?: string[];
    conflictsWithAddonIds?: string[];
    active: boolean;
  }[];
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
  duration?: {
    estimatedMin?: number;
    minMin?: number;
    maxMin?: number;
    preparationMin?: number;
    serviceMin?: number;
    cleanupMin?: number;
    totalSlotMin?: number;
  };
};

/** Mirror of backend ResolvedDuration (lib/service-catalog-config.ts). */
export type ServiceDuration = {
  serviceMinutes: number;
  addonMinutes: number;
  preparationMinutes: number;
  cleanupMinutes: number;
  totalMinutes: number;
  customerEstimate: { estimatedMinutes: number; minMinutes: number | null; maxMinutes: number | null };
};

export type SelectionIssue = { code: string; field: string; id?: string; message: string };

/** POST /api/services/:id/resolve-selection — the server's verdict on a selection. */
export type ServiceResolution = {
  serviceId: string;
  serviceVersion: number;
  ok: boolean;
  issues: SelectionIssue[];
  addonAvailability: { id: string; available: boolean; reason: string | null }[];
  pricing: {
    servicePrice: number;
    addons: { id: string; name: string; unitPrice: number; quantity: number; price: number }[];
    addonTotal: number;
    subtotal: number;
    note: string;
  } | null;
  selection: {
    variant: { id: string; name: string; price: number } | null;
    quantity: number;
    unitLabel: string | null;
    unitPrice: number | null;
    audience: CatalogAudience | null;
  } | null;
  duration: ServiceDuration | null;
};

export type ServiceSelectionRequest = {
  variantId?: string;
  quantity?: number;
  audience?: string;
  addonIds?: string[];
  addonQuantities?: Record<string, number>;
  packagePrice?: number;
  serviceVersion?: number;
};

/** Server-priced selection returned by the price quote and stored on the booking. */
export type ServiceSelectionSnapshot = {
  variant: { id: string; name: string; price: number } | null;
  quantity: number;
  quantityType: QuantityType | null;
  unitLabel: string | null;
  unitPrice: number | null;
  audience: CatalogAudience | null;
  professionalPreference: ProfessionalPreference | null;
  durationMinutes: number;
};

/** GET /api/services/:id — list fields plus admin-configured detail content. */
/** Phase 06 — one customer-facing requirement, as the server phrased it. */
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

export type BackendServiceDetail = BackendService & {
  detailedDescription?: string | null;
  images?: string[];
  includedServices?: string[];
  excludedServices?: string[];
  requirements?: string[];
  availableCities?: string[];
  /** Real aggregate from the ratings table; null when there are no reviews. */
  rating?: number | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  /** Selection-config version; sent back as serviceVersion so a stale page is detected. */
  version?: number;
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
    media: {
      thumbnail: string | null;
      heroImage: string | null;
      heroVideo: string | null;
      gallery: string[];
      instructional: string[];
      beforeAfter: { before: string; after: string; caption?: string }[];
      documents: { label: string; url: string }[];
    };
  };
  /** Base selection duration from the server's one duration calculator. */
  duration?: ServiceDuration;
  /**
   * Phase 06: preparation for the BASE selection, customer view only (server-translated sentences;
   * never partner instructions, internal notes, codes or enums). null = configuration invalid.
   */
  preparation?: CustomerRequirementsView | null;
  /**
   * Phase 10 customer visit promise. Sentences are produced by the backend from the engines
   * that enforce them. Absent on older responses — the page then keeps the booking steps only.
   */
  visit?: {
    process: { code: "ARRIVAL" | "VERIFICATION" | "SERVICE" | "CONFIRMATION"; title: string; detail: string }[];
    safety: {
      warnings: string[];
      customerRequirements: string[];
      /** Products not used, or used only under a stated condition. Optional: older responses omit it. */
      chemicalRestrictions?: string[];
      information: string | null;
      medicalDisclaimer: string | null;
      emergencyProtocol: string | null;
    } | null;
    proof: { statements: string[] } | null;
    /** `statements` can be empty when only `guarantee` / `damagePolicy` are set. Both are the service's own text. */
    warranty: { statements: string[]; exclusions: string[]; guarantee?: string | null; damagePolicy?: string | null } | null;
    age: { statement: string } | null;
  } | null;
  /** Add-ons this service offers (its own, or the shared catalogue), server-priced. */
  addons?: {
    id: string;
    name: string;
    price: number;
    durationMin: number | null;
    maxQuantity: number;
    compatibleVariantIds: string[];
    requiresAddonIds: string[];
    conflictsWithAddonIds: string[];
  }[];
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

export type BackendProviderScoreBreakdown = {
  ratingScore: number; // 0-30
  distanceScore: number; // 0-25
  availabilityScore: number; // 0-20
  responseScore: number; // 0-15
  completionScore: number; // 0-10
};

export type BackendMatchedProvider = {
  providerId: string;
  name: string;
  rating: number;
  totalReviews: number;
  distance: number;
  eta: number;
  totalScore: number; // 0-100 composite smart-match score
  scoreBreakdown: BackendProviderScoreBreakdown;
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
  /** Nested provider from GET /api/bookings/:id (booking.service getById). */
  provider?: {
    id: string;
    name: string;
    rating?: number | null;
    /** Masked only — raw partner phone never in customer booking payloads. */
    phoneMasked?: string | null;
    /** @deprecated Prefer phoneMasked + partner-call; kept for transitional clients. */
    phoneNumber?: string | null;
    profileImage?: string | null;
  } | null;
  /** Fulfilment address from GET /api/bookings/:id — includes geo for the live map. */
  address?: {
    fullAddress?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
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
    /** Nobody was served. Which one it is decides both the money and the wording. */
    | "customer_no_show"
    | "provider_no_show";
  service?: { name?: string; icon?: string | null } | null;
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
