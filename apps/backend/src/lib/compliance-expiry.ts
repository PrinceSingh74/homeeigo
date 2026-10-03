/**
 * Canonical document expiry states. Backend is authoritative — UI must not
 * hardcode 30/7 day windows.
 */
export const COMPLIANCE_REMINDER_DAYS = 30;
export const COMPLIANCE_URGENT_DAYS = 7;

export const COMPLIANCE_EXPIRY_STATES = ["VALID", "EXPIRING_SOON", "EXPIRING_URGENT", "EXPIRED", "NONE"] as const;
export type ComplianceExpiryState = (typeof COMPLIANCE_EXPIRY_STATES)[number];

export const PARTNER_COMPLIANCE_STATUSES = ["VERIFIED", "EXPIRING", "ACTION_REQUIRED", "RESTRICTED"] as const;
export type PartnerComplianceStatus = (typeof PARTNER_COMPLIANCE_STATUSES)[number];

export type ExpiryEvaluation = {
  state: ComplianceExpiryState;
  daysToExpiry: number | null;
  reminderWindow: "D30" | "D7" | "EXPIRED" | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysToExpiry(expiryDate: Date, now = new Date()): number {
  const a = Date.UTC(expiryDate.getUTCFullYear(), expiryDate.getUTCMonth(), expiryDate.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((a - b) / DAY_MS);
}

export function evaluateExpiry(expiryDate: Date | null | undefined, now = new Date()): ExpiryEvaluation {
  if (!expiryDate) {
    return { state: "NONE", daysToExpiry: null, reminderWindow: null };
  }
  const days = daysToExpiry(expiryDate, now);
  if (days < 0) return { state: "EXPIRED", daysToExpiry: days, reminderWindow: "EXPIRED" };
  if (days <= COMPLIANCE_URGENT_DAYS) {
    return { state: "EXPIRING_URGENT", daysToExpiry: days, reminderWindow: "D7" };
  }
  if (days <= COMPLIANCE_REMINDER_DAYS) {
    return { state: "EXPIRING_SOON", daysToExpiry: days, reminderWindow: "D30" };
  }
  return { state: "VALID", daysToExpiry: days, reminderWindow: null };
}

export function partnerFacingStatus(input: {
  restricted: boolean;
  hasExpired: boolean;
  hasExpiring: boolean;
  hasUnverified: boolean;
  kycOk: boolean;
}): { status: PartnerComplianceStatus; explanation: string } {
  if (input.restricted) {
    return {
      status: "RESTRICTED",
      explanation: "A required document has expired. Update it to go online and receive new jobs.",
    };
  }
  if (input.hasExpired || !input.kycOk || input.hasUnverified) {
    return {
      status: "ACTION_REQUIRED",
      explanation: "Complete verification or replace expired documents to stay fully active.",
    };
  }
  if (input.hasExpiring) {
    return {
      status: "EXPIRING",
      explanation: "One or more documents expire soon. Update them before they lapse.",
    };
  }
  return {
    status: "VERIFIED",
    explanation: "Your compliance documents are current.",
  };
}

export function documentCta(state: ComplianceExpiryState, isVerified: boolean): string {
  if (state === "EXPIRED") return "Re-upload";
  if (!isVerified) return "Verify";
  if (state === "EXPIRING_URGENT" || state === "EXPIRING_SOON") return "Update";
  return "View";
}
