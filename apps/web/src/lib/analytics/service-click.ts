/**
 * Phase 15.2 — `service_click`: the customer actively chose a service from a listing, search
 * result or recommendation. Called from click handlers only, never from render.
 *
 * Identity is (session, service, surface, document instance): a double-click or a back-and-click
 * on the same card in the same page load is one click; a click after a reload is a new one.
 *
 * The funnel client is loaded on the click, not with the listing. It pulls the auth API client,
 * which a catalogue page does not need until someone actually chooses a service. The payload is
 * captured before that load so a navigation cannot change what was clicked.
 */

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
  const serviceId = service.backendId;
  const slug = service.slug ?? null;
  const category = service.category ?? null;
  const page = typeof window !== "undefined" ? window.location.pathname : null;
  const fromSearch = extra?.query ? true : undefined;
  // The click handler returns before this settles, so a failed chunk cannot block navigation.
  // Without catch, that failure is an unhandled rejection. The event is then simply not recorded.
  void import("@/lib/analytics/funnel")
    .then(({ funnelDocumentInstance, trackFunnelEvent }) => {
      trackFunnelEvent("SERVICE_CLICK", {
        serviceId,
        identity: `${surface}|${funnelDocumentInstance()}`,
        metadata: { surface, slug, category, page, fromSearch },
      });
    })
    .catch((reason: unknown) => {
      void reason;
    });
}
