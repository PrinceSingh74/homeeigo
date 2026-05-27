"use client";

import { Star, ArrowRight, Check } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppStore } from "@/stores/app-store";

const BENEFITS = [
  "Priority booking & elite professionals",
  "24/7 premium support",
  "Free revisits on eligible services",
  "AI-optimized scheduling & pricing",
];

export function PremiumModal({ open }: { open: boolean }) {
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const setPremium = useAppStore((s) => s.setPremium);

  return (
    <Modal open={open} onClose={closeOverlay} title="HOMIGO Premium" size="md">
      <div className="relative overflow-hidden rounded-2xl bg-premium p-6 text-white">
        <p className="font-display text-2xl font-bold">₹499 / month</p>
        <p className="mt-1 text-sm text-white/80">
          7-day free trial · Cancel anytime
        </p>
        <div className="mt-2 flex items-center gap-1 text-sm">
          <Star size={14} className="fill-gold text-gold" />
          Loved by 12,000+ members
        </div>
      </div>

      <ul className="mt-6 flex flex-col gap-3">
        {BENEFITS.map((b) => (
          <li key={b} className="flex items-center gap-2 text-sm text-content">
            <Check size={16} className="text-success" strokeWidth={3} />
            {b}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => {
          setPremium(true);
          closeOverlay();
        }}
        className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-aurora text-base font-bold text-white shadow-glow-blue"
      >
        Start free trial
        <ArrowRight size={18} />
      </button>
    </Modal>
  );
}
