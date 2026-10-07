/**
 * What a customer may read back about their own booking's selection: the option, the quantity and
 * its unit, who it is for, the add-on units and the appointment minutes — from the booking's frozen
 * `service_selection` and `addons` columns, never from the service's current catalogue.
 *
 * The partner's job brief already reads exactly these columns and nothing partner-private, so the
 * customer summary is the same projection under its own name: one reader of the frozen selection,
 * not a second implementation.
 */
import { partnerJobBrief, type PartnerJobBrief } from "./service-domain";

export type CustomerSelectionSummary = PartnerJobBrief;

export function customerSelectionSummary(
  serviceSelection: unknown,
  addons: unknown,
  estimatedDuration: number | null | undefined,
): CustomerSelectionSummary {
  return partnerJobBrief(serviceSelection, addons, estimatedDuration);
}
