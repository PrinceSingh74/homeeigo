/**
 * Wire types of the partner app. They MIRROR the backend (apps/backend/src) — they do not import it —
 * so every shape here was read from the code that builds the response (route handler → service →
 * object literal / Prisma select), on 2026-10-07. Where partner web's mirror and the backend
 * disagree, the backend wins. Rules:
 *   - every date is an ISO string; every money value is a JSON number (rupees; the columns are Float);
 *   - a value the server may not have is `| null`, never a made-up default;
 *   - booking `status` / `paymentStatus` are LOWERCASE on the wire; job `stage` is UPPERCASE.
 */
import type { JobAction, JobGateSummary, JobLifecycleStage } from "@/lib/job-action-policy";

export type { JobAction, JobGateSummary, JobLifecycleStage };

/** One line of the booking's preparation snapshot (backend `PartnerRequirement`, lib/service-requirements.ts). */
export type PartnerRequirementLine = {
  label: string;
  quantity: string | null;
  instructions: string | null;
  handling: string | null;
  customerWasTold: string | null;
  optional: boolean;
  chargeable: boolean;
};

/** Backend `PartnerRequirementsBrief` — what THIS booking recorded at creation. */
export type PartnerRequirementsBrief = {
  bringMaterials: PartnerRequirementLine[];
  bringEquipment: PartnerRequirementLine[];
  customerProvides: PartnerRequirementLine[];
  preconditions: Array<PartnerRequirementLine & { check: "CONFIRMED_BY_CUSTOMER" | "VERIFY_ON_ARRIVAL" | "VERIFY_AT_START" | "INFORMATIONAL" }>;
  empty: boolean;
};

/**
 * The response envelope. On success: `{ success: true, message?, data? }` — `message` is the server's
 * sentence and sits at the top level, never inside `data`. On a refusal: `{ success: false, error,
 * code, data?, details?, retryAfter? }` — the sentence is `error`; see `lib/api-error.ts`.
 */
export type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  code?: string;
  details?: Array<string | { field?: string; message: string }>;
  retryAfter?: number;
};

/** What `requestEnvelope` returns: the `data` block and the server's success sentence (null when it sent none). */
export type ApiEnvelope<T> = { data: T; message: string | null };

/**
 * `GET /api/user/me` → `data.user` (routes/users.ts). The only user read that carries `role`.
 * `email` / `phoneNumber` are the RAW columns: they are `null` for an account whose PII is stored
 * encrypted — read `PartnerUserProfile` (`GET /api/users/me`) when the address itself is needed.
 * There is no PROVIDER role: partners are `VENDOR`.
 */
export type PartnerUser = {
  id: string;
  email: string | null;
  phoneNumber: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImage: string | null;
  role: "CUSTOMER" | "VENDOR" | "ADMIN";
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  isActive: boolean;
  isBanned: boolean;
  createdAt: string;
};

/**
 * `GET /api/users/me` → `data.user` (lib/format.ts `publicUser`) — the decrypted account profile and
 * its preference flags. No `role` here. `walletBalance` is the CUSTOMER wallet of this login, NOT the
 * partner's earnings — never show it as partner money. `kycStatus` is lowercase here (and "verified"
 * for APPROVED), unlike `ProviderProfile.kycStatus`.
 */
export type PartnerUserProfile = {
  id: string;
  email: string | null;
  phoneNumber: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImage: string | null;
  bio: string | null;
  walletBalance: number;
  totalSpent: number;
  kycStatus: "not_started" | "pending" | "in_review" | "verified" | "rejected";
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  darkMode: boolean;
  notificationsEnabled: boolean;
  emailNotifications: boolean;
  pushNotifications: boolean;
  smsNotifications: boolean;
  preferredLanguage: string;
  createdAt: string;
  referralCode: string | null;
  referralCount: number;
  dateOfBirthSet: boolean;
};

/**
 * `GET /api/providers/me` → `data.provider` (services/provider.service.ts).
 *
 * `email` / `phoneNumber` are raw columns (null for PII-encrypted accounts). `walletBalance` is
 * `providers.wallet_balance` GROSS of reservations — what can be withdrawn is
 * `PartnerPayoutsData.availableBalance`. `currentStatus` is the stored value and may be stale: read
 * `PartnerOperations` for live availability. `breakWindows` is the stored JSON as-is (this endpoint
 * does not validate it; `PartnerOperations.breakWindows` is the validated list). Not sent: emergency
 * contacts (see `PartnerWellbeing`), bank account number / IFSC, reserved balance.
 */
export type ProviderProfile = {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
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
  currentStatus: string;
  pausedAt: string | null;
  pauseReason: string | null;
  timezone: string;
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
  workingDays: string[];
  maxJobsPerDay: number | null;
  maxConcurrentJobs: number;
  breakWindows: Array<{ start: string; end: string }> | null;
  serviceRadiusKm: number | null;
  baseLatitude: number | null;
  baseLongitude: number | null;
  /** Only the services the partner can currently perform. */
  services: Array<{ id: string; name: string }>;
  /** Service ids. */
  serviceCategories: string[];
  certifications: string[];
  serviceRegions: string[];
  paymentMethodPreference: string;
  upiId: string | null;
  bankName: string | null;
  isApproved: boolean;
  isVerified: boolean;
  isActive: boolean;
  isBanned: boolean;
  kycStatus: "NOT_STARTED" | "PENDING" | "IN_REVIEW" | "APPROVED" | "REJECTED";
  badges: string[];
  backgroundCheckStatus: "NOT_DONE" | "PENDING" | "CLEARED" | "FAILED";
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

/**
 * `GET /api/providers/me/operations`, and the `data` of `POST /me/pause` and `/me/resume`
 * (services/partner-operations.service.ts `snapshot`). `capacity.maxConcurrentJobs` /
 * `maxJobsPerDay` are the normalised values the dispatcher uses and may differ from the top-level
 * (stored) ones.
 */
export type PartnerOperations = {
  axis: "AVAILABILITY";
  availabilityState: "OFFLINE" | "AVAILABLE" | "OFFERED" | "ACCEPTING" | "EN_ROUTE" | "ON_JOB" | "PAUSED";
  operationalStatus: "offline" | "available" | "offered" | "accepting" | "en_route" | "on_job" | "paused";
  /** `isOnline` and not restricted — what the online switch shows. */
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
    /** 0..100, integer. */
    utilization: number;
    capacityFull: boolean;
    nextAvailableAt: string | null;
  };
  /** Blocker codes: LIFECYCLE_NOT_ACTIVE | ACCOUNT_RESTRICTED | APPROVAL_PENDING | SKILL_REQUIRED | SERVICE_AREA_REQUIRED. */
  readiness: { ready: boolean; blockers: Array<{ code: string; message: string }> };
  /** `serviceRegions` joined, else the city, else the literal "Not set". Never null. */
  preferredAreaLabel: string;
};

/** `PUT /api/providers/me/online` → `data`. Refusals: 403 ACCOUNT_RESTRICTED; 409 with the first readiness blocker's code. */
export type SetOnlineResult = {
  id: string;
  isOnline: boolean;
  onlineSince: string | null;
  operationalStatus: PartnerOperations["operationalStatus"];
  operations: PartnerOperations;
};

/** Booking status on the wire (Prisma `BookingStatus`, lowercased). There is no bare "cancelled" and no "rescheduled". */
export type PartnerBookingStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "assigned"
  | "en_route"
  | "in_progress"
  | "completed"
  | "cancelled_by_user"
  | "cancelled_by_provider"
  | "expired"
  | "customer_no_show"
  | "provider_no_show";

/** Payment status on the wire (Prisma `PaymentStatus`, lowercased). */
export type PartnerPaymentStatus =
  | "pending"
  | "initiated"
  | "processing"
  | "success"
  | "failed"
  | "refunded"
  | "partially_refunded"
  | "refunding"
  | "expired";

/** Backend `PartnerJobBrief` (lib/service-domain.ts): what was booked. Execution facts only — no prices. */
export type PartnerJobBrief = {
  /** The customer's chosen option ("2 BHK"). Shown to the partner as "Option". */
  variant: string | null;
  /** Who the service is for ("Women"), when the service asks. */
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

/**
 * The address as the partner projection sends it (lib/privacy-policy.engine.ts `toPartnerSafeAddress`).
 *
 * While the booking is ACCEPTED / ASSIGNED / EN_ROUTE / IN_PROGRESS every field is the real value.
 * In ANY other status — an offer, completed, cancelled, expired, a no-show — the server sends the
 * area only: `fullAddress` becomes "city, state, zipCode" (or null), and `addressLine1/2`,
 * `buildingName`, `flatNumber`, `landmark`, `specialInstructions`, `latitude`, `longitude` are null.
 * So: no map pin and no door details on an offer or after the job. Never fall back to old values.
 */
export type PartnerSafeAddress = {
  label: string | null;
  fullAddress: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  buildingName: string | null;
  flatNumber: string | null;
  landmark: string | null;
  /** The customer's access instructions for this address (gate code, which bell, …). */
  specialInstructions: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  latitude: number | null;
  longitude: number | null;
};

/** The booking's frozen quality policy (backend `QualitySnapshot`, lib/service-runtime-policy.ts). */
export type PartnerQualitySnapshot = {
  proofRequired: boolean;
  beforeAfterPhotos: boolean;
  checklist: string[];
  notApplicable?: boolean;
  warrantyDays: number;
  customerConfirmation?: boolean;
  confirmationWindowHours?: number;
  /** "What done means" for this job. Absent on a policy that sets none. */
  completionCriteria?: string[];
  /** True when /complete must carry `professionalConfirmation: true` (409 QUALITY_PROFESSIONAL_CONFIRMATION_REQUIRED otherwise). */
  professionalConfirmation?: boolean;
};

/**
 * One booking as a partner sees it — `GET /api/bookings/:id` → `data.booking` (the DETAIL) and the
 * rows of `GET /api/providers/me/bookings` (the LIST). Both come from the partner projection
 * (allow-list `PARTNER_BOOKING_FIELDS`); keys that only one of them sends are optional and say which.
 *
 * NOT sent to a partner, on either: `startOtpVerifiedAt` (ask `/actions` — `requiredGates` contains
 * "START_OTP_VERIFIED" until the PIN is verified), `cancelledBy`, `paymentMethod`, refund amount /
 * status, the customer's selection prices, `createdAt`.
 *
 * Redaction by stage: only the partner who HOLDS an active job gets the customer's last name, photo
 * and masked phone, and the customer's note (`description`); an offered or past job gets
 * `{ firstName, lastName: null, profileImage: null, phoneMasked: null }` and `description: null`.
 */
export type PartnerBooking = {
  id: string;
  bookingNumber: string;
  status: PartnerBookingStatus;
  /** The booked start. A reschedule moves it (and clears `arrivedAt`). */
  scheduledDate: string;
  completedAt: string | null;
  /** Travel start. Set by the explicit "On my way" action or the GPS geofence. */
  enRouteAt: string | null;
  /** Arrival. Does not change `status`, so it must be read to know the real stage. May go back to null. */
  arrivedAt: string | null;
  startedAt: string | null;
  /** The booking's base amount (before add-ons / fees). A CUSTOMER price, not the partner's earning. */
  amount: number;
  /** What the customer pays. NOT the partner's earning — that is `PartnerJobEarning`, after completion. */
  finalAmount: number;
  paymentStatus: PartnerPaymentStatus;
  /** The server's payment exemption (fee-waived follow-up or audited override); the action mirror reads it. */
  paymentExempt: boolean;
  /** The customer's note for the visit. Non-null only while this partner holds the active job. */
  description: string | null;
  /** Minutes, as the partner declared on accept. */
  eta: number | null;
  customer: {
    firstName: string | null;
    lastName: string | null;
    profileImage: string | null;
    /** Masked ("+91 •••• 1234") — the raw number is never on a booking payload. */
    phoneMasked: string | null;
  };
  service: { id: string; name: string; icon: string | null; basePrice: number };
  /** Null only when the booking has no address row. See `PartnerSafeAddress` for what each stage sends. */
  address: PartnerSafeAddress | null;
  /** The stored add-ons JSON, untyped on the server; the key is absent when there are none. Display `job.addons` instead. */
  addons?: unknown;
  /** What was booked (option, quantity, audience, add-on units, duration). */
  job: PartnerJobBrief;
  /** The preparation snapshot recorded at booking; null for a booking made before it existed. */
  requirements: PartnerRequirementsBrief | null;
  /** §11: set on a case-created rework / revisit visit; null otherwise. */
  followUp: { kind: "REWORK" | "REVISIT"; parentBookingNumber: string | null; caseNumber: string | null } | null;

  /* ---- DETAIL only (`GET /api/bookings/:id`) ---- */
  cancelledAt?: string | null;
  /** The partner's OWN reason, when the partner cancelled. Someone else's words (customer, admin) are never sent: null. */
  cancellationReason?: string | null;
  /** The live-tracking row: its lowercase status, distance travelled (as stored), and the booking's eta. Null before tracking starts. */
  tracking?: { status: string; distance: number | null; eta: number | null } | null;
  /** The frozen execution policy of this booking. */
  execution?: {
    materials: string | null;
    equipment: string | null;
    quality: PartnerQualitySnapshot | null;
    durationMinutes: number | null;
  };

  /* ---- LIST only (`GET /api/providers/me/bookings`) ---- */
  ratingGiven?: boolean;
  /** Stars the customer gave, when rated. */
  rating?: number | null;
  /**
   * The live dispatch window — non-null ONLY on rows of the `status=pending` query. `null` means the
   * row is not an open offer, never "an offer with no deadline": the backend returns a pending row
   * only while its window is open.
   */
  offer?: { dispatchedAt: string; expiresAt: string } | null;
};

/** `GET /api/providers/me/bookings` → `data`. `limit` 1–100 (default 20). No `totalPages`. */
export type PartnerBookingsResponse = {
  bookings: PartnerBooking[];
  total: number;
  page: number;
  limit: number;
};

/** `POST /api/bookings/:id/cancel` as the partner → `data.booking`. The refund fields describe the CUSTOMER's refund. */
export type PartnerCancelResult = {
  booking: {
    id: string;
    status: "cancelled_by_provider";
    refundAmount: number;
    refundStatus: "pending" | "none";
    cancellationFee: number;
    refundMessage: string;
  };
};

/* ---- Job actions (`GET /api/bookings/:id/actions`) ---- */

/**
 * Backend `NoShowPreview` (services/booking-no-show.service.ts), field for field — the unit test
 * compares the two. It never carries an amount; `message` is the server's sentence and the only one
 * the screen shows about fees.
 */
export type NoShowPreview = {
  canReport: boolean;
  waitedMinutes: number | null;
  graceMinutes: number;
  minutesLeft: number | null;
  feeWillApply: boolean;
  feePercent: number;
  reason: "NO_DOOR_PHOTO" | "ARRIVAL_VOUCHED" | "NOT_AT_ADDRESS" | "CUSTOMER_PRESENT" | "NOT_PREPAID" | null;
  hasDoorPhoto: boolean;
  message: string;
};

/**
 * `GET /api/bookings/:id/actions` → `data` (routes/bookings.ts). The authority for what the job
 * screen may offer. 404 NOT_FOUND for a partner who is only OFFERED the job (not yet assigned).
 */
export type JobActionResult = {
  axis: "JOB";
  /** Same value as `stage`. */
  jobState: JobLifecycleStage;
  stage: JobLifecycleStage;
  availableActions: JobAction[];
  primaryAction: JobAction | null;
  /** "PAYMENT_SETTLED" | "START_OTP_VERIFIED" | "REQUIREMENTS_RESOLVED" | "SAFETY_CLEARED" */
  requiredGates: string[];
  /**
   * The server's sentence per disabled action: "Payment confirmation pending", "Customer OTP
   * required" (does NOT disable Start — see `actionControlState`), a gate's message, "Available
   * after the booked time", "Available in N min".
   */
  disabledReasons: Partial<Record<JobAction, string>>;
  /** §6: the START requirement gate. `null` = the gate tables are not deployed. */
  requirementGate: JobGateSummary | null;
  /** §9: ACTIVE safety holds + open incidents. Never null. */
  safetyGate: JobGateSummary;
  paymentExempt: boolean;
  /** §52: present only while REPORT_NO_SHOW is on offer and the caller holds the job. */
  noShow?: NoShowPreview;
};

/** `POST /api/bookings/:id/no-show` → the envelope's `message` plus its `data` block. */
export type NoShowReportResult = {
  /** The server's sentence ("No-show recorded"). */
  message: string;
  /** "customer_no_show" */
  status: string;
  /** The fee the server recorded; 0 when none was taken. */
  feeAmount: number;
  /** Present only when the fee was withheld, with `feeNote` saying why in the server's words. */
  feeWithheld?: "NO_DOOR_PHOTO" | "ARRIVAL_VOUCHED" | "NOT_AT_ADDRESS" | "CUSTOMER_PRESENT";
  feeNote?: string;
};

/** §9: one thing blocking START / COMPLETE (`data.blocking` on a 409 SAFETY_HOLD_ACTIVE). */
export type SafetyBlocking =
  | { kind: "SAFETY_HOLD"; holdId: number; condition: string }
  | { kind: "SAFETY_INCIDENT"; incidentId: string; type: string };

/* ---- Evidence (`/api/bookings/:id/evidence`) ---- */

export type JobEvidenceStage = "ARRIVAL" | "START" | "COMPLETION";

/**
 * One evidence row as the partner sees it (services/job-evidence.service.ts). The partner sees only
 * their own rows. Not sent to a partner: `mediaUrl`, the storage key, and where the proof was captured.
 */
export type JobEvidenceItem = {
  id: string;
  bookingId: string;
  providerId: string;
  stage: JobEvidenceStage;
  capturedAt: string;
  /** "image/jpeg" | "image/png" | "image/webp"; null on a row without a stored photo. */
  mediaMimeType: string | null;
  /** False once the photo was replaced. */
  isCurrent: boolean;
  /** The id the uploader sent ("<id>#2", "#3" for the later photos of one upload); null on system rows. */
  clientUploadId: string | null;
  /**
   * A path ON THE API (`/api/bookings/:id/evidence/:evidenceId/media`) that answers only with the
   * bearer token — use `partnerApi.evidenceImageSource(row)`. Null when the row has no stored photo
   * (the system's position stamps, legacy rows).
   */
  mediaAccessUrl: string | null;
  /** e.g. `{ bytes, width, height }`. */
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

/** `POST /api/bookings/:id/evidence` → `data.evidence`: the FIRST row written (no `mediaAccessUrl` — re-list to show it). */
export type JobEvidenceUploadResult = {
  id: string;
  bookingId: string;
  stage: JobEvidenceStage;
  capturedAt: string;
  mediaMimeType: string | null;
  isCurrent: boolean;
  clientUploadId: string | null;
  /** How many photos this upload stored. */
  photoCount: number;
  createdAt: string;
};

/* ---- Chat (`/api/bookings/:id/chat`) ---- */

export type JobChatMessage = {
  id: string;
  senderUserId: string;
  body: string;
  clientMessageId: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
};

/** Oldest first. `nextCursor` is an ISO `createdAt` to pass back as `cursor`. */
export type JobChatList = {
  conversationId: string;
  messages: JobChatMessage[];
  nextCursor: string | null;
};

/* ---- Money ----
 *
 * A partner has NO ledger endpoint: nothing lists the provider wallet's individual credits and debits
 * with a running balance. `/api/wallet/balance` and `/api/wallet/transactions` are the CUSTOMER
 * wallet of the same login and must not be shown as partner money. What exists, and is real:
 *   balance            GET /api/providers/me/payouts      (PartnerPayoutsData)
 *   earnings per day   GET /api/providers/me/earnings     (PartnerEarningsSummary)
 *   earnings per job   GET /api/providers/me/invoices     (PartnerInvoices.earnings)
 *                      GET /api/providers/me/bookings/:id/earning  (PartnerJobEarning)
 *   money out          GET /api/providers/me/withdrawals  (PartnerWithdrawal[])  and payouts.withdrawals
 * Tips, referral rewards, bonuses and reversals posted to the provider wallet are not itemised anywhere.
 */

/**
 * `GET /api/providers/me/earnings?days=` (1..365, default 30) → `data`
 * (services/provider.service.ts). Only CREDITED earnings count. All amounts are whole rupees.
 */
export type PartnerEarningsSummary = {
  /** A LABEL, e.g. "Last 30 days" — not a key. */
  period: string;
  totalJobs: number;
  totalGross: number;
  totalCommission: number;
  totalNet: number;
  /** GROSS per job. */
  averagePerJob: number;
  /** NET per job. */
  averageNetPerJob: number;
  /** Exactly `days` entries, ascending, zero-filled; `date` is YYYY-MM-DD (UTC), `amount` is net. */
  series: Array<{ date: string; amount: number }>;
};

/** One line of a job's earning, in the server's own words and numbers. */
export type PartnerEarningLine = {
  key: "gross" | "commission" | "adjustment" | "net";
  label: string;
  /** Always positive; `kind` says which way it moves. */
  amount: number;
  kind: "base" | "debit" | "credit" | "total";
};

/**
 * `GET /api/providers/me/bookings/:bookingId/earning` → `data.earning` (lib/earning-settlement.ts).
 * Exists only once the job completed and paid out; before that the server answers 404
 * `EARNING_NOT_FOUND` (the client returns null) and nothing is estimated. Lines: gross (base),
 * commission (debit), an optional adjustment ("Performance bonus" credit / "Adjustment" debit), net
 * (total, always last) — rendered verbatim, never recomputed.
 */
export type PartnerJobEarning = {
  earningId: string;
  /** The same `ERN-…` number the invoices list shows. */
  invoiceNumber: string;
  bookingId: string;
  settlement: "CREDITED" | "REVERSED";
  earnedAt: string;
  lines: PartnerEarningLine[];
  net: number;
};

/** One payout attempt of a withdrawal (the stored row). */
export type PartnerPayoutAttempt = {
  id: string;
  withdrawalId: string;
  attemptNo: number;
  status: string;
  razorpayPayoutId: string | null;
  failureReason: string | null;
  createdAt: string;
};

/**
 * A withdrawal as `GET /api/providers/me/payouts` lists it (max 50, newest first). `status` is a
 * DISPLAY label here: REQUESTED and APPROVED both read "Pending", CANCELLED reads "Reversed", and
 * the enum value REVERSED arrives unmapped as "REVERSED". `bank` is always the literal "Bank".
 * There is no `requestedAt` and no `failureReason` on this row — `PartnerWithdrawal` has them.
 */
export type PartnerWithdrawalRow = {
  id: string;
  /** The withdrawal number. */
  reference: string;
  amount: number;
  fee: number;
  /** Always 0. */
  tax: number;
  netAmount: number;
  status: "Pending" | "Processing" | "Completed" | "Failed" | "Reversed" | "REVERSED";
  bank: string;
  /** When the payout completed. */
  settlementDate: string | null;
  razorpayPayoutId: string | null;
  /** Max 5, newest first. */
  attempts: PartnerPayoutAttempt[];
};

/** `GET /api/providers/me/payouts` → `data` (services/earnings.service.ts). The partner's balance lives here. */
export type PartnerPayoutsData = {
  axis: "FINANCE";
  financeState: "EARNING_POSTED" | "PENDING" | "AVAILABLE" | "WITHDRAWAL_REQUESTED" | "PROCESSING" | "PAID" | null;
  /** `providers.wallet_balance`, gross of reservations. */
  currentBalance: number;
  /** What can be withdrawn now: balance minus reservations, never below 0. */
  availableBalance: number;
  /** Sum of withdrawals still REQUESTED / APPROVED / PROCESSING. */
  pendingBalance: number;
  /** Net, CREDITED earnings, all time. */
  lifetimeEarnings: number;
  lifetimeGross: number;
  nextPayoutDate: string | null;
  withdrawals: PartnerWithdrawalRow[];
  /**
   * Net earnings by period over the last 365 days, SPARSE (no zero-fill). Keys: daily `YYYY-MM-DD`,
   * weekly `YYYY-W<n>` (week of the month, not an ISO week), monthly `YYYY-MM`, yearly `YYYY`.
   * It is an aggregate, not a ledger: do not present its rows as transactions.
   */
  analytics: {
    daily: Array<{ period: string; amount: number }>;
    weekly: Array<{ period: string; amount: number }>;
    monthly: Array<{ period: string; amount: number }>;
    yearly: Array<{ period: string; amount: number }>;
  };
};

/**
 * A withdrawal as `GET /api/providers/me/withdrawals` lists it — the latest 20, newest first, no
 * paging. `status` is the RAW enum here (unlike `PartnerWithdrawalRow.status`).
 */
export type PartnerWithdrawal = {
  id: string;
  withdrawalNumber: string;
  amount: number;
  netAmount: number;
  processingFee: number;
  status: "REQUESTED" | "APPROVED" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED" | "REVERSED";
  razorpayPayoutId: string | null;
  razorpayStatus: string | null;
  failureReason: string | null;
  bankName: string;
  requestedAt: string;
  processedAt: string | null;
  completedAt: string | null;
  payoutAttempts: PartnerPayoutAttempt[];
};

/** `POST /api/wallet/withdraw` body. `idempotencyKey` (8–128 chars) goes in the BODY: a repeat returns the same withdrawal. */
export type WithdrawRequest = {
  /** Positive, at most 1,000,000. */
  amount: number;
  /** 9–18 digits. */
  bankAccountNumber: string;
  ifscCode: string;
  /** 2–100 characters. */
  accountHolder: string;
  idempotencyKey?: string;
};

/** `POST /api/wallet/withdraw` → `data.withdrawal` (HTTP 201). `status` is lowercase ("requested"). */
export type WithdrawResult = {
  id: string;
  withdrawalNumber: string;
  amount: number;
  status: string;
  createdAt: string;
};

/**
 * `GET /api/providers/me/reviews` → one review (services/provider.service.ts). There is no booking,
 * no service and no customer last name on a review.
 */
export type PartnerReview = {
  id: string;
  /** Stars, 1–5. */
  rating: number;
  reviewText: string | null;
  user: { firstName: string | null; profileImage: string | null };
  photos: string[];
  tipAmount: number | null;
  helpfulCount: number;
  /** The partner's reply (`POST /api/ratings/:id/respond`); a second reply overwrites it. */
  providerResponse: string | null;
  respondedAt: string | null;
  createdAt: string;
};

/** `GET /api/providers/me/reviews?page=&limit=&rating=` → `data`. No `limit` / `averageRating` in the answer. */
export type PartnerReviewsResponse = {
  reviews: PartnerReview[];
  total: number;
  page: number;
  /** Keys "5".."1", always all five, and NOT narrowed by the `rating` filter. */
  ratingBreakdown: Record<string, number>;
};

/** `POST /api/ratings/:id/respond` → `data.rating`. */
export type RatingResponseResult = { id: string; providerResponse: string | null; respondedAt: string | null };

/**
 * One row of `GET /api/notifications` (services/notification.service.ts). There is NO `data` and no
 * `bookingId` on a row: `referenceId` is the booking id on booking notifications (types starting
 * with "BOOKING" / "booking") and some other id otherwise — route with
 * `resolveNotificationHref(row)`. `type` is free text on the server (BOOKING_REQUEST, …, and
 * lowercase ad-hoc values such as "review_reply").
 */
export type PartnerNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  referenceId: string | null;
  /** What `referenceId` is ("booking", …). Absent on an older server build. */
  referenceType?: string | null;
  isRead: boolean;
  imageUrl: string | null;
  createdAt: string;
};

/** `GET /api/notifications` → `data`. `unreadCount` is the account's total unread, whatever the filters. */
export type PartnerNotificationsResponse = {
  notifications: PartnerNotification[];
  total: number;
  unreadCount: number;
  page: number;
};

/* ---- Membership (`/api/subscriptions/*`) — the CUSTOMER membership programme. A partner login may
 * call it, but nothing in it is partner-specific; plans are the stored rows. ---- */

export type MembershipPlanBenefit = {
  id: string;
  planId: string;
  label: string;
  sortOrder: number;
  quotaLimit: number | null;
  quotaPeriod: string | null;
  type: string | null;
  value: number | null;
};

/** `GET /api/subscriptions/plans` → `data.plans[]` (active plans only). `price` is whole rupees. */
export type PartnerMembershipPlan = {
  id: string;
  name: string;
  tier: string;
  interval: "MONTHLY" | "QUARTERLY" | "YEARLY";
  price: number;
  currency: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  benefits: MembershipPlanBenefit[];
};

export type PartnerSubscription = {
  id: string;
  userId: string;
  planId: string;
  status: "PENDING" | "ACTIVE" | "CANCELLED" | "EXPIRED";
  startsAt: string | null;
  expiresAt: string | null;
  autoRenew: boolean;
  cancelledAt: string | null;
  razorpayOrderId: string | null;
  createdAt: string;
  updatedAt: string;
  plan: PartnerMembershipPlan;
};

/** `GET /api/subscriptions/me` → `data`. `history` is newest first. */
export type PartnerMembershipData = {
  active: PartnerSubscription | null;
  history: PartnerSubscription[];
};

/** `GET /api/subscriptions/entitlements` → `data` (services/entitlement.service.ts). */
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
  /** Typed benefits only; display-only labels are not included. */
  benefits: Array<{ type: string; value: number | null; label: string }>;
};

/* ---- Support tickets (`/api/support/tickets`) ---- */

/** A row of the list, and the base of the detail. `priorityLevel` and `status` are lowercase. */
export type PartnerSupportTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  category: string;
  priorityLevel: "high" | "normal" | "low";
  status: "open" | "in_progress" | "resolved" | "closed";
  slaDueAt: string | null;
  firstResponseAt: string | null;
  responseTimeMs: number | null;
  slaBreached: boolean;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
};

/** `authorRole` is "partner" / "user" for the caller's side; internal notes are never sent. */
export type PartnerSupportMessage = { id: string; body: string; authorRole: string; createdAt: string };

/** `GET /api/support/tickets/:id` → `data.ticket`. */
export type PartnerSupportTicketDetail = PartnerSupportTicket & {
  attachments: string[];
  bookingId: string | null;
  messages: PartnerSupportMessage[];
};

/** `POST /api/support/tickets` body. */
export type CreateSupportTicketBody = {
  /** 3–200 characters. */
  subject: string;
  /** 10–5000 characters. */
  description: string;
  /** Free text, 2–80 characters (not an enum on the server). */
  category: string;
  /** A booking id or booking number; 404 BOOKING_NOT_FOUND / 403 BOOKING_ACCESS_DENIED otherwise. */
  bookingId?: string;
  attachments?: string[];
  /** HIGH is honoured only with a membership / priority support; otherwise recorded as NORMAL. */
  priorityLevel?: "HIGH" | "NORMAL" | "LOW";
};

/** `POST /api/support/tickets` → `data.ticket`: a SHORT row, not the full ticket. */
export type CreatedSupportTicket = {
  id: string;
  ticketNumber: string;
  priorityLevel: "high" | "normal" | "low";
  slaDueAt: string | null;
  status: "open";
  createdAt: string;
};

/* ---- Sessions and account security (`/api/auth/*`) ---- */

export type AuthSession = {
  id: string;
  deviceId: string | null;
  deviceName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  lastActivityAt: string | null;
  familyId: string | null;
  createdBy: string | null;
  isCurrent: boolean;
};

/** `GET /api/auth/sessions` → `data`. */
export type AuthSessionsResponse = { sessions: AuthSession[]; currentSessionId: string | null };

/* ---- Documents (`/api/providers/me/documents`) ---- */

/**
 * A row of `GET /api/providers/me/documents`. The file itself is NOT listed (`documentUrl` is not
 * sent), so the app cannot preview an uploaded document from this list.
 */
export type PartnerDocument = {
  id: string;
  documentType: string;
  documentName: string | null;
  fileSize: number | null;
  fileFormat: string | null;
  uploadStatus: string;
  uploadedAt: string;
  isVerified: boolean;
  expiryDate: string | null;
  issuer: string | null;
  issueDate: string | null;
};

/** `POST /api/providers/me/documents` body. `file` is base64 or a data URL — PDF, JPG, PNG or WebP, at most 5 MB. */
export type UploadDocumentBody = {
  file: string;
  /** Free text, cut to 80 characters (not an enum on the server). */
  documentType: string;
  fileName?: string;
  expiryDate?: string;
  issuer?: string;
  issueDate?: string;
};

/* ---- Safety (`/api/providers/me/safety/*`) ---- */

export type SafetyReportType = "ACCIDENT" | "THREAT" | "MEDICAL" | "CUSTOMER_SAFETY" | "PARTNER_SAFETY" | "LOCATION_DANGER" | "OTHER";

/** A row of `GET /api/providers/me/safety/incidents` (the latest 20). */
export type PartnerSafetyIncident = {
  id: string;
  type: string;
  status: string;
  severity: string;
  createdAt: string;
  resolvedAt: string | null;
  bookingId: string | null;
};

export type EmergencyContact = { emergencyContactName: string | null; emergencyContactPhone: string | null };

/* ---- Partner intelligence (`/api/providers/me/intel/*`) ----
 *
 * Four feature-flagged reads (services/performance-nudges, shift-planning, earnings-coach,
 * zone-recommendation). Each flag is OFF unless a row enables it, and there is no seed for any of
 * them: the route then answers 404 NOT_FOUND and the client method returns `null`. Treat `null` as
 * "not available" — never as an empty result.
 *
 * Every answer is a STATE first. Gate what is shown on `state` (and on a reason's / metric's own
 * `state`), not on whether a number happens to be non-null: several non-OK states still carry numbers.
 * `reasonCode` is absent (not null) when there is nothing to explain.
 */
export type IntelFreshness = "REAL_TIME" | "NEAR_REAL_TIME" | "HISTORICAL" | "FORECAST" | "STATIC" | "UNKNOWN";

export type NudgeMetricCode = "ACCEPTANCE_RATE" | "COMPLETION_RATE" | "PROVIDER_CANCELLATION_RATE" | "AVERAGE_RATING";
export type NudgeMetricEvidence = {
  metric: NudgeMetricCode;
  state: "OK" | "INSUFFICIENT_HISTORY" | "NO_BASELINE";
  definition: string;
  /** Rates: percent 0–100. AVERAGE_RATING: stars. Can be non-null in a non-OK state — show only when `state === "OK"`. */
  currentValue: number | null;
  baselineValue: number | null;
  currentSample: number;
  baselineSample: number;
  change: number | null;
  adjustedChange: number | null;
  significanceThreshold: number | null;
  significant: boolean;
  period: { currentFrom: string; currentTo: string; baselineFrom: string; baselineTo: string };
  source: string;
  observedAt: string;
  confidence: number | null;
  reasonCode?: string;
};
export type PartnerNudge = {
  metric: NudgeMetricCode;
  severity: "INFO" | "OPPORTUNITY" | "IMPROVEMENT" | "WARNING";
  /** The server's sentence. */
  message: string;
  evidence: NudgeMetricEvidence;
};
/** `GET /api/providers/me/intel/nudges` (flag PARTNER_PERFORMANCE_NUDGES). `state: "OK"` with no nudges is normal. */
export type PartnerNudges = {
  state: "OK" | "INSUFFICIENT_HISTORY" | "PROVIDER_NOT_FOUND";
  rulesVersion: string;
  generatedAt: string;
  windowDays: number;
  nudges: PartnerNudge[];
  metrics: NudgeMetricEvidence[];
  reasonCode?: string;
};

export type PartnerTimeWindow = {
  /** 0–23. */
  hourOfDay: number;
  jobsInWindow: number;
  /** Multiple of the partner's average active hour. */
  concentration: number;
  basis: "PARTNER" | "PLATFORM";
};
export type ShiftConflict = { code: string; detail: string; severity: "INFO" | "CAUTION" };
export type ShiftReason = {
  code: "WINDOWS" | "ZONES" | "AVAILABILITY" | "WEATHER" | "DEMAND" | "LOCATION" | "ACTIVE_JOBS";
  state: "CONTRIBUTED" | "UNAVAILABLE" | "INSUFFICIENT_HISTORY" | "STALE";
  /** A DEMAND reason in state STALE still carries a number (an elapsed forecast) — not current demand. */
  value: string | number | null;
  detail: string;
  source: string | null;
  observedAt: string | null;
  freshness: IntelFreshness;
  reasonCode?: string;
};
/** `GET /api/providers/me/intel/shift-plan?target=` (flag PARTNER_SHIFT_PLANNING). */
export type PartnerShiftPlan = {
  state: "OK" | "INSUFFICIENT_DATA" | "PROVIDER_NOT_FOUND";
  rulesVersion: string;
  contextRulesVersion: string;
  zoneRulesVersion: string;
  coachRulesVersion: string;
  generatedAt: string;
  /** "HH:00"; null when there are no recommended windows (possible even when `state` is OK). */
  recommendedStart: string | null;
  recommendedEnd: string | null;
  recommendedWindows: PartnerTimeWindow[];
  priorityZones: Array<{ zoneId: string; name: string; score: number; rank: number; distanceKm: number | null }>;
  travelConsiderations: { locationState: "LIVE" | "STALE" | "UNAVAILABLE"; farthestPriorityZoneKm: number | null; routeAvailable: boolean };
  conflicts: ShiftConflict[];
  /** 0–1. Both are 0 on PROVIDER_NOT_FOUND — a state, not a measurement. */
  coverage: number;
  confidence: number;
  reasons: ShiftReason[];
  degraded: string[];
  reasonCode?: string;
};

export type CoachReason = {
  code: "REALISED_TODAY" | "AVG_NET_PER_JOB" | "JOBS_NEEDED" | "THROUGHPUT" | "TIME_WINDOW" | "ZONES" | "DEMAND";
  state: "CONTRIBUTED" | "UNAVAILABLE" | "INSUFFICIENT_HISTORY";
  value: number | string | null;
  detail: string;
  source: string | null;
  observedAt: string | null;
  reasonCode?: string;
};
/**
 * `GET /api/providers/me/intel/earnings-coach?target=` (flag PARTNER_EARNINGS_COACH).
 * `realized`, `target` and `opportunity` are null when there is no history to compute them from.
 * With no target (or 0) the state is OK with `estimatedJobsNeeded: 0` — show "jobs needed" only when
 * `target.amount > 0`. `realized.trailing7d` / `trailing30d` are filled from the forecast read's
 * weekly / monthly figures — not independently verified here as "earned" totals.
 */
export type PartnerEarningsCoach = {
  state: "OK" | "INSUFFICIENT_HISTORY" | "PROVIDER_NOT_FOUND" | "TARGET_ALREADY_MET";
  rulesVersion: string;
  contextRulesVersion: string;
  generatedAt: string;
  realized: { today: number; trailing7d: number; trailing30d: number; currency: "INR" } | null;
  target: { amount: number; remainingGap: number; alreadyMet: boolean } | null;
  opportunity: {
    averageNetPerJob: number;
    standardError: number;
    estimatedJobsNeeded: number;
    jobsNeededRange: [number, number];
    sampleSize: number;
    confidence: number;
  } | null;
  feasibility: {
    band: "WITHIN_TYPICAL_DAY" | "REQUIRES_BEST_DAY" | "ABOVE_OBSERVED_CAPACITY" | "UNKNOWN";
    typicalJobsPerActiveDay: number | null;
    bestObservedDay: number | null;
  };
  recommendedZones: Array<{ zoneId: string; name: string; score: number; rank: number }>;
  timeWindows: PartnerTimeWindow[];
  reasons: CoachReason[];
  degraded: string[];
  reasonCode?: string;
};

export type ZoneReason = {
  code: "UNMET_DEMAND" | "SURGE" | "DEMAND_TREND" | "TRAVEL" | "PARTNER_HISTORY" | "COMPETITION";
  state: "CONTRIBUTED" | "UNAVAILABLE" | "INSUFFICIENT_HISTORY";
  value: number | null;
  /** 0–100; null unless CONTRIBUTED. This — not `value` — says whether the dimension counted. */
  subScore: number | null;
  weight: number;
  source: string | null;
  observedAt: string | null;
  reasonCode?: string;
};
export type PartnerZoneRecommendation = {
  zoneId: string;
  name: string;
  city: string | null;
  rank: number;
  /** 0–100. It is 0 when NO dimension contributed (`coverage === 0`) — that is "unknown", not "poor". */
  score: number;
  coverage: number;
  confidence: number;
  reasons: ZoneReason[];
  evidence: {
    activeBookings: number | null;
    supply: number | null;
    predictedSurge: number | null;
    weatherSurge: number | null;
    demandDeltaPct: number | null;
    distanceKm: number | null;
    partnerJobsInZone: number;
    /** GROSS booking totals in rupees — not the partner's net earnings. */
    partnerEarningsInZone: number;
    platformScore: number | null;
    platformDemandScore: number | null;
    platformEarningScore: number | null;
  };
};
/** `GET /api/providers/me/intel/zones?limit=` (1–50, default 10; flag PARTNER_ZONE_RECOMMENDATIONS). The partner-safe zone read — `/api/geo-intel/zone-scoring` is admin-only. */
export type PartnerZoneRecommendations = {
  state: "OK" | "UNAVAILABLE";
  recommendations: PartnerZoneRecommendation[];
  degraded: string[];
  rulesVersion: string;
  contextRulesVersion: string;
  generatedAt: string;
  reasonCode?: string;
};

/* ---- Partner network (`/api/providers/me/network`) — the partner-refers-partner programme ---- */

export type PartnerNetworkReferral = {
  id: string;
  name: string;
  status: "INVITED" | "REGISTERED" | "VERIFIED" | "TRAINING" | "ACTIVE" | "FIRST_JOB" | "QUALIFIED" | "REWARD_RELEASED";
  jobs: number;
  jobTarget: number;
  qualificationLabel: "Pending" | "Eligible" | "Qualified" | "Rewarded";
  nextMilestone: string;
  /** Set only once the reward was credited. */
  rewardAmount: number | null;
  invitedAt: string;
  registeredAt: string | null;
  qualifiedAt: string | null;
  rewardedAt: string | null;
};

/** `GET /api/providers/me/network` → `data` (max 100 referrals). `rewardPerQualified` and `jobTarget` are the server's. */
export type PartnerNetworkDashboard = {
  code: string;
  shareUrl: string;
  rewardPerQualified: number;
  jobTarget: number;
  counts: { invited: number; registered: number; verified: number; training: number; active: number; firstJob: number; qualified: number; rewarded: number };
  totalRewarded: number;
  referrals: PartnerNetworkReferral[];
};

/** `POST /api/providers/me/network/invite` → `data`. Refusals: 409 CONFLICT, 400 VALIDATION. */
export type PartnerNetworkInviteResult = {
  referralId: string;
  leadId: string;
  status: "INVITED";
  code: string;
  shareUrl: string;
  inviteUrl: string;
  expiresAt: string;
};

/* ---- Service area ---- */

export type ServiceAreaZone = { id: string; name: string; zoneType: string; city: string | null };

/** `PUT /api/providers/me/service-area` → `data`. */
export type ServiceAreaResult = {
  city: string | null;
  serviceRegions: string[];
  serviceRadiusKm: number | null;
  baseLatitude: number | null;
  baseLongitude: number | null;
  coverageZones: Array<{ id: string; name: string }>;
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

/**
 * `GET /api/providers/me/forecast`. Only `todayProjection` is a forecast (`basis…predictive: true`);
 * the weekly and monthly figures are TRAILING ACTUALS (`predictive: false`) — label them as such.
 */
export type PartnerForecast = {
  todayProjection: number;
  weeklyProjection: number;
  monthlyProjection: number;
  basis: {
    todayProjection: { method: string; predictive: true; source: string; freshness: string; confidence: number | null; asOf: string };
    weeklyProjection: PartnerTrailingBasis;
    monthlyProjection: PartnerTrailingBasis;
  };
  inputs: {
    todayEarnings: number;
    weekEarnings: number;
    monthEarnings: number;
    avgPerJob: number;
    demandPredicted: number;
    confidence: number | null;
  };
};
export type PartnerTrailingBasis = {
  method: string;
  predictive: false;
  growthAssumptionApplied: false;
  source: string;
  freshness: string;
  state: "OK" | "INSUFFICIENT_HISTORY";
  asOf: string;
};

export type PartnerIntelligence = {
  periodDays: number;
  uniqueCustomers: number;
  returningCustomers: number;
  repeatCustomerRatePct: number;
};

/**
 * `GET /api/providers/me/rankings` → `data`, which is `null` (with `success: true`) when the provider
 * row is missing. The server has no area ranking: `areaRank` / `areaTotal` are COPIES of the city
 * values — do not present them as a separate area rank.
 */
export type PartnerRankings = {
  cityRank: number;
  cityTotal: number;
  areaRank: number;
  areaTotal: number;
  areaName: string | null;
  city: string | null;
  compositeScore: number;
  categoryRanks: Array<{ category: string; rank: number; total: number; score: number }>;
};

export type PartnerScoreComponent = { value: number | null; weight: number };

/** `GET /api/providers/me/score` (services/partner-score.service.ts). `overallScore` is null until there is enough data. */
export type PartnerScorecard = {
  policyVersion: string;
  overallScore: number | null;
  band: string;
  components: {
    quality: PartnerScoreComponent;
    reliability: PartnerScoreComponent;
    completion: PartnerScoreComponent;
    onTime: PartnerScoreComponent;
    customerSatisfaction: PartnerScoreComponent;
    compliance: PartnerScoreComponent;
    safety: PartnerScoreComponent;
  };
  sample: { completedJobs: number; ratings: number; arrivals: number; assignments: number };
  calculatedAt: string;
  /** Keys "7d" | "30d" | "90d". */
  trends: Record<string, { delta: number | null; insufficient: boolean }>;
};

/** `GET /api/providers/me/score/history?page=&limit=` (limit default 20, max 50). */
export type PartnerScoreHistoryPage = {
  items: Array<{
    id: string;
    previousScore: number | null;
    newScore: number | null;
    previousBand: string | null;
    newBand: string;
    delta: number | null;
    reasons: Array<{ code?: string; component?: string; delta?: number; detail: string; evidenceCount?: number }>;
    policyVersion: string;
    calculatedAt: string;
  }>;
  page: number;
  limit: number;
  total: number;
};

export type PartnerCareerRequirement = {
  id: string;
  label: string;
  current: number;
  target: number;
  met: boolean;
  unit: "jobs" | "rating" | "percent" | "count";
};

/** `GET /api/providers/me/career` (lib/partner-career-policy.ts). */
export type PartnerCareer = {
  currentLevel: string;
  eligibleLevel: string;
  nextLevel: string | null;
  progressPct: number;
  remainingRequirements: PartnerCareerRequirement[];
  requirements: PartnerCareerRequirement[];
  qualificationState: "QUALIFIED" | "IN_PROGRESS" | "BENEFITS_RESTRICTED" | "GRACE_MAINTAINED";
  benefitsActive: boolean;
  careerPriorityBoost: number;
  policyVersion: string;
  badges: Array<{ code: string; label: string; awardedAt: string; reason: string }>;
};

/** `GET /api/providers/me/career/history?page=&limit=`. */
export type PartnerCareerHistoryPage = {
  items: Array<{ id: string; previousLevel: string | null; newLevel: string; reason: string; createdAt: string }>;
  page: number;
  limit: number;
  total: number;
};

/** `GET /api/providers/me/lifecycle` (services/partner-lifecycle.service.ts). */
export type PartnerLifecycle = {
  axis: "LIFECYCLE";
  lifecycleState: string;
  allowedTransitions: string[];
  dispatchEligible: boolean;
  availability: { isOnline: boolean; pausedAt: string | null; currentStatus: string };
  isApproved: boolean;
  isActive: boolean;
  complianceRestricted: boolean;
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

export type PartnerComplianceDocument = {
  id: string;
  documentType: string;
  documentName: string | null;
  issuer: string | null;
  issueDate: string | null;
  isVerified: boolean;
  expiryDate: string | null;
  expiryState: string;
  daysToExpiry: number | null;
  cta: string;
  category: string;
  expiringSoon: boolean;
};

/** `GET /api/providers/me/compliance` (services/partner-os.service.ts). */
export type PartnerCompliance = {
  status: string;
  explanation: string;
  restricted: boolean;
  restrictionReason: string | null;
  documents: PartnerComplianceDocument[];
  verification: { isVerified: boolean; kycStatus: string; backgroundCheckStatus: string; backgroundCheck: unknown };
  complianceScore: number;
  expiringSoon: number;
  certifications: string[];
  /** The documents whose `category` is "insurance". */
  insurance: PartnerComplianceDocument[];
};

/**
 * `GET /api/providers/me/wellbeing`: the platform's wellbeing configuration row plus the partner's
 * emergency contact. Only the keys this app reads are named; the row has other columns.
 */
export type PartnerWellbeing = {
  sosPhone: string | null;
  insuranceUrl: string | null;
  communityUrl: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
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

/** One earning as the invoices list shows it. `id` is the earning id — the `:id` of `getEarningInvoice`. */
export type PartnerEarningInvoice = {
  id: string;
  /** `ERN-<last 8 of the id>`. */
  invoiceNumber: string;
  service: string;
  gross: number;
  commission: number;
  net: number;
  date: string;
};

/** One withdrawal as the invoices list shows it. `status` is the lowercase enum ("requested", "completed", …). */
export type PartnerSettlement = {
  id: string;
  settlementNumber: string;
  amount: number;
  netAmount: number;
  status: string;
  date: string;
};

/**
 * `GET /api/providers/me/invoices` (services/invoice-report.service.ts): up to 100 earnings and 50
 * settlements. The earnings are NOT filtered to credited ones — a REVERSED earning is listed too and
 * the row carries no field that says so (`getBookingEarning` does: `settlement`).
 */
export type PartnerInvoices = {
  earnings: PartnerEarningInvoice[];
  settlements: PartnerSettlement[];
};

/**
 * `GET /api/providers/me/tax-summary`. Read the caveats before showing it: the totals are ALL-TIME
 * (not scoped to a year) although `financialYear` is the current calendar year; `estimatedTax` and
 * `tdsEstimate` are the same server-side estimate (net × a fixed rate), not a tax computation.
 */
export type PartnerTaxSummary = {
  financialYear: number;
  grossEarnings: number;
  platformCommission: number;
  netEarnings: number;
  settledOut: number;
  estimatedTax: number;
  gstOnCommission: number;
  tdsEstimate: number;
};

/* ---- Geo-intelligence (`/api/geo-intel/*`) ----
 * Open to a partner (role VENDOR): /surge, /provider-density, /demand-forecast, /eta.
 * ADMIN ONLY: /zone-scoring (403 FORBIDDEN for a partner) — there is no client method for it.
 */

/**
 * The geo-intel envelope: unlike every other route, the service result is spread at the TOP level
 * next to `data`. `confidence` is 0..1; `freshness` and `generatedAt` are ISO strings.
 */
export type GeoIntel<T> = {
  data: T;
  confidence: number;
  freshness: string;
  source: string;
  cached: boolean;
  generatedAt: string;
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
  liveSupply: number;
  freshLocationSupply: number;
  supplyConfidence: number;
  customerLabel: string;
};

/**
 * `stale` and `forecastWindow` come from the API: the warehouse model projects from the end of its
 * training data, so the points can describe hours that have already passed. Do not render them as a
 * forecast of the coming day when `stale` is true.
 */
export type DemandForecast = {
  horizonHours: number;
  points: Array<{ zone_id: string; hour: string; predicted: number; lo: number; hi: number }>;
  totalPredicted: number;
  stale: boolean;
  forecastWindow: { from: string | null; to: string | null };
  expiredByHours: number | null;
  staleAfterHours: number;
  limitations: string[];
};

/**
 * `GET /api/geo-intel/demand-forecast`: either the forecast, or — HTTP 200 — the statement that the
 * forecast source did not answer. The unavailable answer carries no numbers; render it as a state.
 */
export type DemandForecastResult =
  | ({ available: true } & GeoIntel<DemandForecast>)
  | { available: false; reasonCode: "FORECAST_SOURCE_UNAVAILABLE"; cause: string; reason: string; data: null; generatedAt: string };

export type GeoEta = { etaMin: number; distanceKm: number; method: string; withTraffic?: boolean };

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

/* ---- Phase 10 §9 — booking safety (mirror of backend SafetySnapshot, partner view) ---- */
export type BookingSafetyView = {
  gate: { ok: boolean; message: string };
  safety: {
    prohibitedConditions: string[];
    warnings: string[];
    customerRequirements: string[];
    providerRequirements: string[];
    information: string | null;
    medicalDisclaimer: string | null;
    emergencyProtocol: string | null;
    /** Empty / null on bookings frozen before these fields existed. */
    ppe: string[];
    chemicalRestrictions: string[];
    incidentProtocol: string | null;
  } | null;
  /** Prohibited conditions the partner can report right now; empty when reporting is not available. */
  canReport: string[];
  /** False while the safety-hold tables are not deployed. */
  holdsEnforced: boolean;
  /** Holds on this booking (released ones included). */
  holds: Array<{
    id: number;
    condition: string;
    source: string;
    state: string;
    note: string | null;
    raisedByRole: string;
    raisedAt: string;
    releasedAt: string | null;
  }>;
  /** How many open safety incidents the booking has (a partner gets the count, not the rows). */
  incidents: number;
};

/* ---- Phase 10 §8 — execution steps (mirror of backend execution view, partner audience) ---- */
export type ExecutionStepAction = "START" | "COMPLETE" | "SKIP" | "FAIL" | "ESCALATE";
export type ExecutionStepState = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED_WITH_REASON" | "FAILED" | "ESCALATED";
/** What a step needs to be completed. Note the last value: it is not "BEFORE_AFTER". */
export type ExecutionStepEvidence = "NONE" | "NOTE" | "PHOTO" | "BEFORE_AFTER_PHOTOS";
export type ExecutionGate = {
  ok: boolean;
  blocking: Array<{ code: string; stepNumber: number; state: string; reason: "MANDATORY_STEP_INCOMPLETE" | "STEP_FAILED" | "STEP_ESCALATED" }>;
};
export type ExecutionStepView = {
  code: string;
  stepNumber: number;
  title: string;
  description: string | null;
  kind: string;
  mandatory: boolean;
  skippable: boolean;
  evidence: ExecutionStepEvidence | string;
  estimatedMinutes: number | null;
  ppe: string[];
  warnings: string[];
  materials: string[];
  equipment: string[];
  /** Codes of the steps that must be finished first. */
  dependsOn: string[];
  safetyRequirement: string | null;
  /** The stored state, or the computed READY / BLOCKED for a step not started yet. */
  state: ExecutionStepState | "READY" | "BLOCKED" | string;
  blockedBy: { reason: string; detail: string[] } | null;
  finishedAt: string | null;
  note: string | null;
  reason: string | null;
  /** Filled only for the partner, and only while the booking is IN_PROGRESS. */
  actions: Array<ExecutionStepAction | string>;
};
export type BookingExecutionView = {
  enforced: boolean;
  serviceVersion: number | null;
  steps: ExecutionStepView[];
  gate: ExecutionGate;
};
/**
 * `POST /api/bookings/:id/execution/:code/:action` body. COMPLETE needs: a `note` for a NOTE step;
 * `evidenceId` (a job-evidence row uploaded first with `uploadEvidence`) for a PHOTO step; for
 * BEFORE_AFTER_PHOTOS, evidence at ARRIVAL or START and at COMPLETION must exist on the booking.
 * SKIP / FAIL / ESCALATE need a `reason` of at least 3 characters. There is no photo field here.
 */
export type ExecutionStepActionBody = {
  /** Max 64 characters. */
  evidenceId?: string;
  /** Max 1000 characters. */
  note?: string;
  /** Max 500 characters. */
  reason?: string;
};
export type ExecutionStepActionResult = { code: string; state: ExecutionStepState; changed: boolean; gate: ExecutionGate };

/* ---- Phase 11 — partner capability self-service (mirror of backend provider-capability.service) ----
 * Rows are the database rows with camelCased keys plus the computed `validity` / `nearExpiry`;
 * timestamps arrive as ISO strings. The partner view never carries `verifiedBy`. */
export type CapabilityStatus = "DECLARED" | "VERIFIED" | "REJECTED" | "REVOKED";
export type CapabilityKind = "skills" | "certifications" | "equipment" | "insurance" | "languages";
export type SkillLevel = "BASIC" | "SKILLED" | "EXPERT";
export type LanguageProficiency = "BASIC" | "CONVERSATIONAL" | "FLUENT" | "NATIVE";
export type EquipmentOwnership = "OWNED" | "RENTED" | "EMPLOYER";
export type EquipmentOperational = "OPERATIONAL" | "OUT_OF_SERVICE";

export type SkillCatalogueEntry = { code: string; category: string; name: string; active: boolean; createdAt: string; updatedAt: string };

type CapabilityRowBase = { id: number; providerId: string; dataOrigin: string | null; createdAt: string; updatedAt: string };

export type ProviderSkillView = CapabilityRowBase & {
  skillCode: string;
  level: SkillLevel | null;
  status: CapabilityStatus;
  source: "SELF" | "ADMIN" | "DOCUMENT" | "IMPORT" | "LEGACY";
  sourceRef: string | null;
  verifiedAt: string | null;
  expiresAt: string | null;
  skillName: string;
  skillCategory: string;
  skillActive: boolean;
  validity: "VALID" | "UNVERIFIED" | "EXPIRED" | "REJECTED" | "REVOKED";
  nearExpiry: boolean;
};

export type ProviderCertificationView = CapabilityRowBase & {
  certificationType: string;
  issuer: string | null;
  referenceNumber: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  status: CapabilityStatus;
  verificationSource: string | null;
  documentId: string | null;
  proofRef: string | null;
  verifiedAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  validity: "VALID" | "EXPIRED" | "REVOKED" | "UNVERIFIED" | "REJECTED";
  nearExpiry: boolean;
};

export type ProviderEquipmentView = CapabilityRowBase & {
  equipmentType: string;
  ownership: EquipmentOwnership;
  operational: EquipmentOperational;
  status: CapabilityStatus;
  verifiedAt: string | null;
  inspectionDueAt: string | null;
  note: string | null;
  validity: "VALID" | "REVOKED" | "REJECTED" | "UNVERIFIED" | "OUT_OF_SERVICE" | "INSPECTION_OVERDUE";
  /** For equipment this flags the inspection due date, not an expiry. */
  nearExpiry: boolean;
};

export type ProviderInsuranceView = CapabilityRowBase & {
  insuranceType: string;
  insurer: string | null;
  policyReference: string | null;
  effectiveFrom: string | null;
  expiresAt: string;
  status: CapabilityStatus;
  documentId: string | null;
  proofRef: string | null;
  verifiedAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  validity: "VALID" | "EXPIRED" | "REVOKED" | "UNVERIFIED" | "NOT_YET_EFFECTIVE" | "REJECTED";
  nearExpiry: boolean;
};

/** Languages have no review lifecycle — no `status`; `source` says who recorded the row. */
export type ProviderLanguageView = CapabilityRowBase & {
  languageCode: string;
  proficiency: LanguageProficiency;
  source: "SELF" | "ADMIN";
  active: boolean;
  validity: "ACTIVE" | "INACTIVE";
};

export type PartnerCapabilityProfile = {
  providerId: string;
  dataOrigin: string | null;
  generatedAt: string;
  skills: ProviderSkillView[];
  certifications: ProviderCertificationView[];
  equipment: ProviderEquipmentView[];
  insurance: ProviderInsuranceView[];
  languages: ProviderLanguageView[];
  /** Service capabilities and business memberships — sent by the server, not shown by this app yet. */
  services: Array<Record<string, unknown>>;
  memberships: Array<Record<string, unknown>>;
  summary: { nearExpiry: number; expired: number; pendingReview: number };
  /** Active skills the partner can declare (empty when the catalogue could not be read). */
  skillCatalogue: SkillCatalogueEntry[];
  /**
   * The certification / equipment / insurance codes operational services require (sorted, possibly
   * empty). Absent on a backend that predates it.
   */
  requirementCatalogue?: { certifications: string[]; equipment: string[]; insurance: string[] };
};

/** POST bodies — fact fields only; status, verifier, source and origin are the server's. */
export type DeclareSkillBody = { skillCode: string; level?: SkillLevel | null };
export type DeclareCertificationBody = {
  certificationType: string;
  issuer?: string | null;
  referenceNumber?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  documentId?: string | null;
};
export type DeclareEquipmentBody = { equipmentType: string; ownership?: EquipmentOwnership | null; operational?: EquipmentOperational | null; note?: string | null };
export type DeclareInsuranceBody = {
  insuranceType: string;
  insurer?: string | null;
  policyReference?: string | null;
  effectiveFrom?: string | null;
  expiresAt: string;
  documentId?: string | null;
};
export type DeclareLanguageBody = { languageCode: string; proficiency?: LanguageProficiency | null };
/** PATCH /:kind/:rowId — certifications and insurance only; a key left out keeps its stored value. */
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
/**
 * The stored row as returned by a declare / edit: no computed `validity`, so the profile is re-read.
 * `verifiedBy` is never an identity — `null` (nobody verified it) or the constant "ADMIN".
 */
export type CapabilityWriteRow = { id: number; status?: CapabilityStatus; verifiedBy?: "ADMIN" | null } & Record<string, unknown>;

/* ---- Partner service skills (mirror of backend partner-service-skills.service ServiceSkillBoard) ---- */
export type ServiceSkillLane = "performing" | "pending" | "suspended" | "revoked" | "available";
/** One thing a service asks for that the professional does not currently meet. `code` is a matching rejection reason. */
export type ServiceReadinessGap = { code: string; detail: string; title?: string };
export type ServiceReadiness = { ready: boolean; missing: ServiceReadinessGap[] };
export type PartnerServiceSkillCard = {
  serviceId: string;
  name: string;
  slug: string;
  category: string;
  lane: ServiceSkillLane;
  capabilityId: number | null;
  source: string | null;
  requestedAt: string | null;
  requestNote: string | null;
  /** Only on `performing` cards; absent on other lanes and on a backend that predates it. */
  readiness?: ServiceReadiness;
};
export type PartnerServiceSkillBoard = {
  /** False while the capability tables are not deployed: requests cannot be made. */
  approvalWorkflow: boolean;
  performing: PartnerServiceSkillCard[];
  pending: PartnerServiceSkillCard[];
  suspended: PartnerServiceSkillCard[];
  revoked: PartnerServiceSkillCard[];
  available: PartnerServiceSkillCard[];
};

/* ---- Phase 10 §11 — a reported issue as the assigned partner sees it (backend partnerView) ---- */
export type PartnerCaseEvidence = {
  id: number;
  kind: string;
  jobEvidenceId: string | null;
  mediaUrl: string | null;
  note: string | null;
  /**
   * True when the customer's photo is stored privately and served by
   * GET /api/bookings/:id/cases/:caseId/evidence/:evidenceId/media (authenticated). Absent on a
   * backend that predates it.
   */
  hasStoredMedia?: boolean;
  createdAt: string;
};
export type PartnerCaseView = {
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
  /** Absent on a backend that predates case evidence in the partner view. */
  evidence?: PartnerCaseEvidence[];
};
