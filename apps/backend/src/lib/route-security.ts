import type { z } from "zod";
import { validate } from "../middleware/validation.middleware";
import { sanitizeEmail, sanitizeUrl, sanitizeUserInput } from "../utils/sanitizer";

export type TextFieldRule = { maxLen?: number; url?: boolean; email?: boolean };

/**
 * Validate request body with Zod, then sanitize configured string fields.
 * Throws `ValidationFailedError` on schema failure (handled globally).
 */
export function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  raw: unknown,
  textFields?: Partial<Record<string, TextFieldRule>>,
): z.infer<T> {
  const parsed = validate(schema, raw);
  return applyTextSanitization(parsed, textFields) as z.infer<T>;
}

function applyTextSanitization<T>(value: T, rules?: Partial<Record<string, TextFieldRule>>): T {
  if (!rules || typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }

  const out = { ...(value as Record<string, unknown>) };
  for (const [key, rule] of Object.entries(rules)) {
    const current = out[key];
    if (typeof current !== "string") continue;
    if (rule?.email) {
      out[key] = sanitizeEmail(current);
    } else if (rule?.url) {
      out[key] = sanitizeUrl(current) ?? "";
    } else {
      out[key] = sanitizeUserInput(current, rule?.maxLen ?? 1000);
    }
  }
  return out as T;
}

/** Sanitize query string map (search filters, etc.). */
export function sanitizeQueryStrings(
  query: Record<string, string | undefined>,
  maxLen = 200,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(query)) {
    out[key] = value === undefined ? undefined : sanitizeUserInput(value, maxLen);
  }
  return out;
}
