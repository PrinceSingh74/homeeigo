import type { PendingRegistration } from "@/types/auth";

const STORAGE_KEY = "homigo_pending_registration";

export function savePendingRegistration(data: PendingRegistration): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function loadPendingRegistration(): PendingRegistration | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingRegistration;
  } catch {
    return null;
  }
}

export function clearPendingRegistration(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
}
