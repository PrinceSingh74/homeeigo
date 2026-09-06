"use client";

import { useEffect, useState } from "react";

/**
 * Instant nav highlight: set on internal link click, cleared when the router
 * commits the new pathname. Not a fake transition — it mirrors the real click.
 */
let pendingHref: string | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function markPendingHref(href: string | null): void {
  if (pendingHref === href) return;
  pendingHref = href;
  notify();
}

export function getPendingHref(): string | null {
  return pendingHref;
}

export function usePendingHref(): string | null {
  const [href, setHref] = useState<string | null>(pendingHref);

  useEffect(() => {
    const onChange = () => setHref(pendingHref);
    listeners.add(onChange);
    onChange();
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  return href;
}
