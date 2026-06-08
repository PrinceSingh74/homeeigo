import { z } from "zod";

export const adminVerifyProviderSchema = z.object({
  action: z.enum(["approve", "reject"]),
  notes: z.string().trim().max(2000).optional(),
});

export const adminBanUserSchema = z.object({
  action: z.enum(["ban", "unban"]),
  reason: z.string().trim().max(500).optional(),
});
