import { normalize } from "@/lib/catalog/adapter";
import type { Catalog, CategoryView, ServiceView } from "@/lib/catalog/types";

function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function scoreService(svc: ServiceView, q: string, tokens: string[]): number {
  const name = normalize(svc.name);
  const aliases = (svc.def.aliases ?? []).map(normalize);
  let score = 0;

  if (name === q) score = 100;
  else if (name.startsWith(q)) score = 85;
  else if (aliases.includes(q)) score = 78;
  else if (name.split(" ").some((w) => w.startsWith(q))) score = 72;
  else if (name.includes(q)) score = 65;
  else if (aliases.some((a) => a.startsWith(q))) score = 55;
  else if (q.length >= 3 && aliases.some((a) => a.includes(q))) score = 45;

  if (!score && tokens.length) {
    const words = svc.searchText.split(" ");
    const nameWords = name.split(" ");
    const hits = tokens.filter(
      (t) =>
        // Two-letter tokens ("ac") only match names/aliases, never incidental copy.
        (t.length === 2 && (nameWords.includes(t) || aliases.includes(t))) ||
        (t.length >= 3 && words.some((w) => w.startsWith(t))) ||
        // Light typo tolerance: "electrcian", "plumbr", "bathrom".
        (t.length >= 5 && words.some((w) => w.length >= 4 && withinOneEdit(t, w))),
    );
    if (hits.length === tokens.length) score = 30 + hits.filter((t) => name.includes(t)).length * 5;
  }

  if (!score) return 0;
  return score + (svc.status === "live" ? 6 : 0) + (svc.popular ? 3 : 0);
}

export type SearchResult = { service: ServiceView; score: number };

/**
 * Ranked catalogue search over name, aliases, category, audience and copy.
 * Canonical services only — cross-listings never duplicate a result.
 */
export function searchServices(catalog: Catalog, query: string): SearchResult[] {
  const q = normalize(query);
  if (!q) return [];
  const tokens = q.split(" ").filter((t) => t.length > 1 || q.length === 1);
  return catalog.services
    .map((service) => ({ service, score: scoreService(service, q, tokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.service.order - b.service.order);
}

export function searchCategories(catalog: Catalog, query: string): CategoryView[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  return catalog.categories.filter((c) => {
    const hay = normalize(`${c.def.name} ${c.def.shortName}`);
    return hay.split(" ").some((w) => w.startsWith(q)) || hay.includes(q);
  });
}

/** Curated suggestions for the empty search dropdown (not a popularity ranking). */
export const SUGGESTED_QUERIES = [
  "Bathroom",
  "Deep cleaning",
  "AC",
  "Electrician",
  "Hourly help",
  "Salon",
  "Pest control",
  "Laundry",
];
