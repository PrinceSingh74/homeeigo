import { detectPromptInjection } from "../../ai/security/prompt-security";
import { fenceMemoryForPrompt } from "../../ai-brain/memory/memory-safety";
import { recordToolResultSanitized } from "../../lib/ai-tools-metrics";

/**
 * The boundary between a tool result and the model.
 *
 * Tool output is not ours. It carries booking notes, support messages, service and
 * provider descriptions, and third-party API text — all of it authored by someone with an
 * interest in what the assistant does next. A result that reaches the prompt unfenced is
 * an injection channel that bypasses every check applied to the user's own message,
 * because nobody screened the database on the way out.
 *
 * Phase 4 already solved the same problem for memory. The screening patterns and the
 * fencing helper are reused here rather than reimplemented, so a phrase blocked in one
 * path cannot slip through the other.
 */

/** Keys whose values are free text and therefore most likely to carry a payload. */
const HIGH_RISK_TEXT_KEYS = new Set([
  "description",
  "notes",
  "note",
  "message",
  "subject",
  "resolution",
  "reason",
  "instructions",
  "specialInstructions",
  "comment",
  "review",
  "summary",
  "title",
  "detailedDescription",
]);

/** Never forwarded to a model, whatever the tool returned. */
const NEVER_FORWARD_KEYS = new Set([
  "password",
  "passwordHash",
  "token",
  "accessToken",
  "refreshToken",
  "apiKey",
  "secret",
  "authorization",
  "aadharNumber",
  "panNumber",
  "bankAccountNumber",
  "bankIfscCode",
  "upiId",
  "taxIdHash",
  "aadharNumberHash",
  "panNumberHash",
  "bankAccountNumberHash",
  "upiIdHash",
  "encryptionKeyVersion",
  "addressPayloadHash",
]);

const REDACTED = "[redacted]";
const NEUTRALISED = "[removed: content resembling an instruction]";

export type SanitizedToolResult = {
  /** Structural copy of the result with secrets dropped and payloads neutralised. */
  data: unknown;
  /** True when at least one field was neutralised — surfaced for audit, not to the user. */
  injectionNeutralised: boolean;
  /** True when at least one field was dropped as never-forwardable. */
  secretsDropped: boolean;
};

function sanitizeValue(
  value: unknown,
  depth: number,
  flags: { injection: boolean; secrets: boolean },
): unknown {
  if (depth > 8) return null;

  if (typeof value === "string") {
    // Screened with the gateway's own pattern set. A hit is replaced rather than escaped:
    // the model has no need for the text, and a partial escape invites bypass research.
    if (detectPromptInjection(value)) {
      flags.injection = true;
      return NEUTRALISED;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((v) => sanitizeValue(v, depth + 1, flags));
  }

  if (value && typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (NEVER_FORWARD_KEYS.has(key)) {
        flags.secrets = true;
        out[key] = REDACTED;
        continue;
      }
      out[key] = sanitizeValue(v, depth + 1, flags);
    }
    return out;
  }

  return value;
}

/**
 * Strips secrets and neutralises injection payloads in a tool result.
 *
 * Structure is preserved so the model still sees the shape it was promised — a booking
 * with a neutralised note is more useful, and more honest, than a booking that silently
 * lost its note.
 */
export function sanitizeToolResult(toolId: string, result: unknown): SanitizedToolResult {
  const flags = { injection: false, secrets: false };
  const data = sanitizeValue(result, 0, flags);

  if (flags.injection || flags.secrets) {
    recordToolResultSanitized(toolId, flags.injection ? "injection" : "secret");
  }

  return { data, injectionNeutralised: flags.injection, secretsDropped: flags.secrets };
}

/**
 * Renders a sanitized result for the prompt, fenced as data.
 *
 * Fencing is the second layer: even text that passed screening is someone else's writing,
 * and must read as something the system retrieved rather than something it was told.
 */
export function renderToolResultForPrompt(toolId: string, sanitized: SanitizedToolResult): string {
  return fenceMemoryForPrompt([
    `Tool: ${toolId}`,
    `Result: ${JSON.stringify(sanitized.data)}`,
  ]);
}

/** Keys that must never be echoed into a prompt. Exported for the certification suite. */
export const NEVER_FORWARDED_KEYS = NEVER_FORWARD_KEYS;
export const HIGH_RISK_TEXT_FIELDS = HIGH_RISK_TEXT_KEYS;
