import type { AuthStatus } from "@/types/auth";

/**
 * What a guarded screen does for a given auth state.
 *
 * Coding-phase certification 2026-09-28, cold start straight into /book from a deep link:
 *   - the store's status is "idle" until bootstrap starts, and the guard read that as "signed out";
 *   - it then navigated to /login before the root layout had mounted, which expo-router refuses
 *     with a render error ("Attempted to navigate before mounting the Root Layout component").
 * A signed-in customer following a link or notification into Bookings, Wallet, Profile or Book
 * got an error screen, or — had the layout been up — the login screen.
 */
export type GuardDecision = "wait" | "sign_in" | "render";

export function authGuardDecision(status: AuthStatus, isAuthenticated: boolean): GuardDecision {
  // "idle": bootstrap has not started, so the session is unknown — not absent.
  if (status === "idle" || status === "initializing") return "wait";
  return isAuthenticated ? "render" : "sign_in";
}

/**
 * Navigation to the login screen is only possible once the navigation container is ready — the
 * condition expo-router itself asserts. The root state's `key` exists earlier than that, so it is
 * not a usable signal (a guard gated on it still hit the render error on the emulator).
 */
export function shouldNavigateToSignIn(decision: GuardDecision, navigationReady: boolean): boolean {
  return decision === "sign_in" && navigationReady;
}
