import { z } from "zod";

export const aiChatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  conversationId: z.string().trim().max(64).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000),
      }),
    )
    .max(20)
    .optional(),
});

export type AiChatInput = z.infer<typeof aiChatSchema>;

export const registerPushTokenSchema = z.object({
  deviceId: z.string().trim().min(8).max(128),
  expoPushToken: z.string().trim().min(10).max(512),
  platform: z.enum(["IOS", "ANDROID", "WEB"]),
  deviceName: z.string().trim().max(120).optional(),
  appVersion: z.string().trim().max(32).optional(),
  osVersion: z.string().trim().max(32).optional(),
});

export type RegisterPushTokenInput = z.infer<typeof registerPushTokenSchema>;
