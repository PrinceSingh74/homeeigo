/**
 * The jobs list: its filters, how pages are joined, and what a card says. Pure (type imports only).
 *
 * `GET /api/providers/me/bookings` takes ONE `status` value per request (a comma-separated list
 * makes the server answer 500), so "Closed" — cancelled, expired, customer not available, missed
 * visit — is four separate lists, chosen with a second row of chips, never one merged query.
 */
import type { PartnerBooking, PartnerSafeAddress } from "@/types/partner";

export type JobFilterId = "pending" | "active" | "completed" | "closed";

export type JobFilter = {
  id: JobFilterId;
  /** The short word on the control. */
  label: string;
  /** What a screen reader (and the device test scripts) call it. */
  accessibilityLabel: string;
};

export const JOB_FILTERS: readonly JobFilter[] = [
  { id: "pending", label: "New", accessibilityLabel: "New requests" },
  { id: "active", label: "Active", accessibilityLabel: "Active jobs" },
  { id: "completed", label: "Completed", accessibilityLabel: "Completed jobs" },
  { id: "closed", label: "Closed", accessibilityLabel: "Closed jobs" },
];

export type JobListSource = {
  /** Cache key segment: `["partner", "bookings", key]`. The first three are shared with the job screen. */
  key: string;
  /** The server's `status` query value. */
  status: string;
  sortBy: "recent" | "upcoming";
};

export const JOB_SOURCES: Record<Exclude<JobFilterId, "closed">, JobListSource> = {
  pending: { key: "pending", status: "pending", sortBy: "recent" },
  // "active" = ACCEPTED | ASSIGNED | EN_ROUTE | IN_PROGRESS. "accepted" would drop started jobs.
  active: { key: "active", status: "active", sortBy: "upcoming" },
  completed: { key: "completed", status: "completed", sortBy: "recent" },
};

export type ClosedKind = "cancelled" | "expired" | "customer_no_show" | "provider_no_show";

/** Labels are the ones `bookingStatusLabel` uses for the same statuses. */
export const CLOSED_SOURCES: ReadonlyArray<JobListSource & { id: ClosedKind; label: string; empty: string }> = [
  { id: "cancelled", key: "cancelled", status: "cancelled", sortBy: "recent", label: "Cancelled", empty: "Jobs that were cancelled or that you declined appear here." },
  { id: "expired", key: "expired", status: "expired", sortBy: "recent", label: "Expired", empty: "Bookings that were never paid for in time appear here." },
  { id: "customer_no_show", key: "customer_no_show", status: "customer_no_show", sortBy: "recent", label: "Customer not available", empty: "Visits where the customer was not available appear here." },
  { id: "provider_no_show", key: "provider_no_show", status: "provider_no_show", sortBy: "recent", label: "Missed visit", empty: "Visits recorded as missed appear here." },
];

export const JOBS_PAGE_SIZE = 20;

/** Pages in order, each id once (a job that moved between pages while loading is kept where it first appeared). */
export function mergePages<T extends { id: string }>(pages: ReadonlyArray<ReadonlyArray<T> | null | undefined>): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const page of pages) {
    for (const row of page ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
  }
  return out;
}

/**
 * Is there another page to ask for? `total` is the server's count for the filter. A last page that
 * came back short (or empty) ends the list even if `total` says otherwise — the list changed.
 */
export function hasMorePages(input: { total: number | null | undefined; pagesLoaded: number; pageSize: number; lastPageLength: number | null }): boolean {
  const { total, pagesLoaded, pageSize, lastPageLength } = input;
  if (typeof total !== "number" || !Number.isFinite(total) || pagesLoaded < 1) return false;
  if (lastPageLength != null && lastPageLength < pageSize) return false;
  return pagesLoaded * pageSize < total;
}

/**
 * The address line of a card: exactly what the server sent. Before acceptance (and after the job)
 * that is the area only — "city, state, zip" — and it is labelled as an area, not as an address.
 */
export function addressLine(address: PartnerSafeAddress | null | undefined): { label: "Address" | "Area"; value: string } | null {
  if (!address) return null;
  const full = address.fullAddress?.trim();
  const hasDoor = Boolean(address.addressLine1?.trim());
  if (full) return { label: hasDoor ? "Address" : "Area", value: full };
  const area = [address.city, address.state, address.zipCode].map((p) => p?.trim()).filter(Boolean).join(", ");
  return area ? { label: "Area", value: area } : null;
}

/** The selection rows a card has room for: everything except the service name (the card's title) and the slot (its own line). */
export function compactSelection(rows: ReadonlyArray<{ key: string; label: string; value: string }>): string | null {
  const parts = rows.filter((r) => r.key !== "service" && r.key !== "slot").map((r) => (r.key === "option" ? r.value : `${r.label}: ${r.value}`));
  return parts.length ? parts.join(" · ") : null;
}

export function slotLine(rows: ReadonlyArray<{ key: string; value: string }>): string | null {
  return rows.find((r) => r.key === "slot")?.value ?? null;
}

export type CardTone = "neutral" | "leaf" | "success" | "warning" | "danger" | "info";

/** The colour of a status pill. Status in the wire (lowercase) or enum form. */
export function statusTone(status: string | null | undefined, arrivedAt?: string | null): CardTone {
  const s = (status ?? "").toLowerCase();
  if (s === "pending") return "warning";
  if (s === "completed") return "success";
  if (s === "in_progress") return "leaf";
  if (s === "accepted" || s === "assigned" || s === "en_route") return arrivedAt ? "leaf" : "info";
  if (s === "cancelled_by_user" || s === "cancelled_by_provider" || s === "rejected" || s === "provider_no_show") return "danger";
  return "neutral";
}

/** The active job to put first: furthest along, then earliest booked. Null when there is none. */
export function pickActiveJob<T extends Pick<PartnerBooking, "id" | "status" | "scheduledDate" | "arrivedAt">>(rows: ReadonlyArray<T> | null | undefined): T | null {
  const rank = (b: T) => {
    const s = (b.status ?? "").toLowerCase();
    if (s === "in_progress") return 4;
    if (s === "en_route") return b.arrivedAt ? 3 : 2;
    if (s === "accepted" || s === "assigned") return b.arrivedAt ? 3 : 1;
    return 0;
  };
  const live = (rows ?? []).filter((b) => rank(b) > 0);
  if (!live.length) return null;
  return [...live].sort((a, b) => rank(b) - rank(a) || Date.parse(a.scheduledDate) - Date.parse(b.scheduledDate))[0] ?? null;
}

/** Jobs booked for the device's calendar day of `nowMs`, earliest first. */
export function jobsToday<T extends Pick<PartnerBooking, "scheduledDate">>(rows: ReadonlyArray<T> | null | undefined, nowMs: number): T[] {
  const now = new Date(nowMs);
  const sameDay = (iso: string) => {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  };
  return (rows ?? []).filter((b) => sameDay(b.scheduledDate)).sort((a, b) => Date.parse(a.scheduledDate) - Date.parse(b.scheduledDate));
}

/**
 * The next step of an active job, from the server's `/actions` answer when it has arrived
 * (`primaryAction` + its `disabledReasons` sentence). The words are the job screen's button names.
 * Null when the server names no primary action — nothing is guessed from the status.
 */
export function nextStep(actions: { primaryAction: string | null; disabledReasons?: Partial<Record<string, string>> } | null | undefined): { label: string; blockedBy: string | null } | null {
  const primary = actions?.primaryAction ?? null;
  const label =
    primary === "ACCEPT"
      ? "Accept"
      : primary === "START_NAVIGATION"
        ? "On my way"
        : primary === "MARK_ARRIVED"
          ? "I've arrived"
          : primary === "START_SERVICE"
            ? "Start job"
            : primary === "COMPLETE_SERVICE"
              ? "Complete job"
              : null;
  if (!primary || !label) return null;
  const reason = actions?.disabledReasons?.[primary] ?? null;
  // The start PIN is entered on the job screen: it is a step there, not a reason the job is stuck.
  return { label, blockedBy: primary === "START_SERVICE" && reason === "Customer OTP required" ? null : reason };
}
