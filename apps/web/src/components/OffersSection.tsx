"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AirVent,
  Sparkles,
  Wrench,
  ArrowRight,
  Copy,
  Check,
  type LucideIcon,
} from "lucide-react";

interface Offer {
  icon: LucideIcon;
  discount: string;
  desc: string;
  code: string;
  from: string;
  to: string;
  fg: string;
}

const OFFERS: Offer[] = [
  {
    icon: AirVent,
    discount: "Flat ₹100 OFF",
    desc: "On AC Service",
    code: "COOL100",
    from: "#DBEAFE",
    to: "#BAE6FD",
    fg: "#0C3B66",
  },
  {
    icon: Sparkles,
    discount: "25% OFF",
    desc: "On Deep Cleaning",
    code: "FRESH25",
    from: "#FCE7F3",
    to: "#FBCFE8",
    fg: "#9D2463",
  },
  {
    icon: Wrench,
    discount: "Flat ₹150 OFF",
    desc: "On Plumbing",
    code: "FIX150",
    from: "#D1FAE5",
    to: "#A7F3D0",
    fg: "#047857",
  },
];

export function OffersSection() {
  const [copied, setCopied] = useState<string | null>(null);
  const [toast, setToast] = useState(false);

  async function copy(code: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        // Fallback for non-secure contexts (e.g. http:// over LAN)
        const ta = document.createElement("textarea");
        ta.value = code;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
    } catch {
      /* clipboard blocked — still show feedback */
    }
    setCopied(code);
    setToast(true);
    setTimeout(() => setToast(false), 2500);
    setTimeout(() => setCopied(null), 2500);
  }

  return (
    <section className="mx-auto mt-24 max-w-content px-5 sm:px-8">
      <div className="mb-10 flex items-center justify-between">
        <h2 className="font-display text-3xl font-bold text-content sm:text-4xl lg:text-5xl">
          Offers&nbsp;&amp;&nbsp;Deals
        </h2>
        <button
          type="button"
          className="group inline-flex items-center gap-1 text-sm font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-md"
        >
          View All
          <ArrowRight
            size={16}
            className="transition-transform group-hover:translate-x-1"
          />
        </button>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {OFFERS.map((o, i) => {
          const Icon = o.icon;
          const isCopied = copied === o.code;
          return (
            <motion.div
              key={o.code}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: i * 0.08 }}
              whileHover={{ y: -8 }}
              className="group relative flex min-h-52 flex-col justify-between overflow-hidden rounded-[28px] p-7 shadow-[0_18px_44px_-14px_rgb(15_23_42/0.28)] ring-1 ring-white/50 transition-shadow duration-300 hover:shadow-[0_28px_60px_-12px_rgb(15_23_42/0.34)]"
              style={{
                background: `linear-gradient(135deg, ${o.from} 0%, ${o.to} 100%)`,
                color: o.fg,
              }}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-1/2 sheen"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-white/40 blur-2xl transition-opacity duration-500 group-hover:opacity-80"
              />
              <span
                className="relative grid size-14 place-items-center rounded-2xl bg-white/70 ring-1 ring-white/60"
                style={{
                  boxShadow: "inset 0 2px 4px rgb(255 255 255 / 0.8)",
                }}
              >
                <Icon size={28} />
              </span>
              <div className="relative">
                <p className="font-display text-2xl font-bold">{o.discount}</p>
                <p className="text-sm opacity-75">{o.desc}</p>
              </div>
              <button
                type="button"
                onClick={() => copy(o.code)}
                className="relative mt-2 inline-flex w-fit items-center gap-2 rounded-full bg-white/65 px-4 py-2 font-mono text-xs font-semibold uppercase outline-none ring-1 ring-white/60 transition hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-current"
                aria-label={`Copy code ${o.code}`}
              >
                {isCopied ? <Check size={14} /> : <Copy size={14} />}
                {isCopied ? "Copied!" : `Use code: ${o.code}`}
              </button>
            </motion.div>
          );
        })}
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ type: "spring", damping: 15 }}
            role="status"
            className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white shadow-e5 lg:bottom-8"
          >
            ✓ Promo code copied to clipboard
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
