import { formatTime } from "@/lib/format";
import type { PartnerJobBrief } from "@/types/partner";

/**
 * The job brief's selection summary: service, option, quantity, who it is for, add-ons, slot — from
 * the partner projection of `GET /api/bookings/:id` (`job` = backend partnerJobBrief, `service`,
 * `scheduledDate`). Only what the payload carries becomes a row; nothing is invented for a missing
 * field. The customer's choice is named with the one word the customer web and the server's own
 * sentences use.
 */
export const SELECTION_WORD = "Option";

export type JobSelectionRow = { key: "service" | "option" | "quantity" | "audience" | "addons" | "slot"; label: string; value: string };

function minutes(n: number): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/** The booked day, written out ("09 Oct 2026") so it reads the same on every device. */
function slotDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function jobSelectionRows(booking: {
  service?: { name?: string | null } | null;
  scheduledDate?: string | null;
  job?: PartnerJobBrief | null;
}): JobSelectionRow[] {
  const rows: JobSelectionRow[] = [];
  const serviceName = booking.service?.name?.trim();
  if (serviceName) rows.push({ key: "service", label: "Service", value: serviceName });
  const job = booking.job;
  if (job) {
    if (job.variant) rows.push({ key: "option", label: SELECTION_WORD, value: job.variant });
    if (job.unit) rows.push({ key: "quantity", label: "Quantity", value: `${job.quantity} ${job.unit}` });
    else if (job.quantity > 1) rows.push({ key: "quantity", label: "Quantity", value: `× ${job.quantity}` });
    if (job.audience) rows.push({ key: "audience", label: "For", value: job.audience });
    if (job.addons.length) {
      rows.push({ key: "addons", label: "Add-ons", value: job.addons.map((a) => (a.quantity > 1 ? `${a.name} × ${a.quantity}` : a.name)).join(" · ") });
    }
  }
  if (booking.scheduledDate) {
    const when = `${slotDate(booking.scheduledDate)} · ${formatTime(booking.scheduledDate)}`;
    rows.push({ key: "slot", label: "Slot", value: job?.durationMinutes ? `${when} · ${minutes(job.durationMinutes)}` : when });
  }
  return rows;
}
