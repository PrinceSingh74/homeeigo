"use client";

import { useState } from "react";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import {
  SORT_OPTIONS,
  activeFilterCount,
  EMPTY_FILTERS,
  type FilterFacets,
  type FilterState,
  type Option,
  type SortKey,
} from "@/lib/catalog";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/buttons/Button";
import { focusRing, pillActive, pillBase, pillIdle } from "@/components/services-catalog/primitives";
import { cn } from "@/lib/utils";

type Props = {
  facets: FilterFacets;
  value: FilterState;
  onChange: (next: FilterState) => void;
  resultCount: number;
};

function ChipGroup<T extends string>({
  legend,
  options,
  selected,
  onToggle,
}: {
  legend: string;
  options: Option<T>[];
  selected: (id: T) => boolean;
  onToggle: (id: T) => void;
}) {
  if (!options.length) return null;
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-content">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = selected(o.id);
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(o.id)}
              className={cn(pillBase, "min-h-10", on ? pillActive : pillIdle)}
            >
              {o.label}
              <span className={cn("text-xs tabular-nums", on ? "opacity-80" : "text-muted")}>{o.count}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Single-select toggle: picking the active value clears it. */
const toggle = <T,>(cur: T | undefined, id: T) => (cur === id ? undefined : id);

export function FilterPanel({ facets, value, onChange }: Omit<Props, "resultCount">) {
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-7">
      <ChipGroup
        legend="Who is it for"
        options={facets.audiences}
        selected={(id) => value.audience === id}
        onToggle={(id) => set({ audience: toggle(value.audience, id) })}
      />
      <ChipGroup
        legend="Service type"
        options={facets.beautyTypes}
        selected={(id) => value.beautyType === id}
        onToggle={(id) => set({ beautyType: toggle(value.beautyType, id) })}
      />
      <ChipGroup
        legend="Subcategory"
        options={facets.subgroups}
        selected={(id) => value.subgroup === id}
        onToggle={(id) => set({ subgroup: toggle(value.subgroup, id) })}
      />
      <ChipGroup
        legend="Availability"
        options={facets.status}
        selected={(id) => value.status === id}
        onToggle={(id) => set({ status: toggle(value.status, id) })}
      />
      <ChipGroup
        legend="Pricing model"
        options={facets.models}
        selected={(id) => value.models.includes(id)}
        onToggle={(id) =>
          set({ models: value.models.includes(id) ? value.models.filter((m) => m !== id) : [...value.models, id] })
        }
      />
      <ChipGroup
        legend="Price"
        options={facets.price}
        selected={(id) => value.price === id}
        onToggle={(id) => set({ price: toggle(value.price, id) })}
      />
      <ChipGroup
        legend="Duration"
        options={facets.duration}
        selected={(id) => value.duration === id}
        onToggle={(id) => set({ duration: toggle(value.duration, id) })}
      />
      {facets.popular > 0 && (
        <ChipGroup
          legend="Highlights"
          options={[{ id: "popular", label: "Popular", count: facets.popular }]}
          selected={() => value.popular}
          onToggle={() => set({ popular: !value.popular })}
        />
      )}
    </div>
  );
}

export function SortSelect({ value, onChange }: { value: SortKey; onChange: (s: SortKey) => void }) {
  return (
    <label className="relative inline-flex items-center gap-2 text-sm text-muted">
      <span className="hidden sm:inline">Sort</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortKey)}
        className={cn(
          "h-11 cursor-pointer appearance-none rounded-full border border-line bg-surface pl-4 pr-9 text-sm font-medium text-content",
          focusRing,
        )}
        aria-label="Sort services"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 size-4 text-muted" aria-hidden />
    </label>
  );
}

/**
 * Toolbar: result count, a few one-tap filters, "Filters" sheet with every
 * relevant group, sort, and removable active-filter chips.
 */
export function ServiceFilters({ facets, value, onChange, resultCount }: Props) {
  const [open, setOpen] = useState(false);
  const count = activeFilterCount(value);
  const hasPanel =
    facets.audiences.length +
      facets.beautyTypes.length +
      facets.subgroups.length +
      facets.status.length +
      facets.models.length +
      facets.price.length +
      facets.duration.length +
      facets.popular >
    0;

  const quick: { key: string; label: string; on: boolean; flip: () => void }[] = [];
  if (facets.status.some((s) => s.id === "live"))
    quick.push({
      key: "live",
      label: "Bookable now",
      on: value.status === "live",
      flip: () => onChange({ ...value, status: value.status === "live" ? undefined : "live" }),
    });
  if (facets.models.some((m) => m.id === "hourly"))
    quick.push({
      key: "hourly",
      label: "Hourly",
      on: value.models.includes("hourly"),
      flip: () =>
        onChange({
          ...value,
          models: value.models.includes("hourly")
            ? value.models.filter((m) => m !== "hourly")
            : [...value.models, "hourly"],
        }),
    });
  if (facets.models.some((m) => m.id === "inspection"))
    quick.push({
      key: "inspection",
      label: "Inspection required",
      on: value.models.includes("inspection"),
      flip: () =>
        onChange({
          ...value,
          models: value.models.includes("inspection")
            ? value.models.filter((m) => m !== "inspection")
            : [...value.models, "inspection"],
        }),
    });
  if (facets.popular > 0)
    quick.push({
      key: "popular",
      label: "Popular",
      on: value.popular,
      flip: () => onChange({ ...value, popular: !value.popular }),
    });

  return (
    <div className="mb-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted" role="status" aria-live="polite">
          <span className="font-semibold text-content tabular-nums">{resultCount}</span>{" "}
          {resultCount === 1 ? "service" : "services"}
        </p>
        <div className="flex items-center gap-2">
          {hasPanel && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className={cn(pillBase, count ? pillActive : pillIdle)}
              aria-haspopup="dialog"
            >
              <SlidersHorizontal className="size-4" aria-hidden />
              Filters
              {count > 0 && <span className="tabular-nums">({count})</span>}
            </button>
          )}
          <SortSelect value={value.sort} onChange={(sort) => onChange({ ...value, sort })} />
        </div>
      </div>

      {(quick.length > 0 || count > 0) && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0">
          {quick.map((q) => (
            <button
              key={q.key}
              type="button"
              aria-pressed={q.on}
              onClick={q.flip}
              className={cn(pillBase, "min-h-10", q.on ? pillActive : pillIdle)}
            >
              {q.label}
            </button>
          ))}
          {count > 0 && (
            <button
              type="button"
              onClick={() => onChange({ ...EMPTY_FILTERS, sort: value.sort })}
              className={cn(pillBase, "min-h-10 border-transparent text-brand hover:underline")}
            >
              <X className="size-4" aria-hidden />
              Clear all
            </button>
          )}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Filters" size="md">
        <FilterPanel facets={facets} value={value} onChange={onChange} />
        <div className="sticky bottom-0 -mx-6 -mb-5 mt-8 flex items-center gap-3 border-t border-line bg-surface/95 px-6 py-4 backdrop-blur">
          <Button
            variant="ghost"
            onClick={() => onChange({ ...EMPTY_FILTERS, sort: value.sort })}
            disabled={count === 0}
          >
            Reset
          </Button>
          <Button variant="primary" fullWidth onClick={() => setOpen(false)}>
            Show {resultCount} {resultCount === 1 ? "service" : "services"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
