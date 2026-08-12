"use client";

import { memo, useMemo } from "react";
import { Globe } from "lucide-react";

type Link = { label: string; href: string };

function buildLinks(): Link[] {
  const base =
    typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.hostname}`
      : "http://localhost";
  return [
    { label: "Customer", href: `${base}:3001/` },
    { label: "Partner", href: `${base}:3002/` },
    { label: "API", href: `${base}:3000/health` },
    { label: "Grafana", href: `${base}:3004` },
    { label: "Swagger", href: `${base}:3000/swagger` },
    { label: "Customer login", href: `${base}:3001/login` },
    { label: "Partner login", href: `${base}:3002/login` },
    { label: "Bookings", href: `${base}:3001/bookings` },
    { label: "Partner map", href: `${base}:3002/map` },
    { label: "Admin HQ", href: `${base}:3003/` },
  ];
}

export const PlatformLaunchpad = memo(function PlatformLaunchpad() {
  const links = useMemo(() => buildLinks(), []);

  return (
    <section className="biz-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <Globe className="h-4 w-4 text-[var(--color-biz-accent)]" />
        <h2 className="text-sm font-semibold">Platform launchpad</h2>
        <span className="text-[10px] text-[var(--color-biz-muted)]">demo: Homigo@123</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {links.map((l) => (
          <a
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-[var(--color-biz-line)] px-2 py-1 text-[11px] text-[var(--color-biz-muted)] transition hover:border-[var(--color-biz-accent)] hover:text-[var(--color-biz-text)]"
          >
            {l.label}
          </a>
        ))}
      </div>
    </section>
  );
});
