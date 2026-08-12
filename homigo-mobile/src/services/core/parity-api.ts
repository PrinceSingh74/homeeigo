import type { ApiResponse } from "@/types/auth";
import { apiRequest } from "@/services/auth/api-client";

/**
 * Feature-parity API surface — endpoints the customer web app consumed but mobile previously lacked.
 * Every path here is verified to exist on the backend (probed against the live OpenAPI spec).
 * Screens can adopt these incrementally; the client integration is now complete + typed.
 */
export type Prediction = { description: string; placeId: string; mainText?: string; secondaryText?: string };
// Matches the backend geocoder payload exactly (formattedAddress / latitude / longitude).
export type GeoAddress = {
  formattedAddress: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  latitude: number;
  longitude: number;
};
export type EtaResult = { distanceKm: number; etaMinutes: number; source?: string; withTraffic?: boolean; weatherAdjusted?: boolean };
export type WeatherNow = { tempC: number; feelsLikeC?: number; condition: string; humidity?: number; windSpeedKmh?: number; city?: string };
export type PriceQuote = { total: number; base: number; discount: number; breakdown?: Array<{ label: string; amount: number }> };
export type SupportTicket = { id: string; subject: string; category: string; status: string; createdAt: string; ticketNumber?: string };
export type PaymentMethod = { id: string; brand: string; last4: string; isDefault: boolean };
// `amount` is in RUPEES (not paise); the invoice id field is `invoiceNumber`.
export type Invoice = { id: string; invoiceNumber: string; amount: number; status: string; createdAt: string; razorpayPaymentId?: string };
export type Coupon = { code: string; description: string; discountPct?: number; discountFlat?: number; expiresAt?: string };

const q = (params: Record<string, string | number | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");

export const parityApi = {
  geo: {
    config: () =>
      apiRequest<ApiResponse<{ geocodingAvailable: boolean }>>("/api/geo/config").then((r) => r.data!),
    autocomplete: (input: string, near?: { lat: number; lng: number }) =>
      apiRequest<ApiResponse<{ predictions: Prediction[] }>>(
        `/api/geo/autocomplete?${q({ q: input, lat: near?.lat, lng: near?.lng })}`,
        { auth: true },
      ).then((r) => r.data!.predictions),
    reverse: (lat: number, lng: number) =>
      apiRequest<ApiResponse<{ address: GeoAddress }>>(`/api/geo/reverse?${q({ lat, lng })}`, { auth: true }).then(
        (r) => r.data!.address,
      ),
    eta: (from: { lat: number; lng: number }, to: { lat: number; lng: number }) =>
      apiRequest<ApiResponse<EtaResult>>(
        `/api/geo/eta?${q({ fromLat: from.lat, fromLng: from.lng, toLat: to.lat, toLng: to.lng })}`,
        { auth: true },
      ).then((r) => r.data!),
    /** Real driving route — encoded road polyline + traffic distance/duration (all-India). */
    route: (from: { lat: number; lng: number }, to: { lat: number; lng: number }) =>
      apiRequest<
        ApiResponse<{
          polyline: string | null;
          distanceKm: number;
          durationMin: number;
          etaMinutes: number;
          source: string;
        }>
      >(`/api/geo/route?${q({ fromLat: from.lat, fromLng: from.lng, toLat: to.lat, toLng: to.lng })}`, {
        auth: true,
      }).then((r) => r.data!),
    place: (placeId: string) =>
      // NOTE: /geo/place returns the address flat on `data` (NOT nested under `data.address`,
      // unlike /geo/reverse). Verified against the live response.
      apiRequest<ApiResponse<GeoAddress>>(`/api/geo/place/${encodeURIComponent(placeId)}`, {
        auth: true,
      }).then((r) => r.data!),
  },

  weather: {
    current: (lat: number, lng: number) =>
      // weather is nested under data.weather (verified against live response).
      apiRequest<ApiResponse<{ weather: WeatherNow }>>(`/api/weather/current?${q({ lat, lng })}`, { auth: true }).then(
        (r) => r.data!.weather,
      ),
    alerts: (lat: number, lng: number) =>
      apiRequest<ApiResponse<{ alerts: Array<{ event: string; severity: string }> }>>(
        `/api/weather/alerts?${q({ lat, lng })}`,
        { auth: true },
      ).then((r) => r.data!.alerts),
  },

  bookings: {
    priceQuote: (serviceId: string, scheduledDate: string, addressId: string) =>
      apiRequest<ApiResponse<PriceQuote>>("/api/bookings/price-quote", {
        method: "POST",
        body: { serviceId, scheduledDate, addressId },
        auth: true,
      }).then((r) => r.data!),
  },

  support: {
    list: () =>
      apiRequest<ApiResponse<{ tickets: SupportTicket[] }>>("/api/support/tickets", { auth: true }).then(
        (r) => r.data!.tickets,
      ),
    create: (subject: string, description: string, category: string) =>
      apiRequest<ApiResponse<{ ticket: SupportTicket }>>("/api/support/tickets", {
        method: "POST",
        body: { subject, description, category }, // backend field is `description` (minLength 10)
        auth: true,
      }).then((r) => r.data!.ticket),
  },

  wallet: {
    paymentMethods: () =>
      apiRequest<ApiResponse<{ methods: PaymentMethod[] }>>("/api/wallet/payment-methods", { auth: true }).then(
        (r) => r.data!.methods,
      ),
    checkoutQuote: (payload: { bookingId?: string; amount?: number; useWallet?: boolean; couponCode?: string }) =>
      apiRequest<ApiResponse<{ payable: number; walletApplied: number; discount: number }>>(
        "/api/wallet/checkout/quote",
        { method: "POST", body: payload, auth: true },
      ).then((r) => r.data!),
  },

  subscriptions: {
    invoices: () =>
      apiRequest<ApiResponse<{ invoices: Invoice[] }>>("/api/subscriptions/invoices", { auth: true }).then(
        (r) => r.data!.invoices,
      ),
    coupons: () =>
      apiRequest<ApiResponse<{ coupons: Coupon[] }>>("/api/subscriptions/coupons", { auth: true }).then(
        (r) => r.data!.coupons,
      ),
  },

  uploads: {
    ratingPhoto: (payload: { bookingId: string; dataUrl: string }) =>
      apiRequest<ApiResponse<{ url: string }>>("/api/uploads/ratings", {
        method: "POST",
        body: payload,
        auth: true,
      }).then((r) => r.data!),
  },
};
