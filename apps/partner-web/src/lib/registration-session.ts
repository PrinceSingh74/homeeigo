const STORAGE_KEY = "homigo_partner_registration_token";

export function setRegistrationToken(token: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, token);
}

export function getRegistrationToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(STORAGE_KEY);
}

export function clearRegistrationToken(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
}
