import type { PartnerRequirementLine, PartnerRequirementsBrief } from "@/types/partner";

/**
 * What the partner needs to reach the door, beyond the street address: the customer's note and the
 * address's access fields. Ported from apps/partner-web/src/lib/job-access.ts. Pure.
 *
 * The server sends them non-null only while the job is ACCEPTED / ASSIGNED / EN_ROUTE / IN_PROGRESS
 * (and the note only to the partner who holds it) — see `PartnerSafeAddress` in types/partner.ts.
 * This only relays what arrived: a missing field produces no row.
 */
export type JobAccessSource = {
  description?: string | null;
  address?: {
    flatNumber?: string | null;
    buildingName?: string | null;
    landmark?: string | null;
    specialInstructions?: string | null;
  } | null;
};

export type JobAccessDetail = { key: "note" | "flat" | "building" | "landmark" | "instructions"; label: string; value: string };

export function jobAccessDetails(booking: JobAccessSource): JobAccessDetail[] {
  const a = booking.address;
  const rows: Array<[JobAccessDetail["key"], string, string | null | undefined]> = [
    ["note", "Customer's note", booking.description],
    ["flat", "Flat / unit", a?.flatNumber],
    ["building", "Building", a?.buildingName],
    ["landmark", "Landmark", a?.landmark],
    ["instructions", "Access instructions", a?.specialInstructions],
  ];
  return rows.flatMap(([key, label, raw]) => {
    const value = typeof raw === "string" ? raw.trim() : "";
    return value ? [{ key, label, value }] : [];
  });
}

function bringLine(r: PartnerRequirementLine): string {
  const notes = [r.quantity, r.optional ? "optional" : null].filter(Boolean);
  return notes.length ? `${r.label} (${notes.join(", ")})` : r.label;
}

/**
 * What the partner must bring, as short lines for the offer card — from the booking's requirements
 * snapshot, so the partner knows the materials and tools before accepting. `null` when the snapshot
 * lists nothing to bring.
 */
export function offerBringList(requirements: PartnerRequirementsBrief | null | undefined): { materials: string[]; equipment: string[] } | null {
  if (!requirements || requirements.empty) return null;
  const materials = requirements.bringMaterials.map(bringLine);
  const equipment = requirements.bringEquipment.map(bringLine);
  return materials.length || equipment.length ? { materials, equipment } : null;
}
