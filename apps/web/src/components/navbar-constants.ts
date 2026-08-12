/**
 * Standalone navbar layout constant. Lives apart from `Navbar.tsx` so layouts that only
 * need the offset value do NOT pull the full Navbar module (framer-motion + nav chrome)
 * into their first-load bundle. `Navbar.tsx` re-exports this for backwards compatibility.
 */

/** Total fixed header offset including safe area (for layout padding). */
export const NAVBAR_OFFSET = "calc(3.5rem + env(safe-area-inset-top, 0px))";
