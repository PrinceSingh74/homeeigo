"use client";

import { LazyMotion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Loads framer-motion's full DOM feature set (`domMax`: animations + gestures + layout + drag)
 * as a SEPARATE async chunk instead of eagerly bundling the ~110 kB `motion` engine into the
 * shared first-load JS. Combined with importing the lightweight `m` component everywhere
 * (aliased as `motion`), this keeps the animation engine out of the initial bundle while
 * preserving every existing `<motion.* />` usage and animation feature.
 */
const loadFeatures = () => import("framer-motion").then((mod) => mod.domMax);

export function MotionProvider({ children }: { children: ReactNode }) {
  // Non-strict so any not-yet-migrated full `motion` import still renders (never breaks UI);
  // features load async so first paint is not blocked by the animation engine.
  return <LazyMotion features={loadFeatures}>{children}</LazyMotion>;
}
