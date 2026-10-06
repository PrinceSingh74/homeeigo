/**
 * Booking creation requires a price quote (`QUOTE_REQUIRED` otherwise): a real client first calls
 * `POST /api/bookings/price-quote` and sends the returned `quoteToken` with `POST /api/bookings`.
 * Suites that create bookings over HTTP go through this helper so they follow the same two steps.
 *
 * Nothing is cached: a token is bound to the user, the service and the selection, and it expires.
 * When the quote route does not return a token (refused selection, missing bearer, unknown
 * address…) the body is returned unchanged, so the create answers whatever the server answers.
 */
import type { bookingService as BookingServiceInstance } from "../../services/booking.service";

type CreateBody = Parameters<(typeof BookingServiceInstance)["create"]>[1];
type CreateResult = ReturnType<(typeof BookingServiceInstance)["create"]>;

/**
 * The same quote, for suites that call `bookingService.create` directly instead of the route.
 *
 * Built on the real `bookingPricingService.quote` with the inputs the price-quote route gives it
 * (the caller's own address supplies the coordinates), so the token is what a client would hold.
 * `undefined` when the address is not the user's or the selection is refused — the create then
 * answers whatever the server answers. The token is stateless and not single-use: it is bound to
 * the user, the service, the selection (address included) and the price, NOT to the slot, so a race
 * suite can fetch one per user BEFORE the race and pass it to every concurrent create.
 *
 * Services are imported lazily so a suite that sets env before loading them keeps its ordering.
 */
export async function quoteTokenForUser(userId: string, body: Record<string, unknown>): Promise<string | undefined> {
  const [{ bookingPricingService }, { default: prisma }] = await Promise.all([
    import("../../services/booking-pricing.service"),
    import("../../lib/prisma"),
  ]);
  let lat: number | undefined;
  let lng: number | undefined;
  const addressId = typeof body.addressId === "string" ? body.addressId : undefined;
  if (addressId) {
    const address = await prisma.address.findFirst({ where: { id: addressId, userId }, select: { latitude: true, longitude: true } });
    if (!address) return undefined; // the route answers ADDRESS_NOT_FOUND: a client holds no token
    lat = address.latitude ?? undefined;
    lng = address.longitude ?? undefined;
  }
  const b = body as CreateBody;
  const result = await bookingPricingService.quote({
    userId,
    serviceId: b.serviceId,
    couponCode: b.couponCode,
    packagePrice: b.packagePrice,
    variantId: b.variantId,
    quantity: b.quantity,
    audience: b.audience,
    professionalPreference: b.professionalPreference,
    addonIds: b.addonIds,
    addonQuantities: b.addonQuantities,
    serviceVersion: b.serviceVersion,
    addressId,
    lat,
    lng,
  });
  if (!result.ok) return undefined;
  const token = (result.breakdown as { quoteToken?: unknown }).quoteToken;
  return typeof token === "string" && token.length > 0 ? token : undefined;
}

/** `bookingService.create`, preceded by the quote a client would have fetched. Not for use INSIDE a race. */
export async function createBookingWithQuote(userId: string, body: CreateBody): CreateResult {
  const { bookingService } = await import("../../services/booking.service");
  if ("quoteToken" in body) return bookingService.create(userId, body);
  const quoteToken = await quoteTokenForUser(userId, body as Record<string, unknown>);
  return bookingService.create(userId, quoteToken ? { ...body, quoteToken } : body);
}

type AppLike ={ handle(request: Request): Response | Promise<Response> };

/** The fields `bookingPriceQuoteSchema` accepts — the selection the quote is bound to. */
const QUOTE_FIELDS = [
  "serviceId",
  "couponCode",
  "packagePrice",
  "variantId",
  "quantity",
  "audience",
  "professionalPreference",
  "addonIds",
  "addonQuantities",
  "serviceVersion",
  "addressId",
  "lat",
  "lng",
  "guardianAttested",
] as const;

export const BOOKING_CREATE_PATH = "/api/bookings";

/** Fetch a quote token for this booking body as this user; `undefined` when the quote was refused. */
export async function quoteTokenFor(
  app: AppLike,
  bearerToken: string | null | undefined,
  body: Record<string, unknown>,
): Promise<string | undefined> {
  if (!bearerToken) return undefined;
  const selection: Record<string, unknown> = {};
  for (const field of QUOTE_FIELDS) {
    if (body[field] !== undefined) selection[field] = body[field];
  }
  const res = await app.handle(
    new Request("http://localhost/api/bookings/price-quote", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearerToken}` },
      body: JSON.stringify(selection),
    }),
  );
  const json = (await res.json().catch(() => ({}))) as { data?: { quote?: { quoteToken?: unknown } } };
  const token = json?.data?.quote?.quoteToken;
  return typeof token === "string" && token.length > 0 ? token : undefined;
}

/**
 * Returns `body` plus a fresh `quoteToken`. A body that already names `quoteToken` (even as
 * `undefined`, the explicit "send none") is returned untouched, as is anything that is not a plain
 * object.
 */
export async function withQuoteToken<T>(app: AppLike, bearerToken: string | null | undefined, body: T): Promise<T> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  if ("quoteToken" in record) return body;
  const quoteToken = await quoteTokenFor(app, bearerToken, record);
  return quoteToken ? ({ ...record, quoteToken } as T) : body;
}
