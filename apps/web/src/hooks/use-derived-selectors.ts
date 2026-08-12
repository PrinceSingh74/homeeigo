"use client";

import { useMemo } from "react";
import { ShieldCheck, RefreshCw, CreditCard, Headphones } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import {
  useAddressesQuery,
  useBookingsQuery,
  usePaymentsHistoryQuery,
  useWalletBalanceQuery,
  useWalletTransactionsQuery,
} from "@/hooks/use-core-data";
import { useEntitlements } from "@/hooks/use-entitlements";
import { useReferralSummary } from "@/hooks/use-referrals";

export function useProfileDerived() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const { data: bookingsData } = useBookingsQuery();
  const { data: walletData } = useWalletBalanceQuery();
  const { data: addressesData } = useAddressesQuery();
  const { data: entitlements } = useEntitlements(isAuthenticated);
  const { data: referralSummary } = useReferralSummary(isAuthenticated);
  const addressCount = addressesData?.addresses?.length ?? 0;

  const profileUser = useMemo(() => {
    // Real profile completion: share of the key fields the user has actually filled.
    const fields = [user?.firstName, user?.lastName, user?.email, user?.phoneNumber, user?.profileImage];
    const filled = fields.filter(Boolean).length;
    return {
      name: `${user?.firstName ?? "HOMEEIGO"} ${user?.lastName ?? "User"}`.trim(),
      email: user?.email ?? "user@homigo.app",
      status: user ? "Member" : "Guest",
      location: "India",
      memberSince: user?.createdAt
        ? new Date(user.createdAt).toLocaleDateString("en-IN", { month: "short", year: "numeric" })
        : "Recently",
      avatar:
        user?.profileImage ||
        "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=240&h=240&fit=crop&q=80",
      profileCompletion: user ? Math.round((filled / fields.length) * 100) : 0,
      // Live membership from backend entitlements (/api/subscriptions/entitlements).
      membership: entitlements?.hasMembership
        ? (entitlements.planName ?? entitlements.tier ?? "Premium")
        : null,
      membershipExpiresAt: entitlements?.expiresAt ?? null,
      referralCode: user?.referralCode ?? null,
      referralCount: user?.referralCount ?? 0,
    };
  }, [user, entitlements]);

  const quickStats = useMemo(() => {
    const activeBookings = (bookingsData?.bookings ?? []).filter((b) =>
      ["pending", "accepted", "in_progress"].includes(b.status),
    ).length;
    return [
      {
        id: "wallet",
        label: "Wallet Balance",
        value: `₹${(walletData?.balance ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`,
        link: "View Wallet",
        href: "/wallet",
        gradient: "from-emerald-500 to-teal-600",
      },
      {
        id: "bookings",
        label: "Active Bookings",
        value: `${activeBookings}`,
        link: "View Bookings",
        href: "/bookings",
        gradient: "from-emerald-500 to-teal-500",
      },
      {
        id: "addresses",
        label: "Saved Addresses",
        value: `${addressCount}`,
        link: "Manage",
        action: "location" as const,
        gradient: "from-amber-500 to-orange-500",
      },
      {
        id: "referral",
        // Live referral earnings from /api/referrals/me.
        label: "Referral Earnings",
        value: `₹${(referralSummary?.totalEarned ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`,
        link: "Invite & Earn",
        action: "refer" as const,
        gradient: "from-teal-500 to-emerald-600",
        notify: (referralSummary?.balance ?? 0) > 0,
      },
    ];
  }, [bookingsData?.bookings, walletData?.balance, addressCount, referralSummary]);

  const insights = useMemo(() => {
    const completed = (bookingsData?.bookings ?? []).filter((b) => b.status === "completed").length;
    return [
      {
        id: "booking-health",
        title: completed > 0 ? "Great service history detected" : "Complete your first booking",
        description:
          completed > 0
            ? `${completed} completed bookings in your account`
            : "Book one service to unlock personalized recommendations",
        icon: "snowflake",
        bg: "bg-emerald-50 dark:bg-emerald-500/10",
        border: "border-emerald-200 dark:border-emerald-500/20",
        iconBg: "bg-emerald-600",
      },
      {
        id: "wallet-health",
        title: "Wallet insights updated",
        description: "Balance and transaction trends are now synced with backend",
        icon: "chef",
        bg: "bg-[#FEF3C7] dark:bg-amber-500/10",
        border: "border-[#FCD34D] dark:border-amber-500/30",
        iconBg: "bg-amber-500",
      },
      {
        id: "savings",
        title: "Track spending with live analytics",
        description: "Use wallet charts to monitor payment trends in real-time",
        icon: "trending",
        bg: "bg-[#D1FAE5] dark:bg-emerald-500/10",
        border: "border-[#A7F3D0] dark:border-emerald-500/30",
        iconBg: "bg-success",
      },
    ];
  }, [bookingsData?.bookings]);

  return { profileUser, quickStats, insights };
}

export function useWalletDerived() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const { data: balanceData } = useWalletBalanceQuery();
  const { data: txData } = useWalletTransactionsQuery();
  const { data: paymentsData } = usePaymentsHistoryQuery();
  const { data: entitlements } = useEntitlements(isAuthenticated);

  const totalBalance = balanceData?.balance ?? 0;
  const tx = txData?.transactions ?? [];
  const credits = tx.filter((t) => t.type === "credit").reduce((sum, t) => sum + t.amount, 0);
  const debits = tx.filter((t) => t.type === "debit").reduce((sum, t) => sum + t.amount, 0);

  const walletBreakdown = useMemo(() => {
    const total = Math.max(1, credits + debits);
    const walletPct = Math.round((totalBalance / total) * 100);
    const creditPct = Math.round((credits / total) * 100);
    const debitPct = Math.max(0, 100 - walletPct - creditPct);
    return [
      { label: "Wallet Balance", value: totalBalance, color: "#10b981", pct: Math.max(0, walletPct) },
      { label: "Credits", value: credits, color: "#14b8a6", pct: Math.max(0, creditPct) },
      { label: "Debits", value: debits, color: "#F59E0B", pct: Math.max(0, debitPct) },
    ];
  }, [credits, debits, totalBalance]);

  const invoices = useMemo(
    () =>
      (paymentsData?.payments ?? []).slice(0, 8).map((p, i) => ({
        id: String((p.id as string | undefined) ?? `INV-${i + 1}`),
        amount: Number((p.amount as number | undefined) ?? 0),
        date: p.completedAt
          ? new Date(p.completedAt as string).toLocaleDateString("en-IN")
          : new Date().toLocaleDateString("en-IN"),
        status: ((p.status as string | undefined) === "success" ? "paid" : "pending") as "paid" | "pending",
      })),
    [paymentsData?.payments],
  );

  const paymentMethods = useMemo(() => {
    const methodMap = new Map<string, { id: string; type: "card" | "upi" | "bank"; label: string; detail: string; primary?: boolean }>();
    for (const p of paymentsData?.payments ?? []) {
      const method = String((p.paymentMethod as string | undefined) ?? "card").toLowerCase();
      const type = method.includes("upi") ? "upi" : method.includes("bank") ? "bank" : "card";
      if (!methodMap.has(method)) {
        methodMap.set(method, {
          id: method,
          type,
          label: method.toUpperCase(),
          detail: "Used recently",
          primary: methodMap.size === 0,
        });
      }
    }
    return [...methodMap.values()];
  }, [paymentsData?.payments]);

  const walletUser = useMemo(
    () => ({
      name: `${user?.firstName ?? "HOMEEIGO"} ${user?.lastName ?? "User"}`.trim(),
      status: entitlements?.hasMembership
        ? `${entitlements.planName ?? "Premium"} Member`
        : "Member",
      avatar:
        user?.profileImage ||
        "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&q=80",
    }),
    [user, entitlements],
  );

  const trustCards = [
    { icon: ShieldCheck, title: "Safe & Secure", text: "Protected session & token refresh", bg: "#ECFDF5", color: "#10B981" },
    { icon: RefreshCw, title: "Realtime Sync", text: "Bookings and notifications auto-update", bg: "#ECFDF5", color: "#059669" },
    { icon: CreditCard, title: "Payment History", text: `${paymentsData?.total ?? paymentsData?.payments?.length ?? 0} transactions linked`, bg: "#F0FDFA", color: "#0d9488" },
    { icon: Headphones, title: "24/7 Support", text: "In-app support available anytime", bg: "#FFF7ED", color: "#F59E0B" },
  ];

  return {
    totalBalance,
    walletBreakdown,
    invoices,
    paymentMethods,
    walletUser,
    trustCards,
  };
}
