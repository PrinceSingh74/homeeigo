import type { ApiResponse } from "@/types/auth";
import { apiRequest } from "@/services/auth/api-client";
import type { BookingQuote, BookingSelection } from "@/lib/booking-quote";

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
export type Serviceability = {
  serviceable: boolean;
  /** false = no service zones configured on the server (everything is serviceable). */
  configured: boolean;
  zones: Array<{ id: string; name: string }>;
};
/** POST /api/wallet/checkout/quote — amounts in rupees, derived by the server from the booking. */
export type WalletCheckoutQuote = {
  bookingId: string;
  bookingAmount: number;
  taxes: number;
  finalAmount: number;
  walletBalance: number;
  walletApplicable: number;
  razorpayRequired: number;
  remainderDue: number;
  fullyPayableFromWallet: boolean;
  alreadyPaid: boolean;
};
export type SplitInitiateResult =
  | { mode: "wallet_only"; status: "SUCCESS"; amountPaid: number; balance: number }
  | { mode: "split"; razorpayOrderId: string; razorpayAmount: number; walletAmount: number; finalAmount: number; key?: string };
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
    /** `null` when the server has no geocoder configured or nothing is at that point. */
    reverse: (lat: number, lng: number) =>
      apiRequest<ApiResponse<{ available?: boolean; address: GeoAddress | null }>>(
        `/api/geo/reverse?${q({ lat, lng })}`,
        { auth: true },
      ).then((r) => r.data?.address ?? null),
    /** Is this point inside a service zone? 400 OUT_OF_AREA outside India. */
    serviceable: (lat: number, lng: number, category?: string) =>
      apiRequest<ApiResponse<Serviceability>>(`/api/geo/serviceable?${q({ lat, lng, category })}`, {
        auth: true,
      }).then((r) => r.data!),
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
    /**
     * The slots the SERVER says are bookable for one day (Wave 4).
     *
     * The reschedule panel used a hardcoded list of six times that no server had agreed to, so a
     * customer could pick a slot the platform then refused. The grid, the operating window and each
     * slot's verdict all come from the backend; this client only renders them.
     */
    availability: (params: {
      serviceId: string;
      date: string;
      addressId?: string;
      providerId?: string;
      /** Rescheduling: the booking being moved does not block its own new time. */
      excludeBookingId?: string;
    }) => {
      const qs = new URLSearchParams({ serviceId: params.serviceId, date: params.date });
      if (params.addressId) qs.set("addressId", params.addressId);
      if (params.providerId) qs.set("providerId", params.providerId);
      if (params.excludeBookingId) qs.set("excludeBookingId", params.excludeBookingId);
      return apiRequest<
        ApiResponse<{
          date: string;
          timeZone: string;
          slotMinutes: number;
          durationMinutes: number;
          operatingWindow: { start: string; end: string };
          availableCount: number;
          slots: { start: string; available: boolean; reason?: string }[];
        }>
      >(`/api/bookings/availability?${qs}`, { auth: true }).then((r) => r.data!);
    },
    /**
     * Server price for a selection (bookingPriceQuoteSchema). The SAME pricing function runs inside
     * POST /api/bookings, so this total is what the booking will be charged.
     */
    priceQuote: (selection: BookingSelection) =>
      apiRequest<ApiResponse<{ quote: BookingQuote }>>("/api/bookings/price-quote", {
        method: "POST",
        body: selection,
        auth: true,
      }).then((r) => r.data!.quote),
    /** Customer reschedule — PUT /api/bookings/:id { scheduledDate } (conflicts → 409). */
    reschedule: (bookingId: string, scheduledDate: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/bookings/${encodeURIComponent(bookingId)}`, {
        method: "PUT",
        body: { scheduledDate },
        auth: true,
      }),
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
    checkoutQuote: (bookingId: string) =>
      apiRequest<ApiResponse<WalletCheckoutQuote>>("/api/wallet/checkout/quote", {
        method: "POST",
        body: { bookingId },
        auth: true,
      }).then((r) => r.data!),
    /** Pay the whole booking from wallet balance. */
    checkoutPay: (bookingId: string) =>
      apiRequest<ApiResponse<{ ok: boolean; alreadyPaid?: boolean; amountPaid: number; balance: number }>>(
        "/api/wallet/checkout/pay",
        { method: "POST", body: { bookingId }, auth: true },
      ).then((r) => r.data!),
    /** Wallet part now, remainder through a Razorpay order; the wallet leg commits on verify. */
    splitInitiate: (bookingId: string, walletAmount: number) =>
      apiRequest<ApiResponse<SplitInitiateResult>>("/api/wallet/checkout/split/initiate", {
        method: "POST",
        body: { bookingId, walletAmount },
        auth: true,
      }).then((r) => r.data!),
    splitVerify: (payload: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) =>
      apiRequest<ApiResponse<{ ok: boolean; status: string; bookingId: string; walletApplied: number; razorpayApplied: number; balance: number }>>(
        "/api/wallet/checkout/split/verify",
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
