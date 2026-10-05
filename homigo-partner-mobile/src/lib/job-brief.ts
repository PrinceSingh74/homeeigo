/**
 * The job screen as one execution brief — the pure helpers behind its Materials / Equipment cards and
 * its durations. No react-native imports: this file runs under `node --test`.
 *
 * Materials and equipment reach the partner from three server sources, none of which is invented or
 * merged into another's wording here:
 *  - `booking.requirements.bringMaterials` / `bringEquipment` — the preparation lines frozen at booking;
 *  - `booking.execution.materials` / `equipment` — the service's free-text note;
 *  - `GET /api/bookings/:id/execution` → each step's `materials` / `equipment`.
 */

export function formatMinutes(n: number): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

type StepItems = { materials?: readonly string[] | null; equipment?: readonly string[] | null };

/**
 * Every distinct material (or equipment) named by any work step, in step order. Duplicates fold on
 * trimmed, case-insensitive text; the first spelling the server sent is the one shown. A step from an
 * older server build carries neither list — absent means none.
 */
export function uniqueStepItems(steps: readonly StepItems[] | null | undefined, key: "materials" | "equipment"): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const step of steps ?? []) {
    for (const raw of step[key] ?? []) {
      const item = typeof raw === "string" ? raw.trim() : "";
      const folded = item.toLowerCase();
      if (!item || seen.has(folded)) continue;
      seen.add(folded);
      out.push(item);
    }
  }
  return out;
}

/** Step items the preparation lines do not already name — so the card never lists one thing twice. */
export function stepItemsNotListed(stepItems: readonly string[], listedLabels: readonly string[]): string[] {
  const listed = new Set(listedLabels.map((l) => l.trim().toLowerCase()));
  return stepItems.filter((item) => !listed.has(item.trim().toLowerCase()));
}
