/** Shallow fingerprint for skipping no-op query cache updates. */
export function fingerprintJson(value: unknown): string {
  return JSON.stringify(value);
}

/** Poll only when tab visible; callers supply interval ms when active. */
export function visiblePollInterval(ms: number): number | false {
  if (typeof document !== "undefined" && document.hidden) return false;
  return ms;
}
