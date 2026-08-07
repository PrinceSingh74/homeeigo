import type { AiGatewayInput, AiMessage } from "../types";
import { AI_LIMITS } from "../types";

export type InputValidationResult =
  | { valid: true; input: AiGatewayInput }
  | { valid: false; errors: string[] };

const CUID_PATTERN = /^c[a-z0-9]{24,}$/i;

export function validateAiInput(raw: unknown): InputValidationResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") {
    return { valid: false, errors: ["body must be an object"] };
  }
  const body = raw as Record<string, unknown>;

  if (typeof body.message !== "string" || body.message.trim().length === 0) {
    errors.push("message is required");
  } else if ((body.message as string).length > AI_LIMITS.maxMessageLength) {
    errors.push(`message exceeds ${AI_LIMITS.maxMessageLength} characters`);
  }

  if (body.templateId != null && typeof body.templateId !== "string") {
    errors.push("templateId must be a string");
  }

  if (body.history != null) {
    if (!Array.isArray(body.history)) {
      errors.push("history must be an array");
    } else if (body.history.length > AI_LIMITS.maxHistoryTurns) {
      errors.push(`history exceeds ${AI_LIMITS.maxHistoryTurns} turns`);
    } else {
      for (const [i, turn] of body.history.entries()) {
        if (!turn || typeof turn !== "object") {
          errors.push(`history[${i}] invalid`);
          continue;
        }
        const t = turn as AiMessage;
        if (!["user", "assistant", "system"].includes(t.role)) {
          errors.push(`history[${i}].role invalid`);
        }
        if (typeof t.content !== "string") {
          errors.push(`history[${i}].content must be string`);
        }
      }
    }
  }

  if (body.context != null && typeof body.context !== "object") {
    errors.push("context must be an object");
  } else if (body.context && typeof body.context === "object") {
    const ctx = body.context as Record<string, unknown>;
    if (ctx.bookingId != null && typeof ctx.bookingId === "string" && !CUID_PATTERN.test(ctx.bookingId)) {
      errors.push("context.bookingId format invalid");
    }
    if (ctx.partnerId != null && typeof ctx.partnerId === "string" && !CUID_PATTERN.test(ctx.partnerId)) {
      errors.push("context.partnerId format invalid");
    }
    if (ctx.customerId != null && typeof ctx.customerId === "string" && !CUID_PATTERN.test(ctx.customerId)) {
      errors.push("context.customerId format invalid");
    }
    if (ctx.location != null) {
      const loc = ctx.location as Record<string, unknown>;
      if (typeof loc.lat !== "number" || typeof loc.lng !== "number") {
        errors.push("context.location requires numeric lat/lng");
      }
    }
  }

  if (body.responseSchema != null && typeof body.responseSchema !== "object") {
    errors.push("responseSchema must be an object");
  }

  if (body.conversationId != null) {
    if (typeof body.conversationId !== "string" || !CUID_PATTERN.test(body.conversationId)) {
      errors.push("conversationId format invalid");
    }
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    input: {
      message: (body.message as string).trim(),
      templateId: body.templateId as string | undefined,
      conversationId: body.conversationId as string | undefined,
      context: body.context as AiGatewayInput["context"],
      history: body.history as AiMessage[] | undefined,
      responseSchema: body.responseSchema as Record<string, unknown> | undefined,
      stream: body.stream === true,
    },
  };
}
