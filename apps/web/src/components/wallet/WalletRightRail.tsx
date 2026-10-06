"use client";

import { m as motion, useReducedMotion } from "framer-motion";
import { Copy, Sparkles } from "lucide-react";
import { walletPanelPad, walletPanelShell } from "@/components/wallet/wallet-page-layout";
import { usePaymentsHistoryQuery } from "@/hooks/use-core-data";
import { coreApi } from "@/services/core/api";
import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "@/stores/app-store";
import { bookUrl } from "@/lib/booking-url";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { walletOffersFromServer } from "@/lib/wallet-offers";
import {
  CLIPBOARD_UNAVAILABLE_TOAST,
  copyToClipboard,
} from "@/lib/clipboard";

/**
 * Offers and payments beside the wallet — the server's, or nothing.
 *
 * Removed: the demo offers shown until the request answered, the invented titles and promo codes
 * that filled gaps in a server offer, the month-on-month trend line (a constant), the
 * sparkline (a constant series) and the period selector (it changed nothing: the figure is the sum
 * of the payments the history endpoint returned, and is now labelled as that).
 */
export function WalletRightRail() {
  const reduce = useReducedMotion();
  const showToast = useAppStore((s) => s.showToast);
  const router = useRouter();
  const { data: paymentsData, isLoading: paymentsLoading } = usePaymentsHistoryQuery();
  const { data: offersData } = useQuery({
    queryKey: ["wallet", "offers"],
    queryFn: () => coreApi.wallet.offers(),
    staleTime: 30_000,
  });
  const offers = walletOffersFromServer(offersData?.offers).slice(0, 3);
  const payments = paymentsData?.payments;
  const totalPaid = payments?.reduce((sum, p) => sum + Number((p.amount as number | undefined) ?? 0), 0) ?? null;

  return (
    <aside className="flex w-full min-w-0 flex-col gap-5 sm:gap-6 xl:sticky xl:top-[calc(var(--site-nav-offset,4rem)+1.5rem)] xl:self-start">
      {offers.length > 0 ? (
        <motion.section
          initial={reduce ? false : { opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className={cn(walletPanelShell, walletPanelPad)}
        >
          <h3 className="mb-4 font-display text-[15px] font-bold text-content sm:mb-5 sm:text-base">Offers</h3>
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
                  {offer.badge ? (
                    <span className="shrink-0 rounded-md bg-success px-1.5 py-0.5 text-[8px] font-bold uppercase text-white sm:px-2 sm:text-[9px]">
                      {offer.badge}
                    </span>
                  ) : null}
                </div>
                <p className="font-display text-[13px] font-bold leading-snug text-content sm:text-sm">
                  {offer.title}
                </p>
                {offer.description ? (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted sm:text-xs">
                    {offer.description}
                  </p>
                ) : null}
                {/* A code only when the server sent one. */}
                {offer.code ? (
                  <div className="mt-2.5 flex min-w-0 items-center justify-between gap-2 rounded-lg border border-dashed border-line bg-canvas px-2.5 py-2 dark:bg-charcoal/60 sm:mt-3 sm:px-3">
                    <code className="min-w-0 truncate font-mono text-[10px] font-semibold text-emerald-600 sm:text-[11px]">
                      {offer.code}
                    </code>
                    <button
                      type="button"
                      aria-label="Copy code"
                      onClick={async () => {
                        const ok = await copyToClipboard(offer.code!);
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
                ) : null}
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
      ) : null}

      <motion.section
        initial={reduce ? false : { opacity: 0, x: 30 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className={cn(walletPanelShell, walletPanelPad)}
      >
        <h3 className="font-display text-[15px] font-bold text-content sm:text-base">Payments</h3>
        <p
          className="mt-3 font-display font-bold leading-none text-content sm:mt-4"
          style={{ fontSize: "clamp(1.375rem, 5vw, 2rem)" }}
        >
          {totalPaid != null ? `₹${totalPaid.toLocaleString("en-IN")}` : "—"}
        </p>
        <p className="mt-1 text-[11px] text-muted sm:text-xs">
          {paymentsLoading
            ? "Loading your payments…"
            : payments
              ? `Total of your ${payments.length} most recent payment${payments.length === 1 ? "" : "s"}`
              : "Your payments could not be loaded"}
        </p>
      </motion.section>
    </aside>
  );
}
