import { z } from "zod";
import { updateProfileSchema } from "./auth.schema";
import { idSchema } from "./common.schema";

/** Customer profile update (`PUT /api/users/me`). */
export const updateMeSchema = updateProfileSchema.extend({
  darkMode: z.boolean().optional(),
  notificationsEnabled: z.boolean().optional(),
});

export const createAddressSchema = z.object({
  label: z.string().trim().min(1).max(50),
  addressLine1: z.string().trim().min(3).max(200),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  zipCode: z.string().trim().regex(/^\d{6}$/, "ZIP must be 6 digits"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  landmark: z.string().trim().max(200).optional(),
  specialInstructions: z.string().trim().max(500).optional(),
});

export const updateAddressSchema = createAddressSchema.partial();

export const setDefaultAddressSchema = z.object({
  addressId: idSchema,
});

export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export const userPreferencesSchema = z.object({
  darkMode: z.boolean().optional(),
  notificationsEnabled: z.boolean().optional(),
  emailNotifications: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
  smsNotifications: z.boolean().optional(),
  preferredLanguage: z.string().trim().max(10).optional(),
});

export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
