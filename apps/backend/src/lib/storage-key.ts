import crypto from "crypto";

/** Unguessable storage key with time-sortable prefix (UUIDv7-style). */
export function generateStorageKey(): string {
  const ts = Date.now().toString(16).padStart(12, "0");
  const rand = crypto.randomBytes(10).toString("hex");
  return `${ts}-${rand.slice(0, 4)}-${rand.slice(4, 8)}-${rand.slice(8, 12)}-${rand.slice(12, 22)}`;
}
