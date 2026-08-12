import type { ToolDefinition } from "../types";

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /system\s*:\s*/i,
  /\bDROP\s+TABLE\b/i,
  /\bDELETE\s+FROM\b/i,
  /<script[\s>]/i,
  /\$\{.*\}/,
  /;\s*--/,
  /\bOR\s+1\s*=\s*1\b/i,
];

const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function validateToolArguments(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  options?: {
    /**
     * The caller supplied an approval id for this request.
     *
     * Deliberately named "presented", not "approved" — nothing here verifies it. It only
     * defers the blanket high-risk refusal to the approval gate, which does the real work.
     */
    approvalPresented?: boolean;
  },
): { valid: true } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  for (const key of Object.keys(args)) {
    if (BLOCKED_KEYS.has(key)) {
      errors.push(`Blocked parameter key: ${key}`);
    }
  }

  for (const param of tool.parameters) {
    if (param.required && (args[param.name] === undefined || args[param.name] === null)) {
      errors.push(`Missing required parameter: ${param.name}`);
    }
  }

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(value)) {
          errors.push(`Suspicious content in parameter: ${key}`);
          break;
        }
      }
      if (value.length > 10_000) {
        errors.push(`Parameter ${key} exceeds max length`);
      }
    }
  }

  // High-risk capabilities are refused outright unless the caller is presenting an
  // approval. Presenting one is NOT authorisation — the approval is verified and atomically
  // consumed further down the pipeline, and any failure there denies the request. This flag
  // only decides whether the blanket refusal applies or whether the real gate gets to run;
  // without it, an approved action could never execute no matter how it was authorised.
  if (tool.category === "HIGH_RISK" && !options?.approvalPresented) {
    errors.push("High-risk tools cannot be executed directly by AI");
  }

  return errors.length ? { valid: false, errors } : { valid: true };
}

export function sanitizeToolId(toolId: string): string | null {
  if (!/^[a-z0-9._-]+$/i.test(toolId) || toolId.length > 128) return null;
  return toolId;
}

/**
 * Key names whose values must never be stored in an approval preview.
 *
 * Deliberately broader than card data. An approval preview is written to
 * `ai_tool_approvals.arguments_preview` and rendered in the admin approval queue, so anything
 * matched here would otherwise sit at rest in the database and on a reviewer's screen. Indian
 * payment rails contribute most of the additions — a UPI VPA, a bank account with its IFSC, or an
 * Aadhaar number identifies a person as precisely as a card number does.
 */
const SENSITIVE_KEY =
  /password|secret|token|ssn|pan\b|card|cvv|cvc|pin\b|upi|vpa|aadhaar|aadhar|account|ifsc|iban|swift|routing|otp|api[_-]?key|apikey|authorization|auth[_-]?token|credential|passphrase|private[_-]?key/i;

/** 13–19 digits, optionally spaced or hyphenated — the shape of a payment card. */
const CARD_SHAPED = /\b(?:\d[ -]?){12,18}\d\b/g;

/**
 * Luhn check, so a free-text scrub does not mangle ordinary long numbers.
 *
 * Without it, any 13–19 digit run — an order reference, a timestamp in micros — would be
 * redacted, and a preview full of `[REDACTED]` teaches reviewers to ignore the redaction.
 */
function looksLikeCardNumber(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Scrubs card-shaped values out of free text, where no key name gives the contents away. */
function redactFreeText(value: string): string {
  return value.replace(CARD_SHAPED, (match) => {
    const digits = match.replace(/[ -]/g, "");
    return looksLikeCardNumber(digits) ? "[REDACTED]" : match;
  });
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactFreeText(value);
  // Arrays were previously copied verbatim, so a sensitive key nested inside one survived
  // redaction entirely — `instruments: [{ cvv }]` reached the database in full.
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value === "object" && value !== null) {
    return redactArguments(value as Record<string, unknown>);
  }
  return value;
}

export function redactArguments(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : redactValue(v);
  }
  return out;
}
