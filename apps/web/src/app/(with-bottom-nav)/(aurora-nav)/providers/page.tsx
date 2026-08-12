"use client";

import { useMemo, useState } from "react";
import { m as motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, MapPin, Star } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { useMatchedProvidersQuery, useServicesQuery } from "@/hooks/use-core-data";
import type { BackendProviderScoreBreakdown } from "@/types/backend";
import { bookUrl } from "@/lib/booking-url";
import { cn } from "@/lib/utils";

function scoreBadgeClasses(score: number): string {
  if (score >= 90) return "bg-emerald-500/15 text-emerald-500 ring-emerald-500/30";
  if (score >= 75) return "bg-sky-500/15 text-sky-500 ring-sky-500/30";
  if (score >= 60) return "bg-amber-500/15 text-amber-500 ring-amber-500/30";
  return "bg-orange-500/15 text-orange-500 ring-orange-500/30";
}

function scoreLabel(score: number): string {
  if (score >= 90) return "Excellent match";
  if (score >= 75) return "Very good match";
  if (score >= 60) return "Good match";
  return "Fair match";
}

const BREAKDOWN_ROWS: Array<{
  key: keyof BackendProviderScoreBreakdown;
  label: string;
  max: number;
  bar: string;
}> = [
  { key: "ratingScore", label: "Quality (rating)", max: 30, bar: "bg-sky-500" },
  { key: "distanceScore", label: "Location (distance)", max: 25, bar: "bg-emerald-500" },
  { key: "availabilityScore", label: "Availability", max: 20, bar: "bg-violet-500" },
  { key: "responseScore", label: "Responsiveness", max: 15, bar: "bg-amber-500" },
  { key: "completionScore", label: "Reliability", max: 10, bar: "bg-rose-500" },
];

function ScoreBreakdown({ breakdown }: { breakdown: BackendProviderScoreBreakdown }) {
  return (
    <details className="mt-3 text-xs text-muted">
      <summary className="cursor-pointer select-none font-semibold text-content/80 hover:text-primary">
        Score breakdown
      </summary>
      <div className="mt-2 space-y-2">
        {BREAKDOWN_ROWS.map((row) => {
          const value = breakdown[row.key];
          const pct = Math.max(0, Math.min(100, (value / row.max) * 100));
          return (
            <div key={row.key} className="flex items-center justify-between gap-2">
              <span className="shrink-0">{row.label}</span>
              <div className="flex items-center gap-2">
                <span className="h-2 w-20 overflow-hidden rounded-full bg-line">
                  <span className={cn("block h-full rounded-full", row.bar)} style={{ width: `${pct}%` }} />
                </span>
                <span className="w-10 text-right tabular-nums text-content/70">
                  {Math.round(value)}/{row.max}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

export default function ProvidersDiscoveryPage() {
  const { data: servicesData, isLoading: servicesLoading } = useServicesQuery();
  const services = useMemo(() => servicesData?.services ?? [], [servicesData?.services]);
  const [activeServiceId, setActiveServiceId] = useState<string>("");
  const selectedService = activeServiceId || services[0]?.id || "";
  const providersQuery = useMatchedProvidersQuery(selectedService);
  const providers = providersQuery.data?.providers ?? [];

  const displayServiceName = useMemo(
    () => services.find((s) => s.id === selectedService)?.name ?? "Providers",
    [selectedService, services],
  );

  return (
    <PageShell>
      <header className="mb-6">
        <Link href="/services" className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-muted hover:text-primary">
          <ArrowLeft size={16} />
          Back to services
        </Link>
        <h1 className="font-display text-3xl font-bold text-content">Discover Providers</h1>
        <p className="mt-1 text-sm text-muted">
          Smart-ranked by quality, distance, availability, response &amp; reliability for {displayServiceName}.
        </p>
      </header>

      <div className="mb-6 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {(servicesLoading ? [] : services).map((service) => (
          <button
            key={service.id}
            type="button"
            onClick={() => setActiveServiceId(service.id)}
            className={cn(
              "shrink-0 rounded-full px-4 py-2 text-sm font-bold transition",
              selectedService === service.id ? "bg-aurora text-white shadow-glow-blue" : "glass-card text-content hover:bg-primary/5",
            )}
          >
            {service.name}
          </button>
        ))}
      </div>

      {providersQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-[24px] bg-surface/70 ring-1 ring-line" />
          ))}
        </div>
      ) : null}

      {!providersQuery.isLoading && providersQuery.isError ? (
        <div className="rounded-2xl border border-line bg-surface/60 p-5 text-center text-sm text-muted">
          Unable to load providers right now.
          <button type="button" onClick={() => void providersQuery.refetch()} className="ml-2 font-semibold text-primary underline">
            Retry
          </button>
        </div>
      ) : null}

      {!providersQuery.isLoading && !providersQuery.isError && providers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface/60 p-6 text-center text-sm text-muted">
          No providers available for this service at the moment.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {(providersQuery.isLoading || providersQuery.isError ? [] : providers).map((provider, i) => (
          <motion.article
            key={provider.providerId}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="rounded-[24px] glass-card p-4"
          >
            <Link href={`/providers/${provider.providerId}`} className="flex items-start gap-3">
              <span className="relative size-14 overflow-hidden rounded-xl ring-1 ring-line">
                <Image
                  src={provider.profileImage ?? "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&q=90&auto=format&fit=crop"}
                  alt={provider.name}
                  fill
                  className="object-cover"
                  sizes="56px"
                />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-display text-lg font-bold text-content">{provider.name}</h3>
                <p className="mt-1 flex items-center gap-1 text-xs text-muted">
                  <Star size={12} className="fill-amber-400 text-amber-400" />
                  {(provider.rating ?? 4.8).toFixed(1)} ({provider.totalReviews ?? 0} reviews)
                </p>
                <p className="mt-1 flex items-center gap-1 text-xs text-muted">
                  <MapPin size={12} />
                  {provider.distance ?? 0} km away · ETA {provider.eta ?? 15} mins
                  {provider.isOnline ? <span className="ml-1 text-emerald-500">· Online</span> : null}
                </p>
              </div>
              <span
                className={cn(
                  "flex shrink-0 flex-col items-center rounded-2xl px-3 py-1.5 text-center ring-1",
                  scoreBadgeClasses(provider.totalScore),
                )}
              >
                <span className="font-display text-xl font-extrabold leading-none tabular-nums">
                  {Math.round(provider.totalScore)}
                </span>
                <span className="mt-0.5 text-[10px] font-semibold leading-tight">{scoreLabel(provider.totalScore)}</span>
              </span>
            </Link>

            <ScoreBreakdown breakdown={provider.scoreBreakdown} />

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link
                href={`/providers/${provider.providerId}`}
                className="flex h-10 items-center justify-center rounded-xl glass-card text-sm font-bold text-primary"
              >
                View profile
              </Link>
              <Link
                href={bookUrl({ service: selectedService })}
                className="flex h-10 items-center justify-center rounded-xl bg-aurora text-sm font-bold text-white shadow-glow-blue"
              >
                Book Now
              </Link>
            </div>
          </motion.article>
        ))}
      </div>
    </PageShell>
  );
}
