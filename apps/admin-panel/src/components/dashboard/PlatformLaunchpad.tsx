"use client";

import { memo, useMemo } from "react";
import { Globe } from "lucide-react";
import { Icon3D } from "@/components/hq/Icon3D";

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
    <section className="biz-glass-panel p-6">
      <div className="exec-section-head">
        <div className="exec-section-head__title">
          <Icon3D icon={Globe} tone="cyan" size="md" />
          <h2 className="text-sm font-semibold leading-none tracking-tight">Platform launchpad</h2>
        </div>
        <span className="exec-section-head__meta">demo: Homigo@123</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {links.map((l) => (
          <a
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] px-3 py-2.5 text-center text-[11px] font-medium text-[var(--color-biz-muted)] transition hover:border-[var(--color-biz-accent)] hover:text-[var(--color-biz-text)]"
          >
            {l.label}
          </a>
        ))}
      </div>
    </section>
  );
});
