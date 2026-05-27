import type { Variants } from "framer-motion";

/** AI dashboard motion variants (`show` key — do not import from `@/lib/animations`). */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, delay: Number(i) * 0.06, ease: [0.22, 1, 0.36, 1] },
  }),
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.4 } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.55, ease: [0.34, 1.56, 0.64, 1] },
  },
};

export const slideSidebar: Variants = {
  hidden: { opacity: 0, x: -20 },
  show: { opacity: 1, x: 0, transition: { duration: 0.4 } },
};

export const slideHeader: Variants = {
  hidden: { opacity: 0, y: -10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, delay: 0.1 } },
};
