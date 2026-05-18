"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Check, MapPin, Navigation } from "lucide-react";

const STEPS = [
  { label: "Confirmed", done: true },
  { label: "On the Way", done: true },
  { label: "Arrived", done: false },
];

export function LiveTrackingSection() {
  const reduce = useReducedMotion();

  return (
    <section className="mx-auto mt-24 max-w-content px-5 sm:px-8">
      <motion.h2
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.45 }}
        className="mb-10 font-display text-3xl font-bold text-content sm:text-4xl lg:text-5xl"
      >
        Live Tracking
      </motion.h2>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* MAP card */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="relative h-72 overflow-hidden rounded-[32px] shadow-e4 lg:h-80"
          style={{
            background:
              "linear-gradient(135deg, #0B1020 0%, #1E1B4B 55%, #312E81 100%)",
          }}
        >
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 400 224"
            preserveAspectRatio="none"
            aria-hidden
          >
            <defs>
              <linearGradient id="route" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#06B6D4" />
                <stop offset="0.5" stopColor="#3B82F6" />
                <stop offset="1" stopColor="#A855F7" />
              </linearGradient>
            </defs>
            <path
              d="M 70 165 C 120 110, 170 200, 230 120 S 320 70, 350 60"
              stroke="#3B82F6"
              strokeWidth="11"
              strokeLinecap="round"
              fill="none"
              opacity="0.18"
            />
            <path
              d="M 70 165 C 120 110, 170 200, 230 120 S 320 70, 350 60"
              stroke="url(#route)"
              strokeWidth="4"
              strokeLinecap="round"
              fill="none"
            />
            <circle cx="230" cy="120" r="4" fill="#fff" />
          </svg>

          {/* destination pin */}
          <span className="absolute right-12 top-10 grid size-7 place-items-center rounded-full border border-cyan/60 bg-cyan/20">
            <MapPin size={14} className="fill-cyan text-white" />
          </span>

          {/* rider */}
          <div className="absolute left-12 top-1/2 -translate-y-1/2">
            <motion.span
              aria-hidden
              animate={reduce ? undefined : { scale: [0.7, 1.6], opacity: [0.5, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
              className="absolute inset-0 rounded-full bg-cyan/40"
            />
            <span className="relative grid size-14 place-items-center rounded-full bg-gradient-to-br from-cyan to-violet p-0.5">
              <img
                src="https://api.dicebear.com/7.x/avataaars/png?seed=rajesh&size=64"
                alt="Rider"
                className="size-12 rounded-full border-2 border-[#1E1B4B] bg-[#1E1B4B]"
              />
            </span>
          </div>

          <span className="absolute bottom-4 right-4 grid size-8 place-items-center rounded-lg bg-violet/80 text-white">
            <Navigation size={13} className="fill-white" />
          </span>
        </motion.div>

        {/* STATUS card */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="flex h-72 flex-col justify-between rounded-[32px] p-8 text-white shadow-e4 lg:h-80"
          style={{
            background: "linear-gradient(135deg, #1E1B4B 0%, #312E81 100%)",
          }}
        >
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-success" />
            <span className="text-base font-semibold text-white/70">
              Service in Progress
            </span>
          </div>

          <div>
            <p className="text-xl font-semibold text-white">Arriving in</p>
            <p className="font-display text-6xl font-bold text-cyan">12 mins</p>
            <p className="mt-2 text-base text-white/60">
              Your expert is on the way
            </p>
          </div>

          <div className="flex items-center">
            {STEPS.map((s, i) => (
              <div key={s.label} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center gap-1.5">
                  <span
                    className={
                      s.done
                        ? "grid size-6 place-items-center rounded-full bg-cyan"
                        : "size-6 rounded-full border-2 border-white/30"
                    }
                  >
                    {s.done && <Check size={13} strokeWidth={3} />}
                  </span>
                  <span
                    className="text-[11px] font-bold"
                    style={{ opacity: s.done ? 1 : 0.45 }}
                  >
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <span
                    className="mx-2 mb-5 h-0.5 flex-1 rounded-full"
                    style={{
                      background: STEPS[i + 1].done
                        ? "#06B6D4"
                        : "rgba(255,255,255,0.15)",
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
