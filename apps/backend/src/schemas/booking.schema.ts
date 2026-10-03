import { z } from "zod";
import { idSchema } from "./common.schema";

/**
 * Part 5 — Input Validation (Zod schemas) for booking + rating flows.
 */

export const createBookingSchema = z.object({
  serviceId: idSchema,
  providerId: idSchema.optional(),
  addressId: idSchema,
  scheduledDate: z.coerce
    .date()
    .refine((date) => date.getTime() > Date.now(), "Booking date must be in the future"),
  description: z.string().trim().max(1000, "Description too long").optional(),
  paymentMethod: z.string().trim().max(50).optional(),
  couponCode: z.string().trim().max(40).optional(),
  packagePrice: z.number().positive().optional(),
  variantId: z.string().trim().min(1).max(40).optional(),
  quantity: z.number().int().min(1).max(1000).optional(),
  audience: z.string().trim().max(20).optional(),
  professionalPreference: z.string().trim().max(20).optional(),
  addonIds: z.array(z.string().trim().max(40)).max(10).optional(),
  addonQuantities: z.record(z.string().trim().max(40), z.number().int().min(1).max(100)).optional(),
  serviceVersion: z.number().int().positive().optional(),
  quoteToken: z.string().max(2048).optional(),
  /** Phase 06: codes of the blocking requirements the customer confirmed (checked server-side). */
  requirementAttestations: z.array(z.string().trim().min(1).max(60)).max(60).optional(),
  /** Phase D: the customer attests a parent/guardian confirms the booking (an attestation, not proof). */
  guardianAttested: z.boolean().optional(),
});

export const bookingPriceQuoteSchema = z.object({
  serviceId: idSchema,
  couponCode: z.string().trim().max(40).optional(),
  packagePrice: z.number().positive().optional(),
  variantId: z.string().trim().min(1).max(40).optional(),
  quantity: z.number().int().min(1).max(1000).optional(),
  audience: z.string().trim().max(20).optional(),
  professionalPreference: z.string().trim().max(20).optional(),
  addonIds: z.array(z.string().trim().max(40)).max(10).optional(),
  addonQuantities: z.record(z.string().trim().max(40), z.number().int().min(1).max(100)).optional(),
  serviceVersion: z.number().int().positive().optional(),
  // The address the booking will use. Preferred over lat/lng: the server prices from the SAME
  // coordinates booking creation will use, so the quote cannot differ from the charge.
  addressId: idSchema.optional(),
  // Service location — enables weather-based dynamic surge in the quote.
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  /** Phase D: lets the quote explain the age policy outcome with the attestation the customer would give. */
  guardianAttested: z.boolean().optional(),
});

export const updateBookingCustomerSchema = z.object({
  scheduledDate: z.coerce.date().optional(),
  description: z.string().trim().max(1000).optional(),
});

export const updateBookingSchema = z.object({
  status: z.enum(["accepted", "rejected", "in_progress", "completed", "cancelled"]),
  notes: z.string().trim().max(500, "Notes too long").optional(),
});

export const cancelBookingSchema = z.object({
  reason: z.string().trim().min(3, "Reason too short").max(500, "Reason too long").optional(),
});

export const createRatingSchema = z.object({
  bookingId: idSchema,
  rating: z.number().int().min(1, "Rating must be 1-5").max(5, "Rating must be 1-5"),
  // Review is optional (star-only ratings are allowed); if written, keep it meaningful.
  reviewText: z.string().trim().min(10, "Review too short").max(1000, "Review too long").optional(),
  photos: z.array(z.string().url("Invalid photo URL")).max(10, "Too many photos").optional(),
  tipAmount: z.number().nonnegative("Tip cannot be negative").max(100000).optional(),
  liked: z.array(z.string().trim().max(80)).max(20).optional(),
  couldImprove: z.array(z.string().trim().max(80)).max(20).optional(),
});

export const updateRatingSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  reviewText: z.string().trim().min(10).max(1000).optional(),
  photos: z.array(z.string().url()).max(10).optional(),
});

export const providerRatingResponseSchema = z.object({
  response: z.string().trim().min(3).max(1000),
});

export const bookingCancelRouteSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const geoPingSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  notes: z.string().trim().max(500).optional(),
  photos: z.array(z.string().url()).max(10).optional(),
});

/**
 * For transitions that do not require a proof of presence (en-route, complete): a client without a
 * GPS fix sends null/omits the coordinates instead of inventing 0,0. The server treats absent
 * coordinates as UNKNOWN (see lib/geo-unknown.ts) — never as a location.
 */
export const optionalGeoPingSchema = geoPingSchema.extend({
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;
export type CreateRatingInput = z.infer<typeof createRatingSchema>;
