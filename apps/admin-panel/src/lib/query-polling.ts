/** Admin console polling budgets — keep background API load predictable. */

/** Business overview: WS pushes lifecycle events; poll is a slow safety net. */
export const DASHBOARD_POLL_MS = 120_000;

/** Bookings list pages (not overview widgets). */
export const BOOKINGS_LIST_POLL_MS = 60_000;

/** Command center KPI ribbon. */
export const COMMAND_KPI_POLL_MS = 90_000;

/** Shared geo-intel map layers. */
export const COMMAND_GEO_POLL_MS = 120_000;

/** Slow intelligence panels. */
export const COMMAND_REVENUE_POLL_MS = 180_000;
export const COMMAND_DEMAND_POLL_MS = 300_000;

/** Top-bar badge counts — cache heavily; WS invalidates on partner/customer events. */
export const TOPBAR_BADGE_STALE_MS = 5 * 60_000;

/** Support ops — WS invalidates; REST is a slow backfill only. */
export const SUPPORT_TICKETS_POLL_MS = 60_000;
export const SUPPORT_DETAIL_POLL_MS = 60_000;
export const SUPPORT_ANALYTICS_STALE_MS = 5 * 60_000;

/** Live operations map — WS-preferred; REST is a slow safety net. */
export const OPS_MAP_POLL_MS = 60_000;

/** Digital twin city bundle (twin + insights fetched together). */
export const DIGITAL_TWIN_POLL_MS = 60_000;
