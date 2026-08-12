"use client";

import { useMemo, useState } from "react";
import {
  Star,
  Search,
  Eye,
  EyeOff,
  Flag,
  Trash2,
  MessageSquare,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { Pagination } from "@/components/ui/Pagination";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  useAdminReviewsQuery,
  useModerateReviewMutation,
  useDeleteReviewMutation,
} from "@/hooks/use-admin-data";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDate } from "@/lib/format";
import { getErrorMessage } from "@/lib/api-error";
import type { AdminReview } from "@/services/admin-api";

const PAGE_SIZE = 12;

const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "public", label: "Live" },
  { key: "hidden", label: "Hidden" },
  { key: "flagged", label: "Flagged" },
] as const;

const RATINGS = ["all", "5", "4", "3", "2", "1"] as const;

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${n} stars`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className="h-3.5 w-3.5"
          fill={s <= n ? "#f59e0b" : "transparent"}
          color={s <= n ? "#f59e0b" : "var(--color-biz-line-strong)"}
          strokeWidth={2}
        />
      ))}
    </span>
  );
}

export default function ReviewsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("all");
  const [rating, setRating] = useState<string>("all");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [toDelete, setToDelete] = useState<AdminReview | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const params = useMemo(
    () => ({ page, limit: PAGE_SIZE, status, rating, search: debouncedSearch }),
    [page, status, rating, debouncedSearch],
  );
  const { data, isLoading, isError } = useAdminReviewsQuery(params);
  const moderate = useModerateReviewMutation();
  const remove = useDeleteReviewMutation();

  const reviews = data?.reviews ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const stats = data?.stats;
  const flaggedCount = reviews.filter((r) => r.isFlagged).length;

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2200);
  };

  const doModerate = (id: string, patch: { isPublic?: boolean; isFlagged?: boolean }, msg: string) => {
    moderate.mutate({ id, patch }, { onSuccess: () => flash(msg), onError: (e) => flash(getErrorMessage(e)) });
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Customer Reviews</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">
          Every review a customer leaves after a service — moderate what appears on the customer app & website
        </p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-4">
        <KpiCard
          label="Average rating"
          value={stats?.averageRating != null ? `${stats.averageRating.toFixed(2)} ★` : "—"}
          icon={Star}
          accent="amber"
          loading={isLoading}
        />
        <KpiCard
          label="Total reviews"
          value={stats ? String(stats.totalReviews) : "—"}
          icon={MessageSquare}
          loading={isLoading}
        />
        <KpiCard
          label="Live on app"
          value={String(reviews.filter((r) => r.isPublic && !r.isFlagged).length)}
          icon={ShieldCheck}
          accent="green"
          loading={isLoading}
        />
        <KpiCard
          label="Flagged (page)"
          value={String(flaggedCount)}
          icon={Flag}
          accent="red"
          loading={isLoading}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="biz-segment">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`biz-segment-btn${status === t.key ? " is-active" : ""}`}
              onClick={() => {
                setStatus(t.key);
                setPage(1);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-biz-muted)]" />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search review text…"
            className="w-full rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[var(--color-biz-accent)]"
          />
        </div>
        <select
          value={rating}
          onChange={(e) => {
            setRating(e.target.value);
            setPage(1);
          }}
          className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-biz-accent)]"
        >
          {RATINGS.map((r) => (
            <option key={r} value={r}>
              {r === "all" ? "All ratings" : `${r} stars`}
            </option>
          ))}
        </select>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="biz-card h-40 animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <div className="biz-card p-8 text-center text-sm text-[var(--color-biz-muted)]">
          Failed to load reviews.
        </div>
      ) : reviews.length === 0 ? (
        <div className="biz-card p-10 text-center">
          <MessageSquare className="mx-auto mb-3 h-8 w-8 text-[var(--color-biz-faint)]" />
          <p className="text-sm text-[var(--color-biz-muted)]">No reviews match these filters.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {reviews.map((r) => {
            const live = r.isPublic && !r.isFlagged;
            return (
              <div key={r.id} className="biz-card flex flex-col p-5">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Stars n={r.rating} />
                      {live ? (
                        <span className="rounded-full bg-[var(--color-biz-accent-dim)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-biz-accent)]">
                          Live
                        </span>
                      ) : r.isFlagged ? (
                        <span className="rounded-full bg-red-500/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#b91c1c]">
                          Flagged
                        </span>
                      ) : (
                        <span className="rounded-full bg-[var(--color-biz-elevated)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-biz-muted)]">
                          Hidden
                        </span>
                      )}
                    </div>
                    <p className="mt-2 truncate text-sm font-semibold text-[var(--color-biz-text)]">
                      {r.customer}
                      <span className="font-normal text-[var(--color-biz-muted)]"> → {r.provider}</span>
                    </p>
                    <p className="text-[11px] text-[var(--color-biz-faint)]">
                      {r.service} · {r.bookingNumber} · {formatDate(r.createdAt)}
                    </p>
                  </div>
                </div>

                <p className="flex-1 text-sm leading-relaxed text-[var(--color-biz-text)]">
                  {r.reviewText || <span className="italic text-[var(--color-biz-faint)]">No written review</span>}
                </p>

                {r.providerResponse ? (
                  <div className="mt-3 rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)] p-3">
                    <p className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-[var(--color-biz-accent)]">
                      <MessageSquare className="h-3 w-3" /> Partner reply
                    </p>
                    <p className="text-xs text-[var(--color-biz-muted)]">{r.providerResponse}</p>
                  </div>
                ) : null}

                {/* Actions */}
                <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--color-biz-line)] pt-3">
                  <button
                    type="button"
                    onClick={() =>
                      doModerate(r.id, { isPublic: !r.isPublic }, r.isPublic ? "Hidden from app" : "Now live on app")
                    }
                    className="biz-btn inline-flex items-center gap-1.5 text-xs"
                  >
                    {r.isPublic ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {r.isPublic ? "Hide" : "Show"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      doModerate(r.id, { isFlagged: !r.isFlagged }, r.isFlagged ? "Unflagged" : "Flagged")
                    }
                    className="biz-btn inline-flex items-center gap-1.5 text-xs"
                  >
                    <Flag className="h-3.5 w-3.5" />
                    {r.isFlagged ? "Unflag" : "Flag"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setToDelete(r)}
                    className="biz-btn ml-auto inline-flex items-center gap-1.5 text-xs text-[#b91c1c]"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 ? (
        <Pagination page={page} total={total} limit={PAGE_SIZE} onPageChange={setPage} />
      ) : null}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete this review?"
        description={`This permanently removes ${toDelete?.customer ?? "the customer"}'s review. This cannot be undone.`}
        confirmLabel="Delete review"
        destructive
        isLoading={remove.isPending}
        onClose={() => setToDelete(null)}
        onConfirm={() => {
          if (!toDelete) return;
          const id = toDelete.id;
          remove.mutate(id, {
            onSuccess: () => {
              flash("Review deleted");
              setToDelete(null);
            },
            onError: (e) => flash(getErrorMessage(e)),
          });
        }}
      />

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-[var(--color-biz-text)] px-4 py-2.5 text-sm font-semibold text-[var(--color-biz-surface)] shadow-[var(--shadow-enterprise)]">
          <span className="inline-flex items-center gap-2">
            {(moderate.isPending || remove.isPending) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {toast}
          </span>
        </div>
      ) : null}
    </div>
  );
}
