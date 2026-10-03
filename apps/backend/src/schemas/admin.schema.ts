import { z } from "zod";

export const adminVerifyProviderSchema = z.object({
  action: z.enum(["approve", "reject", "request_changes"]),
  notes: z.string().trim().max(2000).optional(),
  targetStep: z.string().trim().max(64).optional(),
});

export const adminBanUserSchema = z.object({
  action: z.enum(["ban", "unban"]),
  reason: z.string().trim().max(500).optional(),
});
