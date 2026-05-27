"use client";

import { useState } from "react";
import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { Coins, Crown, Eye, EyeOff, Gift, Plus, Send, TrendingUp } from "lucide-react";
import {
  walletBalanceGrid,
  walletBalanceHero,
  walletSummaryCard,
} from "@/components/wallet/wallet-page-layout";
import {
  WALLET_ADDED_THIS_MONTH,
  WALLET_GIFT_CARD_COUNT,
  WALLET_GIFT_CARD_VALUE,
  WALLET_H_COINS,
  WALLET_TOTAL_BALANCE,
} from "@/lib/wallet-dashboard";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

export function WalletBalanceSection() {
  const reduce = useReducedMotion();
  const showToast = useAppStore((s) => s.showToast);
  const openOverlay = useAppStore((s) => s.openOverlay);
  const isPremium = useAppStore((s) => s.isPremium);
  const [hidden, setHidden] = useState(false);

  return (
    <div className={walletBalanceGrid}>
      <motion.section
        initial={reduce ? false : { opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1, ease: [0.34, 1.56, 0.64, 1] }}
        className={cn(
          walletBalanceHero,
          "bg-gradient-to-br from-violet via-[#C026D3] to-pink text-white shadow-[0_12px_40px_rgb(124_58_237/0.28)] sm:shadow-[0_16px_48px_rgb(124_58_237/0.3)] xl:min-h-[280px]",
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-pulse bg-gradient-to-br from-white/5 to-transparent opacity-60"
          style={{ animationDuration: "6s" }}
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="flex min-w-0 flex-1 flex-col justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium tracking-wide text-white/90 sm:text-xs">
                  Total Balance
                </span>
                <button
                  type="button"
                  aria-label={hidden ? "Show balance" : "Hide balance"}
                  onClick={() => setHidden((v) => !v)}
                  className="opacity-80 transition hover:opacity-100"
                >
                  {hidden ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <p
                className="mt-1.5 font-display font-bold leading-none tracking-tight"
                style={{ fontSize: "clamp(1.5rem, 7vw, 3.25rem)" }}
              >
                {hidden
                  ? "₹ ••••••"
                  : `₹${WALLET_TOTAL_BALANCE.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
              </p>
              <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-white/80 sm:text-sm">
                <TrendingUp size={13} className="shrink-0 text-success" strokeWidth={2.5} />
                <span>₹{WALLET_ADDED_THIS_MONTH.toLocaleString("en-IN")} added this month</span>
              </p>
            </div>
            <div className="flex flex-col gap-2 min-[400px]:flex-row min-[400px]:flex-wrap sm:gap-3">
              <button
                type="button"
                onClick={() => showToast("Add money — UPI & cards coming soon", "info")}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-[13px] font-semibold text-violet shadow-[0_4px_12px_rgb(0_0_0/0.15)] transition hover:-translate-y-0.5 active:scale-[0.98] min-[400px]:w-auto sm:px-5 sm:text-sm"
              >
                <Plus size={16} />
                Add Money
              </button>
              <button
                type="button"
                onClick={() => showToast("Send money — coming soon", "info")}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-white/40 bg-white/20 px-4 text-[13px] font-semibold text-white backdrop-blur-md transition hover:bg-white/30 min-[400px]:w-auto sm:px-5 sm:text-sm"
              >
                <Send size={16} />
                Send Money
              </button>
            </div>
          </div>
          <motion.div
            animate={reduce ? undefined : { y: [0, -4, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            className="relative mx-auto shrink-0 sm:mx-0"
          >
            <Image
              src="/wallet-3d.png"
              alt=""
              width={200}
              height={200}
              className="size-24 object-contain drop-shadow-[0_16px_32px_rgb(255_215_0/0.2)] min-[400px]:size-32 sm:size-40 lg:size-[200px]"
              priority
            />
          </motion.div>
        </div>
      </motion.section>

      <SummaryMiniCard
        icon={Coins}
        label="H-Coins"
        value={String(WALLET_H_COINS)}
        iconBg="#FFFBEB"
        iconColor="#D4AF37"
        delay={0.15}
      />
      <SummaryMiniCard
        icon={Gift}
        label="Gift Cards"
        value={`₹${WALLET_GIFT_CARD_VALUE.toLocaleString("en-IN")}`}
        sub={`${WALLET_GIFT_CARD_COUNT} Gift Cards available`}
        iconBg="#F5F3FF"
        iconColor="#7C3AED"
        delay={0.2}
      />
      <SummaryMiniCard
        icon={Crown}
        label="HOMIGO Premium"
        value={isPremium ? "Active" : "Trial"}
        sub={isPremium ? "Renews Jun 2026" : "Upgrade for cashback"}
        iconBg="#EFF6FF"
        iconColor="#2563EB"
        delay={0.25}
        onClick={() => openOverlay("premium")}
      />
    </div>
  );
}

function SummaryMiniCard({
  icon: Icon,
  label,
  value,
  sub,
  iconBg,
  iconColor,
  delay,
  onClick,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  sub?: string;
  iconBg: string;
  iconColor: string;
  delay: number;
  onClick?: () => void;
}) {
  const reduce = useReducedMotion();
  const className = cn(
    "wallet-panel flex h-full min-h-[100px] w-full min-w-0 flex-col justify-between gap-3 p-4 text-left transition sm:min-h-[120px] sm:p-5",
    "hover:border-primary/30 hover:shadow-[0_8px_20px_rgb(37_99_235/0.08)] dark:hover:shadow-[0_8px_20px_rgb(37_99_235/0.2)]",
  );

  const body = (
    <>
      <span
        className="grid size-10 place-items-center rounded-xl sm:size-11"
        style={{ backgroundColor: iconBg, color: iconColor }}
      >
        <Icon size={20} className="sm:hidden" />
        <Icon size={22} className="hidden sm:block" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-muted sm:text-xs">{label}</p>
        <p className="font-display text-xl font-bold text-content sm:text-2xl">{value}</p>
        {sub && <p className="mt-0.5 line-clamp-2 text-[10px] text-muted sm:text-xs">{sub}</p>}
      </div>
    </>
  );

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, delay }}
      className={walletSummaryCard}
    >
      {onClick ? (
        <button type="button" onClick={onClick} className={className}>
          {body}
        </button>
      ) : (
        <div className={className}>{body}</div>
      )}
    </motion.div>
  );
}
