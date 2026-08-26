import { z } from "zod";
import { idSchema } from "./common.schema";

export const providerSearchSchema = z.object({
  serviceId: idSchema,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radius: z.number().positive().max(100).optional(),
  minRating: z.number().min(0).max(5).optional(),
  minCompletionRate: z.number().min(0).max(100).optional(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const providerMatchSchema = z.object({
  serviceId: idSchema,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  scheduledDate: z.coerce.date(),
  maxResults: z.number().int().min(1).max(20).optional(),
  maxDistanceKm: z.number().positive().max(100).optional(),
});

export const providerOnlineSchema = z.object({
  online: z.boolean(),
});

export const providerPauseSchema = z.object({
  reason: z.enum(["break", "personal", "travel", "other"]).optional(),
});

export const providerServiceAreaSchema = z.object({
  city: z.string().trim().min(1).max(80).optional(),
  serviceRegions: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  serviceRadiusKm: z.number().min(1).max(50).optional(),
  baseLatitude: z.number().min(-90).max(90).optional(),
  baseLongitude: z.number().min(-180).max(180).optional(),
});

export const bookingRejectSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const bookingAcceptSchema = z.object({
  eta: z.number().int().positive().max(480).optional(),
});

export const trackingLocationSchema = z.object({
  bookingId: idSchema,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().optional(),
  altitude: z.number().optional(),
  // Optional device-reported ground speed (m/s). When absent the server derives it
  // from consecutive fixes. Capped at 90 m/s (~324 km/h) to reject GPS glitches.
  speed: z.number().nonnegative().max(90).optional(),
});

export type ProviderSearchInput = z.infer<typeof providerSearchSchema>;
