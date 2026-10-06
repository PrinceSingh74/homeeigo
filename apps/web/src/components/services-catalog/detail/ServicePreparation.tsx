"use client";

import { AlertTriangle } from "lucide-react";
import type { CustomerRequirement, CustomerRequirementsView } from "@/types/backend";
import { ColumnTitle } from "@/components/services-catalog/detail/sections";
import { cn } from "@/lib/utils";

/**
 * "What you need before we arrive" — Phase 06. Every line is a sentence the SERVER phrased from the
 * service's configured requirements; this component only groups and lays them out. Empty groups are
 * not rendered, and a service with nothing configured renders nothing at all: no generic claims.
 */
type Group = { key: keyof Omit<CustomerRequirementsView, "empty">; title: string; hint?: string };
const GROUPS: Group[] = [
  { key: "beforeBooking", title: "Please confirm before booking", hint: "You'll confirm these on the booking page." },
  { key: "beforeArrival", title: "Have this ready at your home" },
  { key: "youProvide", title: "You'll provide" },
  { key: "shared", title: "Shared between you and your professional" },
  { key: "weBring", title: "We'll bring" },
  { key: "optional", title: "Optional", hint: "Not needed for the service to go ahead." },
];

export function hasPreparation(view: CustomerRequirementsView | null | undefined): view is CustomerRequirementsView {
  return !!view && !view.empty;
}

function Requirement({ item, optional }: { item: CustomerRequirement; optional?: boolean }) {
  const meta = [item.quantity, item.chargeText, item.timingText].filter(Boolean);
  return (
    <li className="py-3.5 leading-relaxed">
      <p className={cn("text-base text-content", !optional && "font-semibold")}>{item.label}</p>
      {meta.length > 0 && <p className="text-sm text-muted">{meta.join(", ")}</p>}
      {item.note && <p className="mt-1 text-sm text-muted">{item.note}</p>}
      {item.procurementText && <p className="mt-1 text-sm text-muted">{item.procurementText}</p>}
      {item.warning && (
        <p className="mt-1.5 flex gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{item.warning}</span>
        </p>
      )}
    </li>
  );
}

export function ServicePreparation({ view }: { view: CustomerRequirementsView }) {
  const groups = GROUPS.filter((g) => view[g.key].length > 0);
  if (!groups.length) return null;
  return (
    <div className="grid gap-x-12 gap-y-10 md:grid-cols-2">
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`prep-${g.key}`}>
          <ColumnTitle id={`prep-${g.key}`} hint={g.hint}>
            {g.title}
          </ColumnTitle>
          <ul className="mt-1 divide-y divide-line">
            {view[g.key].map((item) => (
              <Requirement key={item.code} item={item} optional={g.key === "optional"} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
