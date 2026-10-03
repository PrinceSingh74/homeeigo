/**
 * Phase 2 — authoritative dispatch eligibility decision types.
 * Presence is an eligibility gate, not a ranking score or fifth FSM.
 */

export type DispatchEligibilityReason =
  | "NOT_FOUND"
  | "NOT_ACTIVE"
  | "NOT_AVAILABLE"
  | "STALE_PRESENCE"
  | "STALE_LOCATION"
  | "LOCATION_INVALID"
  | "NO_CAPACITY"
  | "SCHEDULE_BLOCKED"
  | "OUTSIDE_SERVICE_AREA"
  | "SKILL_MISMATCH"
  | "RISK_BLOCKED"
  | "PAYMENT_NOT_READY"
  | "CONFLICT"
  | "ACCOUNT_RESTRICTED"
  | "APPROVAL_PENDING";

export type DispatchEligibilityChecks = {
  lifecycle: boolean;
  availability: boolean;
  presence: boolean;
  location: boolean;
  capacity: boolean;
  schedule: boolean;
  geo: boolean;
  skill: boolean;
  risk: boolean;
  payment: boolean;
  conflict: boolean;
};

export type DispatchEligibilityResult = {
  eligible: boolean;
  reasons: DispatchEligibilityReason[];
  checks: DispatchEligibilityChecks;
};

export type DispatchEligibilitySnapshot = {
  providerId: string;
  lifecycleState: string;
  isActive: boolean;
  isApproved: boolean;
  isBanned: boolean;
  complianceRestricted: boolean;
  isOnline: boolean;
  pausedAt: Date | null;
  lastHeartbeatAt: Date | null;
  lastLocationAt: Date | null;
  lastLocationLat: number | null;
  lastLocationLng: number | null;
  /** Pre-evaluated gates — omit to skip optional checks. */
  capacityOk?: boolean;
  scheduleOk?: boolean;
  geoOk?: boolean;
  skillMatch?: boolean;
  riskBlocked?: boolean;
  paymentReady?: boolean;
  hasConflict?: boolean;
};

export type AdminAssignmentOverride = {
  adminId: string;
  reason: string;
  overrideType: "EMERGENCY_DISPATCH" | "OPERATIONS_RECOVERY";
  overrideAuditId?: string;
};

export type AssignmentJobContext = {
  latitude: number;
  longitude: number;
  scheduledDate: Date;
};

export type ZoneSupplyLevel = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export type ZoneSupplySnapshot = {
  activePartners: number;
  availablePartners: number;
  livePartners: number;
  freshLocationPartners: number;
  busyPartners: number;
  capacityRemaining: number;
  nextAvailableAt: string | null;
  confidence: ZoneSupplyLevel;
  /** Customer-safe label — no internal reason codes. */
  customerLabel: "Available now" | "Limited availability" | "Confirming professional" | "Unavailable";
};
