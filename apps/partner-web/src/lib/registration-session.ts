const STORAGE_KEY = "homigo_partner_registration_token";
const INVITE_KEY = "homigo_partner_application_invite";
const REF_KEY = "homigo_partner_referral_code";

export function setRegistrationToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, token);
  sessionStorage.setItem(STORAGE_KEY, token);
}

export function getRegistrationToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
}

export function clearRegistrationToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
}

export function setApplicationInvite(token: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(INVITE_KEY, token);
}

export function getApplicationInvite(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(INVITE_KEY);
}

export function clearApplicationInvite(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(INVITE_KEY);
}

export function setPendingReferralCode(code: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(REF_KEY, code.trim().toUpperCase());
}

export function getPendingReferralCode(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(REF_KEY);
}

export function clearPendingReferralCode(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(REF_KEY);
}
