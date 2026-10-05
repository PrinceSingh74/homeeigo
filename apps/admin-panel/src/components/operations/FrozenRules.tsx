import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/**
 * "Rules frozen with this booking": a collapsed-by-default block listing the rules a booking was
 * made under (its own snapshot — a later catalogue edit never changes them). Shared by the Safety
 * and Quality cards of the booking page so both read the same way.
 *
 * A rule with nothing in it is not rendered at all: an older booking simply shows fewer lines.
 */

export type FrozenRule = {
  label: string;
  /** Who sees or uses the rule, e.g. "Professional", "Customer". */
  audience?: string;
  /** A list rule (one bullet each) or a single statement. Empty / null / blank = omitted. */
  value: string[] | string | null | undefined;
};

const present = (r: FrozenRule) => (Array.isArray(r.value) ? r.value.some((x) => x && x.trim()) : Boolean(r.value && r.value.trim()));

/** The rules that actually have content — callers use the count to decide what to say when there are none. */
export const presentRules = (rules: FrozenRule[]) => rules.filter(present);

export function FrozenRules({ title = "Rules frozen with this booking", rules, footnote, testId }: { title?: string; rules: FrozenRule[]; footnote?: ReactNode; testId?: string }) {
  const shown = presentRules(rules);
  if (shown.length === 0) return null;
  return (
    <details className="group rounded-xl border border-[var(--color-biz-line)] text-sm" data-testid={testId}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
        {title}
        <span className="text-xs font-normal text-[var(--color-biz-muted)]">({shown.length})</span>
      </summary>
      <dl className="space-y-2.5 border-t border-[var(--color-biz-line)] px-3 py-3">
        {shown.map((r) => (
          <div key={r.label}>
            <dt className="text-xs font-semibold">
              {r.label}
              {r.audience ? <span className="ml-2 text-[10px] font-normal uppercase tracking-wide text-[var(--color-biz-muted)]">{r.audience}</span> : null}
            </dt>
            <dd className="mt-0.5 text-xs text-[var(--color-biz-muted)]">
              {Array.isArray(r.value) ? (
                <ul className="list-disc space-y-0.5 pl-5">
                  {r.value.filter((x) => x && x.trim()).map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              ) : (
                <span className="whitespace-pre-line">{r.value}</span>
              )}
            </dd>
          </div>
        ))}
        {footnote ? <p className="text-[11px] text-[var(--color-biz-faint)]">{footnote}</p> : null}
      </dl>
    </details>
  );
}
