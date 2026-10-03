"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { adminApi } from "@/services/admin-api";

export default function EventExplorerPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "automation", "overview"],
    queryFn: () => adminApi.automation.overview(),
  });

  const events = data?.canonicalEvents ?? [];
  const triggers = data?.triggeredEventTypes ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Event Explorer</h1>
          <p className="text-sm text-[var(--color-biz-muted)]">
            Canonical partner event catalog and automation trigger coverage
          </p>
        </div>
        <Link
          href="/automation"
          className="rounded-lg border border-[var(--color-biz-line)] px-4 py-2 text-sm font-semibold"
        >
          Automation Center
        </Link>
      </div>

      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Could not load event catalog.
        </div>
      )}

      <section className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] p-5">
        <h2 className="mb-4 text-lg font-semibold">Canonical partner events</h2>
        {isLoading ? (
          <p className="text-sm text-[var(--color-biz-muted)]">Loading catalog…</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-[var(--color-biz-muted)]">No events in catalog.</p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Canonical partner events table">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--color-biz-line)] text-[var(--color-biz-muted)]">
                  <th className="pb-2 pr-4 font-medium">Canonical</th>
                  <th className="pb-2 pr-4 font-medium">Runtime type</th>
                  <th className="pb-2 pr-4 font-medium">Domain</th>
                  <th className="pb-2 pr-4 font-medium">Producer</th>
                  <th className="pb-2 font-medium">Automated</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const automated = triggers.includes(e.runtimeType);
                  const pending = e.producerStatus === "POLICY_PENDING";
                  return (
                    <tr key={e.canonical} className="border-b border-[var(--color-biz-line)]/60">
                      <td className="py-2.5 pr-4 font-medium">{e.canonical}</td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-[var(--color-biz-muted)]">{e.runtimeType}</td>
                      <td className="py-2.5 pr-4 capitalize">{e.domain}</td>
                      <td className="py-2.5 pr-4 text-xs">
                        {pending ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                            Registered, no producer
                          </span>
                        ) : (
                          <span className="text-[var(--color-biz-muted)]">{e.producer ?? "—"}</span>
                        )}
                      </td>
                      <td className="py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${automated ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-600"}`}>
                          {automated ? (pending ? "Trigger (inert)" : "Trigger") : "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
