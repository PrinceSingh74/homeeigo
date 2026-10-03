/**
 * Resolving the service a caller asked the book screen for ("Book again", a provider page, an AI
 * suggestion, a category tile, a deep link).
 *
 * The book screen used to look the request up in the catalogue page it had loaded — the first 20
 * services of /api/services — and fall back to the FIRST service when it was not there. With 33
 * live services, 13 of them opened the screen on a different service without a word (coding-phase
 * certification 2026-09-28, reproduced on an emulator through `homigo://book?service=<id>`).
 */

/** Index of the requested service — exact id first, then id or name fragment — or -1. */
export function findServiceIndex(services: readonly { id: string; name: string }[], idOrSlug: string): number {
  const needle = idOrSlug.trim();
  if (!needle) return -1;
  const exact = services.findIndex((s) => s.id === needle);
  if (exact >= 0) return exact;
  const lower = needle.toLowerCase();
  return services.findIndex((s) => s.id.includes(needle) || s.name.toLowerCase().includes(lower));
}

/** Catalogue ids are cuids; only an id can be fetched on its own from /api/services/:id. */
export function isServiceId(value: string): boolean {
  return /^c[a-z0-9]{20,}$/.test(value.trim());
}

/** The loaded catalogue with the separately fetched requested service in front, never twice. */
export function withRequestedService<T extends { id: string }>(catalog: T[], requested: T | null | undefined): T[] {
  if (!requested || catalog.some((s) => s.id === requested.id)) return catalog;
  return [requested, ...catalog];
}
