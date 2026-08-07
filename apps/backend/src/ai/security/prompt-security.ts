import crypto from "crypto";
import { AI_LIMITS } from "../types";
import { recordAiPromptBlocked } from "../../lib/ai-metrics";

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(your\s+)?(system|initial)\s+prompt/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /jailbreak/i,
  /DAN\s+mode/i,
  /reveal\s+(your\s+)?(system|secret|api)\s+(prompt|key)/i,
  /show\s+me\s+(the\s+)?system\s+prompt/i,
  /\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|UNION)\b.*\b(?:FROM|INTO|TABLE)\b/i,
  /<script[\s>]/i,
  /javascript:/i,
  /onerror\s*=/i,
];

const FORBIDDEN_INSTRUCTIONS = [
  "override safety",
  "bypass restrictions",
  "ignore homigo policies",
  "export database",
  "dump all users",
  "reveal api key",
  "reveal secret",
];

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/,
  /AIza[a-zA-Z0-9_-]{30,}/,
  /Bearer\s+[a-zA-Z0-9._-]{20,}/,
  /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/,
  /(?:password|api_key|apikey|secret)\s*[:=]\s*\S+/i,
];

export type PromptSecurityResult =
  | { safe: true; sanitized: string; promptHash: string }
  | { safe: false; reason: string; category: string };

export function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "").replace(/&[#\w]+;/g, " ");
}

function sanitizeMarkdown(input: string): string {
  return input
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "[image]")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

export function sanitizeInput(raw: string): string {
  let s = raw.trim();
  s = stripHtml(s);
  s = sanitizeMarkdown(s);
  s = s.replace(/\0/g, "");
  return s.slice(0, AI_LIMITS.maxMessageLength);
}

export function detectPromptInjection(input: string): string | null {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(input)) return `injection_pattern:${pattern.source.slice(0, 40)}`;
  }
  const lower = input.toLowerCase();
  for (const forbidden of FORBIDDEN_INSTRUCTIONS) {
    if (lower.includes(forbidden)) return `forbidden_instruction:${forbidden}`;
  }
  return null;
}

export function detectSecrets(input: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(input));
}

export function validatePromptSecurity(
  input: string,
  actorRole: string,
): PromptSecurityResult {
  if (!input || input.trim().length === 0) {
    return { safe: false, reason: "empty_message", category: "validation" };
  }
  if (input.length > AI_LIMITS.maxMessageLength) {
    recordAiPromptBlocked("length_exceeded", actorRole);
    return { safe: false, reason: "message_too_long", category: "length" };
  }

  const sanitized = sanitizeInput(input);
  const injection = detectPromptInjection(sanitized);
  if (injection) {
    recordAiPromptBlocked("injection", actorRole);
    return { safe: false, reason: injection, category: "injection" };
  }
  if (detectSecrets(sanitized)) {
    recordAiPromptBlocked("secret_leak", actorRole);
    return { safe: false, reason: "secret_detected_in_input", category: "secret" };
  }

  return { safe: true, sanitized, promptHash: hashContent(sanitized) };
}

/** Protect system prompt from user override attempts in context. */
export function isolateSystemPrompt(systemPrompt: string, userMessage: string): string {
  return [
    "=== SYSTEM (IMMUTABLE) ===",
    systemPrompt.slice(0, AI_LIMITS.maxSystemPromptLength),
    "=== END SYSTEM ===",
    "=== USER ===",
    userMessage,
    "=== END USER ===",
  ].join("\n");
}

export function redactSecretsFromOutput(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}
