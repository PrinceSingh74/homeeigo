"use client";

import { motion } from "framer-motion";
import { Search, Cpu, MapPin, Star, ArrowRight } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ButtonLink } from "@/components/buttons/ButtonLink";
import { useAppStore } from "@/stores/app-store";
import { bookUrl } from "@/lib/booking-url";

const STEPS = [
  {
    icon: Search,
    title: "Search & pick a service",
    desc: "Choose from cleaning, AC, plumbing & more — or ask our AI assistant.",
  },
  {
    icon: Cpu,
    title: "AI matches your pro",
    desc: "Verified, background-checked experts matched to your home & schedule.",
  },
  {
    icon: MapPin,
    title: "Track in real time",
    desc: "Uber-style live map — know exactly when your pro arrives.",
  },
  {
    icon: Star,
    title: "Pay securely & rate",
    desc: "UPI, cards & wallet. Satisfaction guaranteed on every job.",
  },
];

export function HowItWorksModal({ open }: { open: boolean }) {
  const closeOverlay = useAppStore((s) => s.closeOverlay);

  return (
    <Modal open={open} onClose={closeOverlay} title="How HOMIGO works" size="lg">
      <p className="mb-6 text-sm text-muted">
        Book premium home services in under 60 seconds — smart, fast, and
        reliable.
      </p>
      <ol className="grid gap-4 sm:grid-cols-2">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <motion.li
              key={s.title}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className="flex gap-4 rounded-2xl glass-card p-5"
            >
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-aurora text-white">
                <Icon size={22} />
              </span>
              <span>
                <span className="text-xs font-bold uppercase tracking-wider text-primary">
                  Step {i + 1}
                </span>
                <p className="mt-1 font-display text-lg font-bold text-content">
                  {s.title}
                </p>
                <p className="mt-1 text-sm text-muted">{s.desc}</p>
              </span>
            </motion.li>
          );
        })}
      </ol>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <ButtonLink
          href={bookUrl()}
          variant="primary"
          fullWidth
          onClick={closeOverlay}
          className="flex-1"
        >
          Book a Service
          <ArrowRight size={18} />
        </ButtonLink>
        <button
          type="button"
          onClick={closeOverlay}
          className="h-14 rounded-xl px-6 text-sm font-semibold text-muted hover:bg-primary/5"
        >
          Close
        </button>
      </div>
    </Modal>
  );
}
