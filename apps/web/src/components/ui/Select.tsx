"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { m as motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronDown, Check, X, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { dropdownVariants } from "@/lib/animations";
import { FormLabel, FormMessage, useFieldIds } from "@/components/ui/form-field";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
}

export type SelectVariant = "default" | "error" | "success" | "disabled";
export type SelectSize = "sm" | "md";

export interface SelectProps {
  label?: string;
  helperText?: string;
  errorMessage?: string;
  options: SelectOption[];
  placeholder?: string;
  value?: string | string[];
  defaultValue?: string | string[];
  isMulti?: boolean;
  isClearable?: boolean;
  isSearchable?: boolean;
  variant?: SelectVariant;
  disabled?: boolean;
  iconLeft?: ReactNode;
  id?: string;
  className?: string;
  triggerClassName?: string;
  size?: SelectSize;
  ariaLabel?: string;
  name?: string;
  onChange?: (value: string | string[]) => void;
}

const triggerSizeClasses: Record<SelectSize, string> = {
  sm: "min-h-8 h-8 gap-1.5 rounded-lg px-2.5 text-xs sm:text-xs",
  md: "min-h-[44px] gap-2 rounded-lg px-3.5 text-base sm:text-[15px]",
};

function normalizeValue(
  v: string | string[] | undefined,
  isMulti: boolean,
): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  return isMulti ? [v] : [v];
}

export function Select({
  label,
  helperText,
  errorMessage,
  options,
  placeholder = "Select…",
  value,
  defaultValue,
  isMulti = false,
  isClearable = false,
  isSearchable = false,
  variant: variantProp,
  disabled,
  iconLeft,
  id: idProp,
  className,
  triggerClassName,
  size = "md",
  ariaLabel,
  name,
  onChange,
}: SelectProps) {
  const reduced = useReducedMotion();
  const ids = useFieldIds(idProp);
  const listboxId = `${ids.id}-listbox`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [internal, setInternal] = useState<string[]>(() =>
    normalizeValue(defaultValue, isMulti),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const isControlled = value !== undefined;
  const selected = isControlled ? normalizeValue(value, isMulti) : internal;

  const resolved =
    disabled || variantProp === "disabled"
      ? "disabled"
      : errorMessage || variantProp === "error"
        ? "error"
        : variantProp === "success"
          ? "success"
          : "default";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const groupedSections = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, SelectOption[]>();
    for (const opt of filtered) {
      const key = opt.group ?? "";
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(opt);
    }
    return order.map((key) => ({
      label: key || null,
      options: map.get(key)!,
    }));
  }, [filtered]);

  const selectedLabels = options
    .filter((o) => selected.includes(o.value))
    .map((o) => o.label);

  const display =
    selectedLabels.length === 0
      ? placeholder
      : isMulti
        ? selectedLabels.join(", ")
        : selectedLabels[0];

  const commit = useCallback(
    (next: string[]) => {
      if (!isControlled) setInternal(next);
      onChange?.(isMulti ? next : (next[0] ?? ""));
    },
    [isControlled, isMulti, onChange],
  );

  const toggleOption = (opt: SelectOption) => {
    if (opt.disabled) return;
    if (isMulti) {
      const has = selected.includes(opt.value);
      const next = has
        ? selected.filter((v) => v !== opt.value)
        : [...selected, opt.value];
      commit(next);
    } else {
      commit([opt.value]);
      setOpen(false);
      setQuery("");
    }
  };

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) setHighlight(0);
  }, [open, filtered.length]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (resolved === "disabled") return;
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "Enter" && open && filtered[highlight]) {
      e.preventDefault();
      toggleOption(filtered[highlight]);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setHighlight((i) => Math.min(i + 1, filtered.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
    }
  };

  const hiddenId = useId();

  return (
    <div ref={rootRef} className={cn("relative w-full", className)}>
      {name ? (
        <select
          name={name}
          multiple={isMulti}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          value={isMulti ? selected : selected[0] ?? ""}
          onChange={() => {}}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : null}

      {label ? (
        <FormLabel id={ids.id}>{label}</FormLabel>
      ) : null}

      <button
        type="button"
        id={ids.id}
        disabled={resolved === "disabled"}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-invalid={resolved === "error" || undefined}
        aria-describedby={
          [helperText && ids.helperId, errorMessage && ids.errorId]
            .filter(Boolean)
            .join(" ") || undefined
        }
        onKeyDown={onKeyDown}
        onClick={() => resolved !== "disabled" && setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center border bg-surface text-left transition duration-200",
          triggerSizeClasses[size],
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          resolved === "error"
            ? "border-error"
            : resolved === "success"
              ? "border-success"
              : open
                ? "border-primary shadow-[0_0_8px_rgb(37_99_235/0.3)]"
                : "border-line",
          resolved === "disabled" && "cursor-not-allowed opacity-50",
          triggerClassName,
        )}
      >
        {iconLeft ? (
          <span className="shrink-0 text-muted">{iconLeft}</span>
        ) : null}
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            selectedLabels.length === 0 && "text-muted",
          )}
        >
          {display}
        </span>
        {isClearable && selected.length > 0 && resolved !== "disabled" ? (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear selection"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-primary/10"
            onClick={(e) => {
              e.stopPropagation();
              commit([]);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                commit([]);
              }
            }}
          >
            <X className="size-4" />
          </span>
        ) : null}
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      <AnimatePresence>
        {open && resolved !== "disabled" ? (
          <motion.div
            id={listboxId}
            role="listbox"
            aria-multiselectable={isMulti || undefined}
            variants={dropdownVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
              "absolute z-50 mt-1 max-h-[min(16rem,50vh)] w-full overflow-hidden rounded-lg border border-line bg-surface shadow-e4",
            )}
            style={{ transformOrigin: "top", ...(reduced ? { transition: "none" } : {}) }}
          >
            {isSearchable ? (
              <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                <Search className="size-4 shrink-0 text-muted" />
                <input
                  id={hiddenId}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Type to filter…"
                  className="min-w-0 flex-1 bg-transparent text-sm text-content outline-none placeholder:text-muted"
                  onKeyDown={(e) => e.stopPropagation()}
                  autoFocus
                />
              </div>
            ) : null}
            <ul className="max-h-56 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <li className="px-3 py-2 text-sm text-muted">No options</li>
              ) : (
                (() => {
                  let flatIndex = 0;
                  return groupedSections.map((section) => (
                    <li key={section.label ?? "__ungrouped"} role="presentation">
                      {section.label ? (
                        <div
                          className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted"
                          role="presentation"
                        >
                          {section.label}
                        </div>
                      ) : null}
                      <ul role="group" aria-label={section.label ?? undefined}>
                        {section.options.map((opt) => {
                          const i = flatIndex++;
                          const isSelected = selected.includes(opt.value);
                          return (
                            <li key={opt.value} role="presentation">
                              <button
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                disabled={opt.disabled}
                                onMouseEnter={() => setHighlight(i)}
                                onClick={() => toggleOption(opt)}
                                className={cn(
                                  "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition",
                                  i === highlight && "bg-primary/10",
                                  isSelected && "font-medium text-primary",
                                  opt.disabled && "cursor-not-allowed opacity-40",
                                )}
                              >
                                <span className="min-w-0 flex-1 truncate">
                                  {opt.label}
                                </span>
                                {isSelected ? (
                                  <Check className="size-4 shrink-0 text-primary" />
                                ) : null}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ));
                })()
              )}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {errorMessage ? (
        <FormMessage id={ids.errorId} tone="error">
          {errorMessage}
        </FormMessage>
      ) : helperText ? (
        <FormMessage id={ids.helperId} tone="helper">
          {helperText}
        </FormMessage>
      ) : null}
    </div>
  );
}
