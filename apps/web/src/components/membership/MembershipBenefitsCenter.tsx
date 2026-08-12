"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BadgePercent,
  Check,
  Copy,
  Gift,
  Loader2,
  Sparkles,
  Ticket,
  TrendingUp,
} from "lucide-react";
import { coreApi } from "@/services/core/api";
import { useEntitlements } from "@/hooks/use-entitlements";
import { useAppStore } from "@/stores/app-store";
import { bookUrl } from "@/lib/booking-url";
import { cn } from "@/lib/utils";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : "—";

export function MembershipBenefitsCenter() {
  const showToast = useAppStore((s) => s.showToast);
  const { data: entitlements } = useEntitlements();

  const { data: coupons, isLoading: couponsLoading } = useQuery({
    queryKey: ["subscriptions", "coupons"],
    queryFn: () => coreApi.subscriptions.coupons(),
  });
  const { data: cashback } = useQuery({
    queryKey: ["subscriptions", "cashback"],
    queryFn: () => coreApi.subscriptions.cashbackHistory("?limit=10"),
  });
  const { data: insights } = useQuery({
    queryKey: ["subscriptions", "insights"],
    queryFn: () => coreApi.subscriptions.insights(),
  });

  const { active, used, expiringSoon } = useMemo(() => {
    const list = coupons ?? [];
    const now = Date.now();
    const week = now + 7 * 24 * 60 * 60 * 1000;
    return {
      active: list.filter((c) => c.eligible && !c.usedAt),
      used: list.filter((c) => c.usedAt),
      expiringSoon: list.filter(
        (c) =>
          c.eligible &&
          !c.usedAt &&
          c.expiresAt &&
          new Date(c.expiresAt).getTime() <= week &&
          new Date(c.expiresAt).getTime() > now,
      ),
    };
  }, [coupons]);

  const totalSavings =
    (insights as { totalSavings?: number } | undefined)?.totalSavings ??
    used.reduce((sum, c) => sum + (c.discountAmount ?? 0), 0);

  function copyCode(code: string) {
    void navigator.clipboard.writeText(code);
    showToast(`Copied ${code}`, "success");
  }

  if (couponsLoading) {
    return (
      <div className="flex items-center gap-2 rounded-[28px] border border-line p-8 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading membership benefits…
      </div>
    );
  }

  return (
    <section className="space-y-5">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-content">
        <Gift size={18} className="text-emerald-600" />
        Membership benefits center
      </h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="glass-card rounded-2xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Total savings</p>
          <p className="mt-1 font-display text-2xl font-bold text-success">{inr(totalSavings)}</p>
        </div>
        <div className="glass-card rounded-2xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Active coupons</p>
          <p className="mt-1 font-display text-2xl font-bold text-content">{active.length}</p>
        </div>
        <div className="glass-card rounded-2xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Cashback earned</p>
          <p className="mt-1 font-display text-2xl font-bold text-emerald-600">
            {inr(cashback?.summary?.totalCredited ?? 0)}
          </p>
        </div>
      </div>

      {entitlements && (
        <div className="glass-card rounded-2xl p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Your plan benefits
          </p>
          <div className="flex flex-wrap gap-2">
            {entitlements.discountPct > 0 && (
              <span className="rounded-full bg-success/10 px-3 py-1 text-xs font-bold text-success">
                {entitlements.discountPct}% booking discount
              </span>
            )}
            {entitlements.cashbackPct > 0 && (
              <span className="rounded-full bg-emerald-600/10 px-3 py-1 text-xs font-bold text-emerald-600">
                {entitlements.cashbackPct}% cashback
              </span>
            )}
            {entitlements.freeDelivery && (
              <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-700">
                Free delivery
              </span>
            )}
            {entitlements.prioritySupport && (
              <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-600">
                Priority support
              </span>
            )}
          </div>
        </div>
      )}

      {expiringSoon.length > 0 && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p>
            <span className="font-semibold">{expiringSoon.length} coupon(s)</span> expire within 7
            days — use them at checkout.
          </p>
        </div>
      )}

      <CouponBlock
        title="Available coupons"
        empty="No coupons available for your plan right now."
        coupons={active}
        onCopy={copyCode}
        bookHref={(code) => bookUrl({ promo: code })}
      />

      {used.length > 0 && (
        <CouponBlock title="Used coupons" coupons={used} onCopy={copyCode} used />
      )}

      {cashback?.cashbacks && cashback.cashbacks.length > 0 && (
        <div className="glass-card rounded-2xl p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-content">
            <TrendingUp size={16} className="text-emerald-600" />
            Cashback history
          </h3>
          <ul className="space-y-2 text-sm">
            {cashback.cashbacks.slice(0, 5).map((e) => (
              <li key={e.id} className="flex justify-between gap-2 text-muted">
                <span>{e.bookingNumber}</span>
                <span className="font-semibold text-success">+{inr(e.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Link
        href={active[0] ? bookUrl({ promo: active[0].code }) : "/book"}
        className="inline-flex items-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#10b981_0%,#0d9488_100%)] px-5 py-3 text-sm font-bold text-white shadow-[0_8px_24px_-6px_rgb(16_185_129/0.5)]"
      >
        <Sparkles size={16} />
        {active[0] ? `Book with ${active[0].code}` : "Book a service"}
      </Link>
    </section>
  );
}

function CouponBlock({
  title,
  coupons,
  onCopy,
  bookHref,
  empty,
  used,
}: {
  title: string;
  coupons: Array<{
    id: string;
    code: string;
    name: string;
    discountPct: number | null;
    discountAmount: number | null;
    expiresAt: string | null;
    usedAt?: string | null;
    eligible?: boolean;
  }>;
  onCopy: (code: string) => void;
  bookHref?: (code: string) => string;
  empty?: string;
  used?: boolean;
}) {
  if (!coupons.length) {
    return empty ? (
      <p className="rounded-2xl border border-dashed border-line py-6 text-center text-sm text-muted">
        {empty}
      </p>
    ) : null;
  }

  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-content">
        <Ticket size={16} className="text-emerald-600" />
        {title}
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {coupons.map((c) => (
          <article
            key={c.id}
            className={cn(
              "glass-card rounded-2xl p-4",
              used && "opacity-75",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-content">{c.name}</p>
                <p className="mt-0.5 font-mono text-sm text-emerald-600">{c.code}</p>
              </div>
              {!used && (
                <button
                  type="button"
                  onClick={() => onCopy(c.code)}
                  className="rounded-lg bg-emerald-600/10 p-2 text-emerald-600"
                  aria-label={`Copy ${c.code}`}
                >
                  <Copy size={14} />
                </button>
              )}
            </div>
            <p className="mt-2 flex items-center gap-1 text-xs text-muted">
              <BadgePercent size={12} />
              {c.discountPct ? `${c.discountPct}% off` : c.discountAmount ? inr(c.discountAmount) : "Discount"}
            </p>
            <p className="mt-1 text-xs text-muted">
              {used ? `Used ${fmt(c.usedAt ?? null)}` : `Expires ${fmt(c.expiresAt)}`}
            </p>
            {c.eligible !== false && !used && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <p className="flex items-center gap-1 text-xs font-semibold text-success">
                  <Check size={12} /> Eligible at checkout
                </p>
                {bookHref && (
                  <Link
                    href={bookHref(c.code)}
                    className="rounded-lg bg-[linear-gradient(135deg,#10b981_0%,#0d9488_100%)] px-3 py-1.5 text-xs font-bold text-white"
                  >
                    Use now
                  </Link>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
