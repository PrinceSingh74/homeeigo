const KEY = "homigo_pending_referral";

export function savePendingReferralCode(code: string): void {
  const normalized = code.trim().toUpperCase();
  if (!normalized || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(KEY, normalized);
  } catch {
    /* ignore */
  }
}

export function readPendingReferralCode(): string | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  try {
    const v = sessionStorage.getItem(KEY);
    return v?.trim() ? v.toUpperCase() : undefined;
  } catch {
    return undefined;
  }
}

export function consumePendingReferralCode(): string | undefined {
  const code = readPendingReferralCode();
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
  return code;
}
