/**
 * Phase 15.2 — `service_click`: the customer actively chose a service from a listing, search
 * result or recommendation. Called from click handlers only, never from render.
 *
 * Identity is (session, service, surface, document instance): a double-click or a back-and-click
 * on the same card in the same page load is one click; a click after a reload is a new one.
 */
import { funnelDocumentInstance, trackFunnelEvent } from "@/lib/analytics/funnel";

export type ServiceClickSurface =
  | "card"
  | "feature-card"
  | "job-card"
  | "home-tile"
  | "search"
  | "coming-soon";

export function trackServiceClick(
  service: { backendId?: string | null; slug?: string; category?: string },
  surface: ServiceClickSurface,
  extra?: { query?: string },
): void {
  if (!service.backendId) return;
  trackFunnelEvent("SERVICE_CLICK", {
    serviceId: service.backendId,
    identity: `${surface}|${funnelDocumentInstance()}`,
    metadata: {
      surface,
      slug: service.slug ?? null,
      category: service.category ?? null,
      page: typeof window !== "undefined" ? window.location.pathname : null,
      // Only whether a search term was used, never the term itself.
      fromSearch: extra?.query ? true : undefined,
    },
  });
}
