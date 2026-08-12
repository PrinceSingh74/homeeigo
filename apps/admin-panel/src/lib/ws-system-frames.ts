/** WebSocket control frames — must not trigger React updates or query invalidation. */
const SYSTEM_TYPES = new Set(["SUBSCRIBE", "UNSUBSCRIBE", "PONG", "PING"]);

export function isSystemWsPayload(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as { type?: string; message?: string };
    const t = String(parsed.type ?? "").toUpperCase();
    if (SYSTEM_TYPES.has(t)) return true;
    if (
      parsed.message === "Connected to notifications" &&
      !("id" in parsed) &&
      !("notificationType" in parsed)
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
