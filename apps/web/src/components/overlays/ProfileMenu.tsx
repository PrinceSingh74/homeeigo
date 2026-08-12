"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Wallet,
  Settings,
  LogOut,
  Crown,
  ChevronRight,
  User,
  Gift,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useWalletBalanceQuery } from "@/hooks/use-core-data";
import { useEntitlements } from "@/hooks/use-entitlements";
import { useAppStore } from "@/stores/app-store";
import { useAuthStore } from "@/stores/auth-store";

export function ProfileMenu({ open }: { open: boolean }) {
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const showToast = useAppStore((s) => s.showToast);
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const logout = useAuthStore((s) => s.logout);
  const { data: walletData } = useWalletBalanceQuery();
  const { data: entitlements } = useEntitlements(isAuthenticated);

  const fullName = user ? `${user.firstName} ${user.lastName ?? ""}`.trim() : "Guest";
  const initial = (user?.firstName?.[0] ?? "G").toUpperCase();
  const balance = walletData?.balance ?? 0;

  const go = (path: string) => {
    closeOverlay();
    router.push(path);
  };

  const items = [
    {
      icon: CalendarDays,
      label: "My Bookings",
      desc: "View & manage appointments",
      onClick: () => go("/bookings"),
    },
    {
      icon: Wallet,
      label: "HOMEEIGO Wallet",
      desc: `₹${balance.toLocaleString("en-IN", { maximumFractionDigits: 2 })} balance`,
      onClick: () => go("/wallet"),
    },
    {
      icon: Crown,
      label: "HOMEEIGO Premium",
      desc: entitlements?.hasMembership
        ? `${entitlements.planName ?? "Premium"} active`
        : "Upgrade for elite benefits",
      onClick: () => go("/membership"),
    },
    {
      icon: Gift,
      label: "Refer & Earn",
      desc: "Invite friends, earn wallet cash",
      onClick: () => go("/referrals"),
    },
    {
      icon: User,
      label: "Full Profile",
      desc: "Dashboard, addresses & rewards",
      onClick: () => go("/profile"),
    },
    {
      icon: Settings,
      label: "Settings",
      desc: "Account & preferences",
      onClick: () => go("/settings"),
    },
  ];

  return (
    <Modal open={open} onClose={closeOverlay} title="Your profile" size="sm">
      <div className="mb-5 flex items-center gap-4 rounded-2xl bg-premium p-4 text-white">
        <span className="grid size-14 place-items-center rounded-full bg-white/20 text-xl font-bold">
          {initial}
        </span>
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-bold">{fullName}</p>
          <p className="truncate text-sm text-white/80">
            {user?.email ?? "Sign in to sync your account"}
            {entitlements?.hasMembership ? " · Premium" : ""}
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <li key={it.label}>
              <button
                type="button"
                onClick={it.onClick}
                className="flex w-full items-center gap-3 rounded-2xl glass-card px-4 py-3.5 text-left transition hover:bg-primary/5"
              >
                <Icon size={20} className="text-primary" />
                <span className="flex-1">
                  <span className="block text-sm font-bold text-content">
                    {it.label}
                  </span>
                  <span className="block text-xs text-muted">{it.desc}</span>
                </span>
                <ChevronRight size={18} className="text-muted" />
              </button>
            </li>
          );
        })}
      </ul>

      {isAuthenticated ? (
        <button
          type="button"
          onClick={() => {
            closeOverlay();
            void logout().then(() => {
              showToast("Signed out successfully", "success");
              router.replace("/login");
            });
          }}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-line py-3 text-sm font-semibold text-muted hover:text-content"
        >
          <LogOut size={16} />
          Sign out
        </button>
      ) : (
        <Link
          href="/login"
          onClick={closeOverlay}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-bold text-white"
        >
          Sign in
        </Link>
      )}

      <p className="mt-4 text-center text-xs text-muted">
        <Link href="/" onClick={closeOverlay} className="text-primary hover:underline">
          Back to home
        </Link>
      </p>
    </Modal>
  );
}
