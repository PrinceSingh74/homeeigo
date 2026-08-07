import prisma from "../../lib/prisma";
import { redactSecretsFromOutput } from "./prompt-security";

const CUID_PATTERN = /^c[a-z0-9]{24,}$/i;

export type OutputValidationResult =
  | { valid: true; content: string; parsed?: unknown }
  | { valid: false; reason: string };

export function validateOutputContent(content: string): OutputValidationResult {
  if (!content || content.trim().length === 0) {
    return { valid: false, reason: "empty_response" };
  }
  const redacted = redactSecretsFromOutput(content);
  return { valid: true, content: redacted };
}

export function validateJsonOutput(content: string, schema?: Record<string, unknown>): OutputValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { valid: false, reason: "invalid_json" };
  }
  if (schema && typeof parsed === "object" && parsed !== null) {
    const required = (schema.required as string[] | undefined) ?? [];
    for (const field of required) {
      if (!(field in (parsed as Record<string, unknown>))) {
        return { valid: false, reason: `missing_field:${field}` };
      }
    }
  }
  return { valid: true, content, parsed };
}

/** Reject hallucinated entity IDs not present in the database. */
export async function validateEntityReferences(content: string): Promise<OutputValidationResult> {
  const bookingMatches = content.match(/booking[_\s-]?id[:\s]+([a-z0-9]{20,})/gi) ?? [];
  const partnerMatches = content.match(/partner[_\s-]?id[:\s]+([a-z0-9]{20,})/gi) ?? [];

  for (const match of bookingMatches) {
    const id = match.split(/[:\s]+/).pop()?.trim();
    if (id && CUID_PATTERN.test(id)) {
      const exists = await prisma.booking.findUnique({ where: { id }, select: { id: true } });
      if (!exists) return { valid: false, reason: `invalid_booking_id:${id}` };
    }
  }

  for (const match of partnerMatches) {
    const id = match.split(/[:\s]+/).pop()?.trim();
    if (id && CUID_PATTERN.test(id)) {
      const exists = await prisma.provider.findUnique({ where: { id }, select: { id: true } });
      if (!exists) return { valid: false, reason: `invalid_partner_id:${id}` };
    }
  }

  return { valid: true, content };
}

export async function validateAiOutput(
  content: string,
  options?: { expectJson?: boolean; schema?: Record<string, unknown>; validateIds?: boolean },
): Promise<OutputValidationResult> {
  const base = validateOutputContent(content);
  if (!base.valid) return base;

  let result: OutputValidationResult = base;
  if (options?.expectJson) {
    result = validateJsonOutput(base.content, options.schema);
    if (!result.valid) return result;
  }

  if (options?.validateIds) {
    const idCheck = await validateEntityReferences(result.content);
    if (!idCheck.valid) return idCheck;
  }

  return result;
}
