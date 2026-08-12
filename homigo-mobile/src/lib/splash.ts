import * as SplashScreen from "expo-splash-screen";
import { startupMark } from "@/lib/startup-trace";

let hidden = false;

/**
 * Hides the native splash exactly once, whichever path gets there first — home
 * render, the UI-ready fallback, or the root failsafe.
 *
 * The guard has to be module-level, not per-component: the failsafe lives in the
 * root layout while the normal paths live in AuthProvider, so a local ref cannot
 * see that the splash is already gone. Without it every later path re-marked
 * SPLASH_HIDE, and the startup timeline reported a splash that stayed up seconds
 * longer than it actually did.
 *
 * Returns true only for the call that actually hid the splash.
 */
export function hideSplashOnce(reason: string, onFirstHide?: () => void): boolean {
  if (hidden) return false;
  hidden = true;
  startupMark("SPLASH_HIDE", reason);
  void SplashScreen.hideAsync().catch(() => undefined);
  // Splash gone == the user can act, so every path must release onInteractive
  // listeners (offline replay, deferred work) — not just the happy one.
  startupMark("INTERACTIVE", reason);
  onFirstHide?.();
  return true;
}
