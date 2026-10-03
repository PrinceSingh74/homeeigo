"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Search, X } from "lucide-react";
import {
  CATEGORY_BY_ID,
  SUGGESTED_QUERIES,
  audienceSummary,
  categoryHref,
  priceText,
  searchCategories,
  searchServices,
  type Catalog,
} from "@/lib/catalog";
import { IconTile, focusRing } from "@/components/services-catalog/primitives";
import { cn } from "@/lib/utils";

type Option =
  | { kind: "category"; id: string; label: string; meta: string; href: string }
  | { kind: "service"; id: string; label: string; meta: string; href: string }
  | { kind: "query"; id: string; label: string };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Large catalogue search with live suggestions (ARIA 1.2 combobox).
 * Picking a suggestion opens that service/category; Enter on free text runs
 * an in-page search via `onSubmit`.
 */
export function ServiceSearch({
  catalog,
  value,
  onChange,
  onSubmit,
  size = "lg",
  placeholder = "Search for a service…",
}: {
  catalog: Catalog | null;
  value: string;
  onChange: (q: string) => void;
  onSubmit?: (q: string) => void;
  size?: "lg" | "md";
  placeholder?: string;
}) {
  const router = useRouter();
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const q = useDebounced(value, 120);

  const options = useMemo<Option[]>(() => {
    if (!catalog) return [];
    if (!q.trim()) {
      return SUGGESTED_QUERIES.map((s) => ({ kind: "query" as const, id: `q-${s}`, label: s }));
    }
    const cats = searchCategories(catalog, q)
      .slice(0, 2)
      .map((c) => ({
        kind: "category" as const,
        id: `c-${c.def.id}`,
        label: c.def.name,
        meta: `${c.services.length} services`,
        href: categoryHref(c.def.id),
      }));
    const svcs = searchServices(catalog, q)
      .slice(0, 6)
      .map(({ service: s }) => ({
        kind: "service" as const,
        id: `s-${s.slug}`,
        label: s.name,
        meta: [
          CATEGORY_BY_ID.get(s.category)!.shortName,
          s.category === "beauty" ? audienceSummary(s.audiences) : null,
          priceText(s).label,
        ]
          .filter(Boolean)
          .join(" · "),
        href: s.href,
      }));
    return [...svcs, ...cats];
  }, [catalog, q]);

  useEffect(() => setActive(-1), [q]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const choose = (opt: Option) => {
    setOpen(false);
    if (opt.kind === "query") {
      onChange(opt.label);
      onSubmit?.(opt.label);
      return;
    }
    router.push(opt.href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(-1, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = options[active];
      if (open && opt) choose(opt);
      else {
        setOpen(false);
        onSubmit?.(value);
      }
    } else if (e.key === "Escape") {
      if (open) setOpen(false);
      else if (value) onChange("");
    }
  };

  const expanded = open && options.length > 0;
  const noMatches = open && catalog && q.trim() && options.length === 0;

  return (
    <div ref={wrap} className="relative">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setOpen(false);
          onSubmit?.(value);
        }}
      >
        <label htmlFor={`${listId}-input`} className="sr-only">
          Search for a service
        </label>
        <div
          className={cn(
            "flex items-center gap-3 rounded-2xl border border-line bg-surface shadow-e3",
            "motion-safe:transition-[box-shadow,border-color] focus-within:border-emerald-400 focus-within:shadow-e4",
            size === "lg" ? "h-16 px-5 sm:h-[4.5rem] sm:px-6" : "h-12 px-4",
          )}
        >
          <Search className={cn("shrink-0 text-muted", size === "lg" ? "size-5 sm:size-6" : "size-5")} aria-hidden />
          <input
            ref={input}
            id={`${listId}-input`}
            type="search"
            role="combobox"
            autoComplete="off"
            enterKeyHint="search"
            aria-expanded={expanded}
            aria-controls={`${listId}-list`}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 && options[active] ? `${listId}-${options[active]!.id}` : undefined}
            value={value}
            placeholder={placeholder}
            onChange={(e) => {
              onChange(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className={cn(
              "min-w-0 flex-1 bg-transparent text-content outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden",
              size === "lg" ? "text-base sm:text-lg" : "text-base",
            )}
          />
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                onSubmit?.("");
                input.current?.focus();
              }}
              className={cn("grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-canvas hover:text-content", focusRing)}
              aria-label="Clear search"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </form>

      <div
        className={cn(
          "absolute inset-x-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-line bg-surface shadow-e5",
          !(expanded || noMatches) && "hidden",
        )}
      >
        {!q.trim() && expanded && (
          <p className="px-5 pt-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted">Try searching</p>
        )}
        <ul
          id={`${listId}-list`}
          role="listbox"
          aria-label="Search suggestions"
          className={cn("max-h-[min(60vh,420px)] overflow-y-auto p-2", !q.trim() && "flex flex-wrap gap-2 px-4 pb-4 pt-3")}
        >
          {options.map((opt, i) =>
            opt.kind === "query" ? (
              <li
                key={opt.id}
                id={`${listId}-${opt.id}`}
                role="option"
                aria-selected={i === active}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(opt)}
                className={cn(
                  "cursor-pointer rounded-full border border-line px-3.5 py-2 text-sm text-content hover:border-emerald-300",
                  i === active && "border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10",
                )}
              >
                {opt.label}
              </li>
            ) : (
              <li
                key={opt.id}
                id={`${listId}-${opt.id}`}
                role="option"
                aria-selected={i === active}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(opt)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5",
                  i === active ? "bg-emerald-50 dark:bg-emerald-500/10" : "hover:bg-canvas",
                )}
              >
                <OptionIcon catalog={catalog} opt={opt} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-content">{opt.label}</span>
                  <span className="block truncate text-xs text-muted">{opt.meta}</span>
                </span>
                <ArrowUpRight className="size-4 shrink-0 text-muted" aria-hidden />
              </li>
            ),
          )}
        </ul>
        {noMatches && (
          <p className="px-5 pb-5 text-sm text-muted" role="status">
            No matches for “{q.trim()}”. Try “cleaning”, “AC” or “haircut”.
          </p>
        )}
      </div>
    </div>
  );
}

function OptionIcon({ catalog, opt }: { catalog: Catalog | null; opt: Exclude<Option, { kind: "query" }> }) {
  if (opt.kind === "category") {
    const c = CATEGORY_BY_ID.get(opt.id.slice(2) as never);
    return c ? <IconTile icon={c.icon} tone={c.tone} className="size-10" /> : null;
  }
  const s = catalog?.bySlug.get(opt.id.slice(2));
  return s ? <IconTile icon={s.icon} tone={s.tone} className="size-10" /> : null;
}
