import type { ConsentPolicyType } from "@prisma/client";

/** Bump when legal copy changes — consent records store this version. */
export const CURRENT_POLICY_VERSIONS: Record<ConsentPolicyType, string> = {
  TERMS: "2026-06-08",
  PRIVACY: "2026-06-08",
  COOKIES: "2026-06-08",
  REFUND: "2026-06-08",
};

export const POLICY_TITLES: Record<ConsentPolicyType, string> = {
  TERMS: "Terms of Service",
  PRIVACY: "Privacy Policy",
  COOKIES: "Cookie Policy",
  REFUND: "Refund & Cancellation Policy",
};

export const ACCOUNT_DELETION_RESTORE_DAYS = 30;
