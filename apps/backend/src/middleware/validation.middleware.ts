import { z } from "zod";

/**
 * Part 5 — Validation handler.
 *
 * Wraps Zod parsing so routes get a single, consistent way to validate input
 * and surface field-level errors. Throwing `ValidationFailedError` lets the
 * global error middleware return a 400 with structured `details`.
 */

export type FieldError = { field: string; message: string };

export class ValidationFailedError extends Error {
  public readonly details: FieldError[];

  constructor(details: FieldError[]) {
    super("Validation error");
    this.name = "ValidationFailedError";
    this.details = details;
  }
}

/** Map a ZodError into a flat list of `{ field, message }`. */
export function formatZodError(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.length ? issue.path.join(".") : "(root)",
    message: issue.message,
  }));
}

/**
 * Validate `data` against `schema`. Returns the parsed (and coerced) value or
 * throws `ValidationFailedError` with field-level details.
 */
export function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationFailedError(formatZodError(result.error));
  }
  return result.data;
}

/**
 * Non-throwing variant for callers that prefer to branch on the result.
 */
export function tryValidate<T>(
  schema: z.ZodType<T>,
  data: unknown,
): { success: true; data: T } | { success: false; details: FieldError[] } {
  const result = schema.safeParse(data);
  if (!result.success) {
    return { success: false, details: formatZodError(result.error) };
  }
  return { success: true, data: result.data };
}
