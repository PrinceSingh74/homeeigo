import { coreApi } from "@/services/core/api";
import type { BackendTracking } from "@/types/backend";

/**
 * Phase 17.2 — thin tracking API surface. Reuses the existing `coreApi.tracking` endpoint
 * (`GET /api/tracking/:bookingId`) which is already booking-ownership authorised server-side.
 * No new tracking API/system.
 */
export const trackingApi = {
  get: (bookingId: string) => coreApi.tracking.get(bookingId),
};

export type { BackendTracking };
