import type { Tone } from "@/theme/tokens";

/**
 * How the money and performance screens word what the server sent. Pure: no React Native import.
 *
 * Nothing here computes a figure. A value the server did not send is "—"; a status the app does not
 * know is shown in the server's own word, never mapped to the nearest familiar one.
 */

export const DASH = "—";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * Rupees exactly as sent: Indian grouping, paise kept (up to two decimals), a real minus sign for a
 * negative amount, and "—" for a value that was not sent. Written out rather than
 * `toLocaleString("en-IN")` so every device shows the same text.
 */
export function rupees(amount: number | null | undefined): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return DASH;
  const fixed = (Math.round(Math.abs(amount) * 100) / 100).toFixed(2);
  const [whole = "0", fraction = ""] = fixed.split(".");
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  const paise = fraction.replace(/0+$/, "");
  const text = `₹${grouped}${paise ? `.${paise}` : ""}`;
  return amount < 0 && Number(fixed) !== 0 ? `− ${text}` : text;
}

/** A count or a plain number as sent; "—" when it was not sent. */
export function count(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : DASH;
}

/** A percentage the server computed (0–100), shown to at most one decimal; "—" when not sent. */
export function percent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return DASH;
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

/** The server's 0–1 confidence as a percentage; null when it sent none. */
export function confidencePercent(confidence: number | null | undefined): string | null {
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  return `${Math.round(confidence * 100)}%`;
}

/** `SOME_ENUM_VALUE` → "Some enum value". An empty or missing code is "—". */
export function humanise(code: string | null | undefined): string {
  const words = (code ?? "").trim().replace(/[_-]+/g, " ").toLowerCase();
  if (!words) return DASH;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function parseInstant(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** "7 Oct 2026" in the phone's own time zone; "—" for a missing or unreadable instant. */
export function formatDay(iso: string | null | undefined): string {
  const d = parseInstant(iso);
  if (!d) return DASH;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "7 Oct 2026, 2:05 pm" in the phone's own time zone. */
export function formatDayTime(iso: string | null | undefined): string {
  const d = parseInstant(iso);
  if (!d) return DASH;
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${formatDay(iso)}, ${h12}:${minutes} ${h24 < 12 ? "am" : "pm"}`;
}

/**
 * A calendar day the server sent as `YYYY-MM-DD` (the earnings series: UTC days). Read as written —
 * never passed through a time zone, which would move it to the day before on some phones.
 */
export function formatCalendarDay(day: string, withYear = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return day;
  return `${Number(m[3])} ${month}${withYear ? ` ${m[1]}` : ""}`;
}

/**
 * "Updated 12 min ago" from the instant the server stamped on a reading. `nowMs` is the app's
 * estimate of server time. Null when the server sent no readable instant — then nothing is claimed.
 */
export function updatedAgo(iso: string | null | undefined, nowMs: number): string | null {
  const d = parseInstant(iso);
  if (!d) return null;
  const minutes = Math.floor((nowMs - d.getTime()) / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `Updated ${days} ${days === 1 ? "day" : "days"} ago`;
}

/** Hours the server measured, e.g. "1.5 h"; "—" when not sent. */
export function hoursText(hours: number | null | undefined): string {
  if (typeof hours !== "number" || !Number.isFinite(hours)) return DASH;
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded} h`;
}

/** "09:00" (24 h, as the server stores an hour of the day) → "9 am". Anything else is returned unchanged. */
export function hourOfDay(hour: number): string {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return String(hour);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? "am" : "pm"}`;
}

/* ------------------------------------------------------------ withdrawals */

const WITHDRAWAL_STATUS: Record<string, { label: string; tone: Tone }> = {
  REQUESTED: { label: "Requested", tone: "warning" },
  APPROVED: { label: "Approved", tone: "info" },
  PROCESSING: { label: "Processing", tone: "info" },
  COMPLETED: { label: "Completed", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  REVERSED: { label: "Reversed", tone: "danger" },
};

/**
 * The withdrawal's own status (`GET /providers/me/withdrawals` sends the raw enum; the withdraw
 * answer sends it lowercase). One word per server state — REQUESTED and APPROVED are not merged —
 * and an unknown state is shown in the server's word.
 */
export function withdrawalStatus(status: string | null | undefined): { label: string; tone: Tone } {
  const known = WITHDRAWAL_STATUS[(status ?? "").trim().toUpperCase()];
  return known ?? { label: humanise(status), tone: "neutral" };
}

/** True while the money is still on its way: the states the server counts as pending. */
export function withdrawalInProgress(status: string | null | undefined): boolean {
  const s = (status ?? "").trim().toUpperCase();
  return s === "REQUESTED" || s === "APPROVED" || s === "PROCESSING";
}

/* ----------------------------------------------------------------- stars */

/** "4 out of 5 stars" for a screen reader; the stars themselves are drawn. */
export function starsLabel(stars: number): string {
  return `${stars} out of 5 ${stars === 1 ? "star" : "stars"}`;
}
