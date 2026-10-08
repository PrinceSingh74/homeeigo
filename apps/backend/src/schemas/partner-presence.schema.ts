import { z } from "zod";
import { idSchema } from "./common.schema";

export const partnerPresenceHeartbeatSchema = z.object({
  sessionId: idSchema,
  deviceId: z.string().trim().min(1).max(128),
  timestamp: z.coerce.date(),
  appState: z.enum(["foreground", "background", "inactive"]).optional(),
  platform: z.enum(["ios", "android", "web"]).optional(),
  appVersion: z.string().trim().max(32).optional(),
  /** Telemetry only — server does not treat this as authoritative availability. */
  availabilityTelemetry: z.string().trim().max(32).optional(),
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracy: z.number().min(0).max(50_000).optional(),
      capturedAt: z.coerce.date(),
      // Stored as INT4 (partner_presence.last_location_seq): out-of-range values are a 400, not a DB 500.
      sequence: z.number().int().nonnegative().max(2_147_483_647).optional(),
      /** The device's own word on the fix: true = the OS flagged it as mock-location (Android), false = not, absent/null = unknown (iOS, web, older clients). */
      mocked: z.boolean().nullable().optional(),
    })
    .optional(),
});

export type PartnerPresenceHeartbeatInput = z.infer<typeof partnerPresenceHeartbeatSchema>;

/**
 * Standalone location ping. Same session/device proof as a heartbeat, but location is
 * mandatory — lets the app send GPS on its own cadence (battery-aware) without pretending
 * a fix arrived with every liveness beat.
 */
export const partnerLocationPingSchema = z.object({
  sessionId: idSchema,
  deviceId: z.string().trim().min(1).max(128),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(50_000).optional(),
    capturedAt: z.coerce.date(),
    sequence: z.number().int().nonnegative().max(2_147_483_647).optional(),
    /** As on the heartbeat: the device's own word on the fix; absent/null = unknown. */
    mocked: z.boolean().nullable().optional(),
  }),
});

export type PartnerLocationPingInput = z.infer<typeof partnerLocationPingSchema>;
