"use client";

import { motion, useReducedMotion } from "framer-motion";

export function AiPage3DBackdrop() {
  const reduce = useReducedMotion();

  return (
    <div
      className="ai-page-backdrop pointer-events-none fixed inset-x-0 bottom-0 top-0 z-0 overflow-hidden max-lg:top-0 lg:top-[var(--site-nav-offset)]"
      aria-hidden
    >
      <div className="ai-page-mesh" />
      <div className="ai-page-grid-floor" />

      {!reduce && (
        <>
          <motion.div
            className="ai-orb ai-orb-violet absolute -left-[12%] top-[8%] size-[min(55vw,520px)]"
            animate={{ x: [0, 40, 0], y: [0, 30, 0], scale: [1, 1.08, 1] }}
            transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="ai-orb ai-orb-cyan absolute -right-[8%] top-[18%] size-[min(48vw,440px)]"
            animate={{ x: [0, -35, 0], y: [0, 45, 0], scale: [1, 1.06, 1] }}
            transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="ai-orb ai-orb-pink absolute bottom-[12%] left-[20%] size-[min(42vw,380px)]"
            animate={{ x: [0, 25, 0], y: [0, -20, 0], scale: [1, 1.1, 1] }}
            transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="ai-orb ai-orb-blue absolute bottom-[28%] right-[12%] size-[min(36vw,320px)]"
            animate={{ x: [0, -20, 0], y: [0, 25, 0] }}
            transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
          />
        </>
      )}

      <div className="ai-page-light-beam ai-page-light-beam-1" />
      <div className="ai-page-light-beam ai-page-light-beam-2" />
      <div className="ai-page-vignette" />
    </div>
  );
}
