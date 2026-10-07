import { quantityBounds } from "@/lib/catalog/pricing";
import type { PublicCatalogConfig, QuantityRule } from "@/types/backend";

/**
 * The booking page's selection: ids and counts only. The server prices every one of them
 * (POST /api/bookings/price-quote) and refuses what it cannot sell; nothing here decides a price,
 * a bound or a policy the catalogue did not configure.
 */
export type BookSelection = {
  variantId?: string;
  quantity?: number;
  audience?: string;
  professionalPreference?: string;
};

export type BookVariant = NonNullable<PublicCatalogConfig["variants"]>[number];

type Config = Pick<PublicCatalogConfig, "variants" | "quantity"> | null | undefined;

/** The options the server offers for this service, in its order. Inactive ones are not offered. */
export function bookVariants(cfg: Config): BookVariant[] {
  return (cfg?.variants ?? []).filter((v) => v.active);
}

/** The quantity rule the server prices by; a NONE rule is no rule (same reading as the resolver). */
export function bookQuantityRule(cfg: Config): QuantityRule | null {
  const rule = cfg?.quantity;
  return rule && rule.type !== "NONE" ? rule : null;
}

/**
 * What is sent to the server when the page has (or has not) a carried selection.
 *
 * A carried selection is sent exactly as it came, including a quantity outside the rule's range:
 * the server answers with its own sentence and the page shows it, rather than quietly booking a
 * different quantity. Without one, a quantity-priced service starts at the rule's default (else its
 * minimum), and a service with options starts empty — the server then prices the base price, or
 * says an option must be chosen. A service with neither has no selection: a price tier applies.
 */
export function effectiveBookSelection(carried: BookSelection | null, cfg: Config): BookSelection | null {
  if (carried) return carried;
  const rule = bookQuantityRule(cfg);
  if (rule) return { quantity: rule.default ?? rule.min };
  if (bookVariants(cfg).length > 0) return {};
  return null;
}

/**
 * Where the service named in `/book?service=…` stands. The page books that service or says it
 * cannot: it never substitutes another one. "loading" covers both the lookup in flight and the
 * moment before it starts — nothing is assumed until the server has answered.
 */
export type UrlServiceState = "none" | "listed" | "loading" | "fetched" | "missing";

export function urlServiceState(input: {
  urlId: string | null | undefined;
  listed: readonly { id: string; slug?: string | null }[];
  lookup: "idle" | "loading" | "found" | "failed";
}): UrlServiceState {
  if (!input.urlId) return "none";
  if (input.listed.some((s) => s.id === input.urlId || s.slug === input.urlId)) return "listed";
  if (input.lookup === "found") return "fetched";
  if (input.lookup === "failed") return "missing";
  return "loading";
}

export type QuantityBounds = { min: number; max: number; step: number };

/** The bounds the stepper moves within: the option's own, where it has them, else the rule's. */
export function bookQuantityBounds(rule: QuantityRule, variant: BookVariant | null | undefined): QuantityBounds {
  return quantityBounds(rule, variant ?? null);
}

/**
 * The stepper's next value: on the rule's grid and inside its bounds. A value that arrived out of
 * range (a hand-edited URL) comes back to the nearest bound on the first press.
 */
export function clampQuantity(value: number, bounds: QuantityBounds): number {
  const { min, max } = bounds;
  const step = bounds.step > 0 ? bounds.step : 1;
  if (!Number.isFinite(value)) return min;
  const snapped = min + Math.round((value - min) / step) * step;
  return Math.min(Math.max(snapped, min), max);
}

/** Most units of an add-on one booking may take, as the server's catalogue states it (unset = one). */
export function addonQuantityCap(addon: { maxQuantity?: number | null; quantityAllowed?: boolean | null }): number {
  if (addon.quantityAllowed === false) return 1;
  return Math.max(1, addon.maxQuantity ?? 1);
}

/**
 * The `addonQuantities` the quote and the booking carry: only units above one, only for selected
 * add-ons, never above the cap. The server treats an omitted id as one unit and refuses a quantity
 * for an add-on that is not selected, so neither is sent.
 */
export function addonQuantitiesPayload(
  selected: Iterable<string>,
  quantities: Record<string, number>,
  capFor: (id: string) => number,
): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const id of selected) {
    const raw = quantities[id];
    if (raw == null || !Number.isFinite(raw)) continue;
    const q = Math.min(Math.max(Math.round(raw), 1), capFor(id));
    if (q > 1) out[id] = q;
  }
  return Object.keys(out).length ? out : undefined;
}
