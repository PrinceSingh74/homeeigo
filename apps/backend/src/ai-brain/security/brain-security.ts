import { validatePromptSecurity, hashContent } from "../../ai/security/prompt-security";
import { validateAiOutput } from "../../ai/security/output-validator";
import { recordPromptBlocked } from "../../lib/ai-brain-metrics";

const PII_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  /\b(?:\+91|0)?[6-9]\d{9}\b/g,
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
];

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /AIza[a-zA-Z0-9_-]{35}/g,
  /Bearer\s+[a-zA-Z0-9._-]+/gi,
];

export function removePii(text: string): string {
  let cleaned = text;
  for (const pattern of PII_PATTERNS) {
    cleaned = cleaned.replace(pattern, "[REDACTED_PII]");
  }
  return cleaned;
}

export function detectSecrets(text: string): string[] {
  const found: string[] = [];
  for (const pattern of SECRET_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) found.push(...matches.map(() => "secret_detected"));
  }
  return found;
}

export function validateBrainInput(message: string, role: string): {
  safe: boolean;
  sanitized: string;
  reason?: string;
  promptHash: string;
} {
  const security = validatePromptSecurity(message, role as never);
  if (!security.safe) {
    recordPromptBlocked(security.reason ?? "injection", role);
    return { safe: false, sanitized: "", reason: security.reason, promptHash: hashContent(message) };
  }

  const secrets = detectSecrets(message);
  if (secrets.length > 0) {
    recordPromptBlocked("secret_detected", role);
    return { safe: false, sanitized: "", reason: "Secret detected in input", promptHash: security.promptHash };
  }

  return {
    safe: true,
    sanitized: removePii(security.sanitized),
    promptHash: security.promptHash,
  };
}

export async function validateBrainOutput(
  content: string,
  options?: { expectJson?: boolean; schema?: Record<string, unknown> },
): Promise<{ valid: boolean; content: string; reason?: string }> {
  const cleaned = removePii(content);
  const secrets = detectSecrets(cleaned);
  if (secrets.length > 0) {
    return { valid: false, content: cleaned, reason: "Secret detected in output" };
  }

  const output = await validateAiOutput(cleaned, {
    expectJson: options?.expectJson,
    schema: options?.schema,
    validateIds: true,
  });

  return {
    valid: output.valid,
    content: output.content,
    reason: output.reason,
  };
}

export function enforceTenantIsolation(
  actorId: string,
  resourceOwnerId: string | undefined,
  role: string,
): boolean {
  if (role === "ADMIN" || role === "SUPPORT" || role === "SYSTEM") return true;
  if (!resourceOwnerId) return true;
  return actorId === resourceOwnerId;
}
