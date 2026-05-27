import type { Variants, Transition } from "framer-motion";

const easeOut = [0.22, 1, 0.36, 1] as const;
const springPop = [0.34, 1.56, 0.64, 1] as const;

// ---- Fade ----
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3 } },
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: easeOut } },
};

/** Hero / marketing stagger — pass delay via `custom` */
export const fadeUpShow: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: (delay: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, delay, ease: easeOut },
  }),
};

export const fadeDown: Variants = {
  hidden: { opacity: 0, y: -20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: easeOut } },
};

export const fadeLeft: Variants = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: easeOut } },
};

export const fadeRight: Variants = {
  hidden: { opacity: 0, x: 20 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: easeOut } },
};

// ---- Scale ----
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.3 } },
};

export const scaleUp: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.4, ease: springPop },
  },
};

// ---- Slide ----
export const slideInLeft: Variants = {
  hidden: { x: -100, opacity: 0 },
  visible: { x: 0, opacity: 1, transition: { duration: 0.5, ease: easeOut } },
};

export const slideInRight: Variants = {
  hidden: { x: 100, opacity: 0 },
  visible: { x: 0, opacity: 1, transition: { duration: 0.5, ease: easeOut } },
};

// ---- Containers ----
export const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.2 },
  },
};

export const listContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.2 },
  },
};

export const listItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
};

// ---- Interactions ----
export const buttonHover = {
  scale: 1.02,
  transition: { type: "spring" as const, stiffness: 400, damping: 10 },
};

export const buttonTap = { scale: 0.96 };

export const inputFocus = {
  scale: 1.01,
  transition: { duration: 0.2, ease: "easeOut" as const },
};

export const cardHover: Variants = {
  initial: { y: 0 },
  hover: {
    y: -4,
    transition: { duration: 0.3 },
  },
};

// ---- Continuous ----
export const pulse: Variants = {
  initial: { opacity: 1 },
  animate: {
    opacity: [1, 0.7, 1],
    transition: { duration: 2, repeat: Infinity },
  },
};

export const pulseGlow: Variants = {
  initial: { boxShadow: "0 0 0 rgba(37, 99, 235, 0)" },
  animate: {
    boxShadow: [
      "0 0 0 0 rgba(37, 99, 235, 0.7)",
      "0 0 0 10px rgba(37, 99, 235, 0)",
    ],
    transition: { duration: 1.5, repeat: Infinity },
  },
};

export const shake: Variants = {
  animate: {
    x: [0, -5, 5, -5, 0],
    transition: { duration: 0.4, ease: "easeInOut" },
  },
};

export const bounce: Variants = {
  animate: {
    y: [0, -10, 0],
    transition: { duration: 0.6, repeat: Infinity, ease: "easeInOut" },
  },
};

export const rotate: Variants = {
  animate: {
    rotate: 360,
    transition: { duration: 1, repeat: Infinity, ease: "linear" },
  },
};

// ---- UI chrome ----
export const menuVariants: Variants = {
  hidden: { opacity: 0, y: -10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2 } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.2 } },
};

export const modalBackdrop: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.2 } },
};

export const modalContent: Variants = {
  hidden: { opacity: 0, scale: 0.95, y: 20 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.3, ease: springPop },
  },
  exit: { opacity: 0, scale: 0.95, y: 20, transition: { duration: 0.2 } },
};

export const toastEnter: Variants = {
  hidden: { opacity: 0, x: 100, y: 0 },
  visible: { opacity: 1, x: 0, y: 0, transition: { duration: 0.3 } },
};

export const toastExit: Variants = {
  exit: { opacity: 0, x: 100, transition: { duration: 0.2 } },
};

export const tabContent: Variants = {
  hidden: { opacity: 0, x: 10 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
  exit: { opacity: 0, x: -10, transition: { duration: 0.2 } },
};

export const dropdownVariants: Variants = {
  hidden: { opacity: 0, scaleY: 0.95, originY: 0 },
  visible: { opacity: 1, scaleY: 1, transition: { duration: 0.2, ease: easeOut } },
  exit: { opacity: 0, scaleY: 0.95, transition: { duration: 0.15 } },
};

export const springConfig: Transition = {
  type: "spring",
  stiffness: 400,
  damping: 10,
};
