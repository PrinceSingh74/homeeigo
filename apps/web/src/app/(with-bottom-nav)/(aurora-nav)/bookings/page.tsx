"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { m as motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Sparkles, Plus, ArrowLeft } from "lucide-react";
import { StaticSkeleton } from "@/components/ui/StaticSkeleton";
import { BookingCard } from "@/components/booking/BookingCard";
import { BookingDetailModal } from "@/components/booking/BookingDetailModal";
import { useBookingsQuery } from "@/hooks/use-core-data";
import { useAppStore } from "@/stores/app-store";
import type { SavedBooking } from "@/lib/bookings";
import {
  filterBookings,
  countByFilter,
  type BookingFilter,
} from "@/lib/booking-status";
import { bookUrl } from "@/lib/booking-url";
import { PageShell } from "@/components/layout/PageShell";
import { pageLead, pageTitle } from "@/lib/page-layout";
import { cn } from "@/lib/utils";
import { useOnlineStatus } from "@/hooks/use-online-status";

const FILTERS: { key: BookingFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "upcoming", label: "Upcoming" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

export default function BookingsPage() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const bookings = useAppStore((s) => s.bookings);
  const { isLoading, isFetching } = useBookingsQuery();
  const [filter, setFilter] = useState<BookingFilter>("all");
  const [selected, setSelected] = useState<SavedBooking | null>(null);
  const online = useOnlineStatus();

  const counts = useMemo(() => countByFilter(bookings), [bookings]);
  const filtered = useMemo(
    () => filterBookings(bookings, filter),
    [bookings, filter],
  );

  return (
    <>
      <PageShell>
        <motion.header
          initial={reduce ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="mb-6 flex items-start justify-between gap-3 sm:mb-8 sm:gap-4"
        >
          <div className="min-w-0 flex-1">
            <Link
              href="/"
              className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted transition hover:text-primary"
            >
              <ArrowLeft size={16} />
              Home
            </Link>
            <h1 className={pageTitle}>
              My <span className="text-aurora">Bookings</span>
            </h1>
            <p className={pageLead}>
              Track live, manage status, cancel anytime — same premium experience as the app.
            </p>
          </div>
          <motion.button
            type="button"
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            onClick={() => router.push(bookUrl())}
            aria-label="Book new service"
            className="grid size-14 shrink-0 place-items-center rounded-2xl bg-aurora text-white shadow-glow-blue"
          >
            <Plus size={24} strokeWidth={2.5} />
          </motion.button>
        </motion.header>

        {bookings.length > 0 && (
          <motion.div
            initial={reduce ? false : { opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="mb-6 flex gap-3 overflow-x-auto pb-1 scrollbar-none"
          >
            <StatPill label="Upcoming" value={counts.upcoming} accent="text-primary" />
            <StatPill label="Completed" value={counts.completed} accent="text-success" />
            <StatPill label="Cancelled" value={counts.cancelled} accent="text-muted" />
          </motion.div>
        )}

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.5 }}
          className="mb-8 flex flex-wrap gap-2"
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const count = counts[f.key];
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold transition-all duration-300",
                  active
                    ? "bg-aurora text-white shadow-glow-blue"
                    : "glass-card text-content hover:bg-primary/5",
                )}
              >
                {f.label}
                {count > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-extrabold",
                      active ? "bg-white/25" : "bg-surface text-muted",
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </motion.div>
        {!online ? (
          <div className="mb-4 rounded-xl border border-line bg-surface/70 px-3 py-2 text-xs text-muted">
            You are offline. Showing cached bookings; realtime sync resumes when online.
          </div>
        ) : null}

        {isLoading ? (
          <motion.ul layout className="flex flex-col gap-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <li key={i}><StaticSkeleton className="h-40 rounded-[28px] bg-surface/70 ring-1 ring-line" /></li>
            ))}
          </motion.ul>
        ) : bookings.length === 0 ? (
          <EmptyState
            title="No bookings yet"
            subtitle="Book verified pros in under 60 seconds. Track live, cancel anytime, and see your full history here."
            cta="Book your first service"
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={`No ${filter === "all" ? "" : filter} bookings`}
            subtitle="Try another filter or book a new service."
            cta="Book a service"
          />
        ) : (
          <motion.ul layout className="flex flex-col gap-5">
            <AnimatePresence mode="popLayout">
              {filtered.map((b, i) => (
                <li key={b.id}>
                  <BookingCard
                    booking={b}
                    index={i}
                    onClick={() => setSelected(b)}
                  />
                </li>
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
        {isFetching && !isLoading ? (
          <p className="mt-4 text-center text-xs text-muted">Refreshing bookings…</p>
        ) : null}
      </PageShell>

      <BookingDetailModal
        open={!!selected}
        booking={selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function StatPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="shrink-0 rounded-2xl glass-card px-5 py-3">
      <p className={cn("font-display text-2xl font-bold", accent)}>{value}</p>
      <p className="text-xs font-semibold text-muted">{label}</p>
    </div>
  );
}

function EmptyState({
  title,
  subtitle,
  cta,
}: {
  title: string;
  subtitle: string;
  cta: string;
}) {
  const router = useRouter();
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center px-4 py-16 text-center"
    >
      <span className="grid size-20 place-items-center rounded-3xl bg-aurora text-white shadow-glow-blue">
        <Sparkles size={36} />
      </span>
      <h2 className="mt-6 font-display text-2xl font-bold text-content">{title}</h2>
      <p className="mt-2 max-w-sm text-sm text-muted">{subtitle}</p>
      <button
        type="button"
        onClick={() => router.push(bookUrl())}
        className="mt-8 h-12 rounded-2xl bg-aurora px-8 text-sm font-bold text-white shadow-glow-blue transition hover:brightness-110"
      >
        {cta}
      </button>
    </motion.div>
  );
}
