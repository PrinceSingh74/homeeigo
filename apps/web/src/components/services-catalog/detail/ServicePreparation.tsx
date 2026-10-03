"use client";

import { AlertTriangle, Check, Home, Package, Users } from "lucide-react";
import type { CustomerRequirement, CustomerRequirementsView } from "@/types/backend";
import { cardSurface } from "@/components/services-catalog/primitives";
import { cn } from "@/lib/utils";

/**
 * "What you need before we arrive" — Phase 06. Every line is a sentence the SERVER phrased from the
 * service's configured requirements; this component only groups and lays them out. Empty groups are
 * not rendered, and a service with nothing configured renders nothing at all: no generic claims.
 */
type Group = { key: keyof Omit<CustomerRequirementsView, "empty">; title: string; icon: typeof Package; hint?: string };
const GROUPS: Group[] = [
  { key: "beforeBooking", title: "Please confirm before booking", icon: Check, hint: "You'll confirm these on the booking page." },
  { key: "beforeArrival", title: "Have this ready at your home", icon: Home },
  { key: "youProvide", title: "You'll provide", icon: Users },
  { key: "shared", title: "Shared between you and your professional", icon: Users },
  { key: "weBring", title: "We'll bring", icon: Package },
  { key: "optional", title: "Optional", icon: Package, hint: "Not needed for the service to go ahead." },
];

export function hasPreparation(view: CustomerRequirementsView | null | undefined): view is CustomerRequirementsView {
  return !!view && !view.empty;
}

function Requirement({ item, optional }: { item: CustomerRequirement; optional?: boolean }) {
  const meta = [item.quantity, item.chargeText, item.timingText].filter(Boolean).join(" · ");
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span className={cn("mt-2 size-1.5 shrink-0 rounded-full", optional ? "bg-muted" : "bg-brand")} aria-hidden />
      <div className="min-w-0 flex-1 text-sm leading-relaxed">
        <p className={cn("text-content", !optional && "font-medium")}>{item.label}</p>
        {meta && <p className="text-muted">{meta}</p>}
        {item.note && <p className="mt-1 text-muted">{item.note}</p>}
        {item.procurementText && <p className="mt-1 text-muted">{item.procurementText}</p>}
        {item.warning && (
          <p className="mt-1 flex gap-2 text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{item.warning}</span>
          </p>
        )}
      </div>
    </li>
  );
}

export function ServicePreparation({ view }: { view: CustomerRequirementsView }) {
  const groups = GROUPS.filter((g) => view[g.key].length > 0);
  if (!groups.length) return null;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {groups.map((g) => {
        const Icon = g.icon;
        return (
          <section key={g.key} className={cn("p-5", cardSurface)} aria-labelledby={`prep-${g.key}`}>
            <h3 id={`prep-${g.key}`} className="flex items-center gap-2 text-sm font-semibold text-content">
              <Icon className="size-4 text-brand" aria-hidden />
              {g.title}
            </h3>
            {g.hint && <p className="mt-1 text-xs text-muted">{g.hint}</p>}
            <ul className="mt-3 divide-y divide-line">
              {view[g.key].map((item) => (
                <Requirement key={item.code} item={item} optional={g.key === "optional"} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
