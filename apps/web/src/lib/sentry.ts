/**
 * Sentry helpers — user context + domain capture for the customer app.
 * Safe no-ops when Sentry is disabled (no DSN). Reused across auth, booking, payment flows.
 */
import * as Sentry from "@sentry/nextjs";

/** Attach the signed-in user (id + role) to all subsequent events. */
export function setSentryUser(user: { id?: string | null; role?: string | null } | null): void {
  if (!user || !user.id) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id: user.id, role: user.role ?? "customer" });
}

/** Tag the current booking/payment so domain failures are searchable. */
export function setSentryDomainContext(ctx: { bookingId?: string | null; paymentId?: string | null }): void {
  if (ctx.bookingId) Sentry.setTag("bookingId", ctx.bookingId);
  if (ctx.paymentId) Sentry.setTag("paymentId", ctx.paymentId);
}

/** Capture a domain failure (payment / dispatch / wallet / booking) with structured context. */
export function captureDomainError(
  domain: "payment" | "dispatch" | "wallet" | "booking" | "api",
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
    tags: { domain },
    extra,
  });
}
