"use client";

import { LazyMotion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Keeps framer-motion's animation engine out of the first-load bundle.
 *
 * Importing `motion` pulls the full DOM feature set — animations, gestures, layout, drag — into the
 * shared chunk every route downloads. Measured here before this change: partner-web shipped 227 kB
 * of shared JS against the customer app's 188 kB, on 53 routes, and 227 kB is the exact figure the
 * customer app started from before it made this same move.
 *
 * `LazyMotion` loads those features as a separate async chunk while components import the
 * lightweight `m` primitive instead (aliased as `motion`, so every existing `<motion.div />` keeps
 * working unchanged). Non-strict on purpose: a component that still imports the full `motion` will
 * render correctly rather than throw, so a missed file is a missed saving and never a broken screen.
 */
const loadFeatures = () => import("framer-motion").then((mod) => mod.domMax);

export function MotionProvider({ children }: { children: ReactNode }) {
  return <LazyMotion features={loadFeatures}>{children}</LazyMotion>;
}
