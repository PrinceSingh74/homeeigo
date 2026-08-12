"use client";

import { useEffect, useState } from "react";
import { m as motion } from "framer-motion";
import { useReducedMotion } from "framer-motion";

export function ServicesPageBackdrop() {
  const reduce = useReducedMotion();
  // Defer the 4 infinite mesh-orb animations until AFTER first paint/idle so they never compete
  // with the route's content render (Phase 6: animation runs after content is visible). The static
  // gradient backdrop still paints immediately; only the perpetual motion is delayed.
  const [animateOrbs, setAnimateOrbs] = useState(false);
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    const id = w.requestIdleCallback
      ? w.requestIdleCallback(() => setAnimateOrbs(true))
      : window.setTimeout(() => setAnimateOrbs(true), 200);
    return () => {
      const wc = window as Window & { cancelIdleCallback?: (id: number) => void };
      if (wc.cancelIdleCallback) wc.cancelIdleCallback(id as number);
      else clearTimeout(id as number);
    };
  }, []);
  const motionOn = !reduce && animateOrbs;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 min-h-[180vh] overflow-hidden"
      aria-hidden
    >
      <div className="absolute inset-0 bg-gradient-to-b from-sky-50/40 via-transparent to-violet-50/20 dark:from-slate-900/80 dark:to-transparent" />

      <motion.span
        className="svc-mesh-orb -left-[8%] top-[5%] size-[min(480px,55vw)] bg-violet-500/30"
        animate={motionOn ? { x: [0, 24, 0], y: [0, -16, 0], scale: [1, 1.06, 1] } : undefined}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.span
        className="svc-mesh-orb right-[-6%] top-[18%] size-[min(420px,50vw)] bg-sky-400/25"
        animate={motionOn ? { x: [0, -20, 0], y: [0, 20, 0], scale: [1, 1.04, 1] } : undefined}
        transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.span
        className="svc-mesh-orb left-[25%] top-[45%] size-[min(360px,42vw)] bg-primary/12"
        animate={motionOn ? { x: [0, 16, 0], y: [0, -12, 0] } : undefined}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.span
        className="svc-mesh-orb bottom-[8%] right-[10%] size-[min(300px,38vw)] bg-pink-400/18"
        animate={motionOn ? { scale: [1, 1.08, 1], opacity: [0.5, 0.7, 0.5] } : undefined}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      />

      <div
        className="absolute inset-0 opacity-[0.35] dark:opacity-[0.15]"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, rgb(37 99 235 / 0.15) 1px, transparent 0)`,
          backgroundSize: "32px 32px",
        }}
      />
    </div>
  );
}
