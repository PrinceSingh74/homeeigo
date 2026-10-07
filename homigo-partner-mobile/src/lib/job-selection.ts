import type { PartnerJobBrief } from "@/types/partner";

/**
 * The job brief's selection summary: service, option, quantity, who it is for, add-ons, slot — from
 * the partner projection of `GET /api/bookings/:id` (`job` = backend partnerJobBrief, `service`,
 * `scheduledDate`). Ported from apps/partner-web/src/lib/job-selection.ts. Pure: no React Native import.
 *
 * Only what the payload carries becomes a row; nothing is invented for a missing field. The
 * customer's choice is named with the one word the customer app and the server's own sentences use.
 */
export const SELECTION_WORD = "Option";

export type JobSelectionRow = { key: "service" | "option" | "quantity" | "audience" | "addons" | "slot"; label: string; value: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number) => String(n).padStart(2, "0");

function minutes(n: number): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/** The booked start in the device's time zone: "09 Oct 2026 · 10:00 AM". Null when it is not a date. */
function slotStart(iso: string): string | null {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const h = d.getHours();
  const time = `${h % 12 === 0 ? 12 : h % 12}:${two(d.getMinutes())} ${h < 12 ? "AM" : "PM"}`;
  return `${two(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${time}`;
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
  const when = booking.scheduledDate ? slotStart(booking.scheduledDate) : null;
  if (when) rows.push({ key: "slot", label: "Slot", value: job?.durationMinutes ? `${when} · ${minutes(job.durationMinutes)}` : when });
  return rows;
}
