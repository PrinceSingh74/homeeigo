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

  if (tool.category === "HIGH_RISK") {
    errors.push("High-risk tools cannot be executed directly by AI");
  }

  return errors.length ? { valid: false, errors } : { valid: true };
}

export function sanitizeToolId(toolId: string): string | null {
  if (!/^[a-z0-9._-]+$/i.test(toolId) || toolId.length > 128) return null;
  return toolId;
}

export function redactArguments(args: Record<string, unknown>): Record<string, unknown> {
  const sensitive = /password|secret|token|ssn|pan|card|cvv|pin/i;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (sensitive.test(k)) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      out[k] = redactArguments(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}
