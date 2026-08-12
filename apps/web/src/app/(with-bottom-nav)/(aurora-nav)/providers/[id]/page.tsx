"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { m as motion } from "framer-motion";
import {
  ArrowLeft,
  BadgeCheck,
  Calendar,
  CheckCircle2,
  Clock,
  MapPin,
  MessageSquare,
  Star,
  Sparkles,
  ThumbsUp,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/buttons/Button";
import {
  useProviderAvailabilityQuery,
  useProviderDetailQuery,
  useProviderReviewsQuery,
} from "@/hooks/use-core-data";
import { bookUrl } from "@/lib/booking-url";
import { cn } from "@/lib/utils";

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ProviderDetailPage() {
  const params = useParams<{ id: string }>();
  const providerId = params?.id ?? "";

  const providerQuery = useProviderDetailQuery(providerId);
  const reviewsQuery = useProviderReviewsQuery(providerId, "?limit=8&page=1");

  const [date, setDate] = useState<string>(todayIso());
  const provider = providerQuery.data?.provider;
  const primaryServiceId = useMemo(
    () => provider?.services?.[0]?.id ?? "",
    [provider?.services],
  );

  const availabilityQuery = useProviderAvailabilityQuery(
    providerId,
    date,
    primaryServiceId,
  );

  if (providerQuery.isError && !providerQuery.data) {
    return (
      <PageShell>
        <Link
          href="/providers"
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-muted hover:text-primary"
        >
          <ArrowLeft size={16} /> Back to providers
        </Link>
        <div className="rounded-2xl border border-line bg-surface/60 p-6 text-center text-sm text-muted">
          <p>Unable to load provider details.</p>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => void providerQuery.refetch()}
            className="mt-4"
          >
            Retry
          </Button>
        </div>
      </PageShell>
    );
  }

  if (providerQuery.isLoading || !provider) {
    return (
      <PageShell>
        <div className="space-y-6">
          <div className="h-6 w-32 animate-pulse rounded bg-surface/70" />
          <div className="h-44 animate-pulse rounded-[28px] bg-surface/70" />
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-2xl bg-surface/70"
              />
            ))}
          </div>
          <div className="h-44 animate-pulse rounded-[24px] bg-surface/70" />
        </div>
      </PageShell>
    );
  }

  const slots =
    "slots" in (availabilityQuery.data ?? {})
      ? (availabilityQuery.data as { slots: { start: string; end: string; available: boolean }[] }).slots
      : [];

  const reviews = reviewsQuery.data?.reviews ?? [];
  const averageRating =
    reviewsQuery.data?.averageRating ?? provider.rating ?? 0;
  const breakdown = reviewsQuery.data?.breakdown ?? {};

  return (
    <PageShell>
      <Link
        href="/providers"
        className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-muted hover:text-primary"
      >
        <ArrowLeft size={16} /> Back to providers
      </Link>

      {/* Hero */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="overflow-hidden rounded-[28px] glass-card p-6"
      >
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <div className="relative size-24 shrink-0 overflow-hidden rounded-2xl ring-2 ring-primary/20">
            <Image
              src={
                provider.profileImage ??
                "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=90&auto=format&fit=crop"
              }
              alt={provider.name}
              fill
              className="object-cover"
              sizes="96px"
            />
            {provider.isOnline ? (
              <span className="absolute bottom-1 right-1 size-3 rounded-full border-2 border-white bg-emerald-500" />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-bold text-content">
                {provider.name}
              </h1>
              {provider.isVerified ? (
                <BadgeCheck size={20} className="text-primary" aria-label="Verified" />
              ) : null}
            </div>
            <p className="mt-1 flex items-center gap-1 text-sm font-bold text-content">
              <Star size={14} className="fill-amber-400 text-amber-400" />
              {(provider.rating ?? 0).toFixed(1)}
              <span className="font-normal text-muted">
                ({provider.reviewCount ?? 0} reviews)
              </span>
            </p>
            {provider.city ? (
              <p className="mt-1 flex items-center gap-1 text-xs text-muted">
                <MapPin size={12} /> {provider.city}
              </p>
            ) : null}
            {provider.bio ? (
              <p className="mt-3 text-sm leading-relaxed text-muted line-clamp-3">
                {provider.bio}
              </p>
            ) : null}
            {provider.badges?.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {provider.badges.map((b) => (
                  <span
                    key={b}
                    className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"
                  >
                    {b}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {/* Stat row */}
        <div className="mt-6 grid grid-cols-3 gap-3">
          <StatCard
            label="Jobs done"
            value={provider.completedJobs?.toLocaleString("en-IN") ?? "—"}
            icon={CheckCircle2}
          />
          <StatCard
            label="Response"
            value={
              provider.responseTime != null
                ? `${provider.responseTime} min`
                : "—"
            }
            icon={Clock}
          />
          <StatCard
            label="Acceptance"
            value={
              provider.acceptanceRate != null
                ? `${Math.round(provider.acceptanceRate * 100)}%`
                : "—"
            }
            icon={ThumbsUp}
          />
        </div>

        <div className="mt-6">
          <Link
            href={bookUrl({
              service: primaryServiceId,
            })}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-aurora text-base font-bold text-white shadow-glow-blue transition hover:brightness-110"
          >
            <Sparkles size={18} />
            Book {provider.name.split(" ")[0]}
          </Link>
        </div>
      </motion.section>

      {/* Services */}
      {provider.services?.length ? (
        <section className="mt-8">
          <h2 className="mb-3 font-display text-xl font-bold text-content">
            Services offered
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {provider.services.map((s) => (
              <Link
                key={s.id}
                href={bookUrl({ service: s.id })}
                className="flex items-center justify-between rounded-2xl glass-card p-4 transition hover:bg-primary/5"
              >
                <div>
                  <p className="text-sm font-bold text-content">{s.name}</p>
                  {s.basePrice ? (
                    <p className="text-xs text-muted">From ₹{s.basePrice}</p>
                  ) : null}
                </div>
                <span className="text-sm font-bold text-primary">Book →</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Availability */}
      {primaryServiceId ? (
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-xl font-bold text-content">
              Availability
            </h2>
            <label className="flex items-center gap-2 text-sm text-muted">
              <Calendar size={14} />
              <input
                type="date"
                value={date}
                min={todayIso()}
                onChange={(e) => setDate(e.target.value || todayIso())}
                className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-content focus:border-primary focus:outline-none"
              />
            </label>
          </div>

          {availabilityQuery.isLoading ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="h-12 animate-pulse rounded-xl bg-surface/70"
                />
              ))}
            </div>
          ) : slots.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface/60 p-6 text-center text-sm text-muted">
              No availability info for the selected date.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {slots.map((slot) => (
                <button
                  key={`${slot.start}-${slot.end}`}
                  type="button"
                  disabled={!slot.available}
                  className={cn(
                    "rounded-xl px-3 py-2.5 text-sm font-bold transition",
                    slot.available
                      ? "glass-card text-content hover:bg-primary/5"
                      : "border border-dashed border-line text-muted opacity-60",
                  )}
                >
                  {formatSlotTime(slot.start)}
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* Reviews */}
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-content">
            Reviews
          </h2>
          <p className="flex items-center gap-1 text-sm font-bold text-content">
            <Star size={14} className="fill-amber-400 text-amber-400" />
            {averageRating.toFixed(1)} · {reviewsQuery.data?.total ?? 0}
          </p>
        </div>

        {Object.keys(breakdown).length > 0 ? (
          <div className="mb-4 grid gap-1.5 rounded-2xl glass-card p-4 text-sm">
            {[5, 4, 3, 2, 1].map((star) => {
              const count = (breakdown as Record<string, number>)[String(star)] ?? 0;
              const total = Object.values(breakdown).reduce(
                (a, b) => a + (b as number),
                0,
              );
              const pct = total ? Math.round((count / total) * 100) : 0;
              return (
                <div key={star} className="flex items-center gap-2 text-xs">
                  <span className="w-6 text-content">{star}★</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-line/50">
                    <div
                      className="h-full rounded-full bg-amber-400 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-12 text-right text-muted">{count}</span>
                </div>
              );
            })}
          </div>
        ) : null}

        {reviewsQuery.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-2xl bg-surface/70"
              />
            ))}
          </div>
        ) : reviews.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-surface/60 p-6 text-center text-sm text-muted">
            No reviews yet. Be the first to book and review!
          </div>
        ) : (
          <div className="space-y-3">
            {reviews.map((r) => (
              <article key={r.id} className="rounded-2xl glass-card p-4">
                <header className="flex items-start gap-3">
                  <span className="relative size-10 overflow-hidden rounded-full ring-1 ring-line">
                    <Image
                      src={
                        r.userImage ??
                        "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&q=90"
                      }
                      alt={r.userName ?? "Customer"}
                      fill
                      className="object-cover"
                      sizes="40px"
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-content">
                      {r.userName ?? "Customer"}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                      <span className="flex items-center gap-0.5">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            size={10}
                            className={cn(
                              i < r.rating
                                ? "fill-amber-400 text-amber-400"
                                : "text-muted/40",
                            )}
                          />
                        ))}
                      </span>
                      <span>·</span>
                      <span>{formatReviewDate(r.createdAt)}</span>
                      {r.serviceName ? (
                        <>
                          <span>·</span>
                          <span>{r.serviceName}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </header>
                {r.reviewText ? (
                  <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-content">
                    {r.reviewText}
                  </p>
                ) : null}
                {r.providerResponse ? (
                  <div className="mt-3 rounded-2xl border border-primary/20 bg-primary/5 p-3 text-sm">
                    <p className="mb-1 flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-primary">
                      <MessageSquare size={11} /> Provider reply
                    </p>
                    <p className="text-content">{r.providerResponse}</p>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </PageShell>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface/60 p-3 text-center">
      <Icon size={18} className="mx-auto text-primary" />
      <p className="mt-1 text-base font-bold text-content">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
    </div>
  );
}

function formatSlotTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

function formatReviewDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
