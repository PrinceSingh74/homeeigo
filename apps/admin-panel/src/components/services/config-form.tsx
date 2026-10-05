import type { ReactNode } from "react";

/**
 * Shared pieces of the service configuration editor: the string ⇄ config converters every section
 * uses, and the three layout primitives (Section, Field, Toggle) so each section file reads the same.
 *
 * The backend schema is `.strict()` and every text field is `min(1)`: a blank string or an empty
 * list is never a valid value. Every converter here therefore returns `undefined` for "nothing",
 * and `clean` removes the key.
 */

export const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
export const str = (n?: number | null) => (n == null ? "" : String(n));
export const lines = (xs?: string[] | null) => (xs ?? []).join("\n");
export const list = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
/** One item per line → list, or undefined when there is nothing to save. */
export const listOrUndefined = (s: string) => (list(s).length ? list(s) : undefined);
export const textOrUndefined = (s: string) => s.trim() || undefined;
export const csv = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

/** Drop undefined keys; an object left with no keys becomes undefined (so the key is removed). */
export function clean<T extends Record<string, unknown>>(o: T): T | undefined {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  return Object.keys(out).length ? out : undefined;
}

/**
 * A backend default is written only if it was stored explicitly or the admin chose another value —
 * otherwise an untouched save would rewrite the JSON (same meaning) and bump the service version.
 */
export const unlessDefault = <T,>(prev: object | undefined, key: string, value: T, dflt: T): T | undefined =>
  value === dflt && !(prev && key in prev) ? undefined : value;

/** Codes the backend accepts for steps and typed capabilities: lowercase words joined by single hyphens. */
export const CODE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A problem that must be fixed before the configuration can be saved (the backend would refuse it). */
export type ConfigIssue = { tab: string; section: string; message: string };

/** Count / length limits of a one-per-line list, mirrored from the backend schema. */
export function listIssue(value: string, maxItems: number, maxLen: number): string | undefined {
  const items = list(value);
  if (items.length > maxItems) return `At most ${maxItems} lines (${items.length} entered).`;
  const long = items.findIndex((x) => x.length > maxLen);
  return long >= 0 ? `Line ${long + 1} is longer than ${maxLen} characters.` : undefined;
}

export const wholeNumberIssue = (value: string, min: number, max: number): string | undefined => {
  const n = num(value);
  if (n === undefined) return undefined;
  return Number.isInteger(n) && n >= min && n <= max ? undefined : `Enter a whole number from ${min} to ${max}.`;
};

/* ------------------------------------------------------------------ */

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode; open?: boolean }) {
  return (
    <section className="sv-config-section">
      <header className="sv-config-section__head">
        <h3>{title}</h3>
        {hint ? <p>{hint}</p> : null}
      </header>
      <div className="sv-config-section__body">{children}</div>
    </section>
  );
}

/** `consumer` names who reads the value (customer, professional, an engine). `error` renders next to the field. */
export function Field({ label, children, consumer, error, help }: { label: string; children: ReactNode; consumer?: string; error?: string; help?: string }) {
  return (
    <label className="sv-field">
      <span>
        {label}
        {consumer ? (
          <span className="ml-2 text-[10px] font-normal uppercase tracking-wide text-[var(--color-biz-muted)]">
            {consumer}
          </span>
        ) : null}
      </span>
      {children}
      {help ? <small className="text-xs text-[var(--color-biz-muted)]">{help}</small> : null}
      {error ? (
        <small className="text-xs font-medium text-[var(--color-biz-danger)]" role="alert">
          {error}
        </small>
      ) : null}
    </label>
  );
}

export function Toggle({ label, checked, onChange, consumer, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; consumer?: string; disabled?: boolean }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(x) => onChange(x.target.checked)} />
      {label}
      {consumer ? <span className="text-[10px] uppercase text-[var(--color-biz-muted)]">{consumer}</span> : null}
    </label>
  );
}

/** One item per line, with the backend's count and length limits checked as the admin types. */
export function LinesField({
  label,
  consumer,
  value,
  onChange,
  maxItems,
  maxLen,
  rows = 3,
  placeholder,
}: {
  label: string;
  consumer?: string;
  value: string;
  onChange: (v: string) => void;
  maxItems: number;
  maxLen: number;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <Field label={`${label} (one per line)`} consumer={consumer} error={listIssue(value, maxItems, maxLen)}>
      <textarea className="sv-input sv-textarea" rows={rows} value={value} placeholder={placeholder} onChange={(x) => onChange(x.target.value)} />
    </Field>
  );
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-[var(--color-biz-line)] px-4 py-5 text-center text-sm text-[var(--color-biz-muted)]">{children}</p>;
}
