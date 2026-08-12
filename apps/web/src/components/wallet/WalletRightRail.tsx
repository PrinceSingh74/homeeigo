"use client";

import { useState } from "react";
import { m as motion, useReducedMotion } from "framer-motion";
import { Copy, Sparkles, TrendingUp } from "lucide-react";
import { walletPanelPad, walletPanelShell } from "@/components/wallet/wallet-page-layout";
import {
  WALLET_OFFERS,
  WALLET_SPARKLINE,
  WALLET_SPEND_CHANGE_PCT,
} from "@/lib/wallet-dashboard";
import { usePaymentsHistoryQuery } from "@/hooks/use-core-data";
import { coreApi } from "@/services/core/api";
import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "@/stores/app-store";
import { bookUrl } from "@/lib/booking-url";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/Select";
import {
  CLIPBOARD_UNAVAILABLE_TOAST,
  copyToClipboard,
} from "@/lib/clipboard";

const SPEND_PERIOD_OPTIONS = [
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "quarter", label: "Last 3 Months" },
] as const;

function Sparkline() {
  const data = WALLET_SPARKLINE;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const w = 280;
  const h = 100;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / (max - min || 1)) * (h - 8) - 4;
      return `${x},${y}`;
    })
    .join(" ");
  const area = `${points} ${w},${h} 0,${h}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-4 h-[88px] w-full sm:mt-5 sm:h-[120px]" preserveAspectRatio="none">
      <defs>
        <linearGradient id="wallet-spend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(124 58 237 / 0.3)" />
          <stop offset="100%" stopColor="rgb(124 58 237 / 0)" />
        </linearGradient>
        <linearGradient id="wallet-spend-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#059669" />
          <stop offset="100%" stopColor="#14b8a6" />
        </linearGradient>
      </defs>
      <polygon fill="url(#wallet-spend-fill)" points={area} />
      <polyline
        fill="none"
        stroke="url(#wallet-spend-line)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

export function WalletRightRail() {
  const reduce = useReducedMotion();
  const showToast = useAppStore((s) => s.showToast);
  const router = useRouter();
  const [spendPeriod, setSpendPeriod] = useState("month");
  const { data: paymentsData, isLoading: paymentsLoading } = usePaymentsHistoryQuery();
  const { data: offersData } = useQuery({
    queryKey: ["wallet", "offers"],
    queryFn: () => coreApi.wallet.offers(),
    staleTime: 30_000,
  });
  const offers =
    (offersData?.offers as Array<{ id?: string; title?: string; description?: string; amount?: number; discount?: number; code?: string; }> | undefined)
      ?.slice(0, 3)
      .map((o, i) => ({
        id: o.id ?? String(i + 1),
        badge: o.discount ? `${o.discount}% OFF` : o.amount ? `₹${o.amount}` : "Offer",
        title: o.title ?? "Special Offer",
        description: o.description ?? "Limited period offer",
        code: o.code ?? `HMG${i + 1}00`,
      })) ?? WALLET_OFFERS;
  const totalSpend =
    paymentsData?.payments?.reduce((sum, p) => sum + Number((p.amount as number | undefined) ?? 0), 0) ??
    0;

  return (
    <aside className="flex w-full min-w-0 flex-col gap-5 sm:gap-6 xl:sticky xl:top-[calc(var(--site-nav-offset,4rem)+1.5rem)] xl:self-start">
      <motion.section
        initial={reduce ? false : { opacity: 0, x: 30 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
        className={cn(walletPanelShell, walletPanelPad)}
      >
        <div className="mb-4 flex min-w-0 items-center justify-between gap-2 sm:mb-5">
          <h3 className="font-display text-[15px] font-bold text-content sm:text-base">
            Exclusive Offers
          </h3>
          <button type="button" className="shrink-0 text-[11px] font-semibold text-emerald-600 hover:opacity-80 sm:text-xs">
            View All
          </button>
        </div>
        <div className="space-y-3 sm:space-y-4">
          {offers.map((offer, i) => (
            <motion.article
              key={offer.id}
              initial={reduce ? false : { opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1, duration: 0.4 }}
              className="wallet-offer-card p-3.5 transition sm:p-4"
            >
              <div className="mb-2.5 flex items-start justify-between gap-2 sm:mb-3">
                <span className="grid size-9 place-items-center rounded-[10px] bg-gradient-to-br from-emerald-500 to-teal-500 text-white sm:size-10">
                  <Sparkles size={16} className="sm:hidden" />
                  <Sparkles size={18} className="hidden sm:block" />
                </span>
                <span className="shrink-0 rounded-md bg-success px-1.5 py-0.5 text-[8px] font-bold uppercase text-white sm:px-2 sm:text-[9px]">
                  {offer.badge}
                </span>
              </div>
              <p className="font-display text-[13px] font-bold leading-snug text-content sm:text-sm">
                {offer.title}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted sm:text-xs">
                {offer.description}
              </p>
              <div className="mt-2.5 flex min-w-0 items-center justify-between gap-2 rounded-lg border border-dashed border-line bg-canvas px-2.5 py-2 dark:bg-charcoal/60 sm:mt-3 sm:px-3">
                <code className="min-w-0 truncate font-mono text-[10px] font-semibold text-emerald-600 sm:text-[11px]">
                  {offer.code}
                </code>
                <button
                  type="button"
                  aria-label="Copy code"
                  onClick={async () => {
                    const ok = await copyToClipboard(offer.code);
                    showToast(
                      ok ? `Copied ${offer.code}` : CLIPBOARD_UNAVAILABLE_TOAST,
                      ok ? "success" : "info",
                    );
                  }}
                  className="shrink-0 text-muted hover:text-emerald-600"
                >
                  <Copy size={14} />
                </button>
              </div>
              <button
                type="button"
                onClick={() => router.push(bookUrl())}
                className="mt-2.5 min-h-10 w-full rounded-[10px] bg-emerald-600 text-[12px] font-semibold text-white transition hover:bg-emerald-700 sm:mt-3 sm:h-10 sm:text-[13px]"
              >
                Book Now
              </button>
            </motion.article>
          ))}
        </div>
      </motion.section>

      <motion.section
        initial={reduce ? false : { opacity: 0, x: 30 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className={cn(walletPanelShell, walletPanelPad)}
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-[15px] font-bold text-content sm:text-base">
            Spending Insights
          </h3>
          <Select
            size="sm"
            options={[...SPEND_PERIOD_OPTIONS]}
            value={spendPeriod}
            onChange={(v) => {
              const next = typeof v === "string" ? v : v[0];
              if (next) setSpendPeriod(next);
            }}
            className="w-auto max-w-[9.5rem] shrink-0"
            triggerClassName="border-none bg-transparent font-medium text-emerald-600 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            ariaLabel="Spending period"
          />
        </div>
        <p
          className="mt-3 font-display font-bold leading-none text-content sm:mt-4"
          style={{ fontSize: "clamp(1.375rem, 5vw, 2rem)" }}
        >
          ₹{totalSpend.toLocaleString("en-IN")}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] font-semibold text-success sm:text-xs">
          <TrendingUp size={13} className="shrink-0" />
          {paymentsLoading ? "Calculating trends…" : `${WALLET_SPEND_CHANGE_PCT}% compared to last month`}
        </p>
        <Sparkline />
      </motion.section>
    </aside>
  );
}
