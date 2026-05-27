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
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppStore } from "@/stores/app-store";
export function ProfileMenu({ open }: { open: boolean }) {
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const openOverlay = useAppStore((s) => s.openOverlay);
  const showToast = useAppStore((s) => s.showToast);
  const router = useRouter();

  const items = [
    {
      icon: CalendarDays,
      label: "My Bookings",
      desc: "View & manage appointments",
      onClick: () => {
        closeOverlay();
        router.push("/bookings");
      },
    },
    {
      icon: Wallet,
      label: "HOMIGO Wallet",
      desc: "₹2,450.00 balance",
      onClick: () => {
        closeOverlay();
        router.push("/wallet");
      },
    },
    {
      icon: Crown,
      label: "HOMIGO Premium",
      desc: "Upgrade for elite benefits",
      onClick: () => openOverlay("premium"),
    },
    {
      icon: User,
      label: "Full Profile",
      desc: "Dashboard, addresses & rewards",
      onClick: () => {
        closeOverlay();
        router.push("/profile");
      },
    },
    {
      icon: Settings,
      label: "Settings",
      desc: "Account & preferences",
      onClick: () => openOverlay("settings"),
    },
  ];

  return (
    <Modal open={open} onClose={closeOverlay} title="Your profile" size="sm">
      <div className="mb-5 flex items-center gap-4 rounded-2xl bg-premium p-4 text-white">
        <span className="grid size-14 place-items-center rounded-full bg-white/20 text-xl font-bold">
          A
        </span>
        <div>
          <p className="font-display text-lg font-bold">Arjun Sharma</p>
          <p className="text-sm text-white/80">arjun@homigo.app · Premium trial</p>
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

      <button
        type="button"
        onClick={() => {
          closeOverlay();
          showToast("Signed out successfully", "success");
        }}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-line py-3 text-sm font-semibold text-muted hover:text-content"
      >
        <LogOut size={16} />
        Sign out
      </button>

      <p className="mt-4 text-center text-xs text-muted">
        <Link href="/" onClick={closeOverlay} className="text-primary hover:underline">
          Back to home
        </Link>
      </p>
    </Modal>
  );
}
