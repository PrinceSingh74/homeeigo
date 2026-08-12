export type JourneyStage =
  | "SEARCHING"
  | "ASSIGNED"
  | "EN_ROUTE"
  | "ARRIVED"
  | "STARTED"
  | "COMPLETED";

export const STAGE_ORDER: JourneyStage[] = [
  "SEARCHING",
  "ASSIGNED",
  "EN_ROUTE",
  "ARRIVED",
  "STARTED",
  "COMPLETED",
];

/**
 * Normalise ANY backend booking/tracking status to a journey stage — identical
 * mapping to the website (components/tracking/BookingJourney.toJourneyStage) so
 * web + app show the exact same live journey for a shared-backend booking.
 */
export function toJourneyStage(status: string | null | undefined): JourneyStage {
  const s = (status ?? "").toUpperCase();
  if (["COMPLETED", "DONE"].includes(s)) return "COMPLETED";
  if (["IN_PROGRESS", "STARTED", "SERVICE_STARTED"].includes(s)) return "STARTED";
  if (["ARRIVED", "REACHED"].includes(s)) return "ARRIVED";
  if (["EN_ROUTE", "ON_THE_WAY", "ONTHEWAY"].includes(s)) return "EN_ROUTE";
  if (["ASSIGNED", "ACCEPTED", "CONFIRMED", "NOT_STARTED"].includes(s)) return "ASSIGNED";
  return "SEARCHING";
}

/** The 5 rail steps shown on the home card (SEARCHING is implied by the header). */
export const RAIL_STEPS: { label: string; stage: JourneyStage }[] = [
  { label: "Confirmed", stage: "ASSIGNED" },
  { label: "En route", stage: "EN_ROUTE" },
  { label: "Arrived", stage: "ARRIVED" },
  { label: "Started", stage: "STARTED" },
  { label: "Done", stage: "COMPLETED" },
];
