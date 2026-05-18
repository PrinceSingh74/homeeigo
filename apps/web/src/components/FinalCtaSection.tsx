"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";

export function FinalCtaSection() {
  const reduce = useReducedMotion();

  return (
    <section className="mx-auto mt-16 mb-8 max-w-content px-5 sm:px-8">
      <motion.div
        initial={{ opacity: 0, y: 32 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex items-center justify-between gap-6 overflow-hidden rounded-3xl p-8 shadow-e3 sm:p-10"
        style={{
          background:
            "linear-gradient(135deg, #EDE9FE 0%, #F5F3FF 50%, #FCE7F3 100%)",
        }}
      >
        <div className="relative z-10 max-w-xl">
          <h2 className="font-display text-2xl font-bold text-ink sm:text-4xl">
            Ready to experience the future?
          </h2>
          <p className="mt-2 text-sm text-slate sm:text-base">
            Book premium AI-powered home services instantly.
          </p>
          <motion.button
            type="button"
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.98 }}
            className="mt-6 inline-flex h-12 items-center gap-2 rounded-xl bg-aurora px-7 text-[15px] font-bold text-white shadow-glow-blue outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            Get Started
            <ArrowRight size={16} />
          </motion.button>
        </div>

        {/* 3D robot mascot */}
        <div className="relative hidden shrink-0 sm:block">
          <motion.div
            animate={reduce ? undefined : { rotate: [0, 360] }}
            transition={{ duration: 14, repeat: Infinity, ease: "linear" }}
            className="absolute inset-0 grid place-items-center"
          >
            <span className="size-32 rounded-full border-2 border-dashed border-violet/35" />
          </motion.div>
          <motion.img
            src="/robot-3d.png"
            alt="HOMIGO AI assistant"
            animate={reduce ? undefined : { y: [0, -8, 0] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            className="relative size-28 object-contain drop-shadow-2xl"
          />
        </div>
      </motion.div>
    </section>
  );
}
