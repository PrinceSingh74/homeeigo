/**
 * Part 5 — XSS Prevention (Input Sanitization).
 *
 * Dependency-free sanitization that runs under Bun without jsdom. The backend's
 * primary defense is to store escaped/stripped text and let React escape on
 * render; these helpers enforce that at the entry point.
 */

const HTML_ENTITY_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
};

/** Escape HTML-significant characters so input can never be interpreted as markup. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ENTITY_MAP[char] ?? char);
}

/** Remove all tags / angle brackets / quotes — for fields that must be plain. */
export function sanitizePlainText(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .replace(/["']/g, "")
    .trim();
}

/**
 * Sanitize free-text user input intended for storage/display:
 * trims, enforces a max length, and HTML-escapes.
 */
export function sanitizeUserInput(input: unknown, maxLength = 1000): string {
  if (typeof input !== "string") return "";
  const trimmed = input.trim().slice(0, maxLength);
  return escapeHtml(trimmed);
}

/** Lowercase + trim an email (does not validate — use the Zod schema for that). */
export function sanitizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Only allow http(s) URLs. Rejects `javascript:`, `data:`, `vbscript:` etc.
 * Returns null for anything unsafe or unparseable.
 */
export function sanitizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

const ALLOWED_TAGS = new Set(["b", "i", "em", "strong", "p", "br", "ul", "ol", "li", "a"]);
const ALLOWED_ATTRS = new Set(["href", "title"]);

/**
 * Conservative rich-text sanitizer for the rare case where limited markup is
 * allowed (e.g. formatted descriptions). Strips dangerous tags entirely,
 * removes every event handler / script-bearing attribute, and neutralises
 * non-http(s) hrefs. For most fields prefer `sanitizeUserInput`.
 */
export function sanitizeHtml(dirty: string): string {
  // Remove script/style/iframe/object/embed blocks and their contents outright.
  let clean = dirty.replace(
    /<\s*(script|style|iframe|object|embed|noscript)[\s\S]*?<\s*\/\s*\1\s*>/gi,
    "",
  );

  clean = clean.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^<>]*?))>/g, (match, rawTag, rawAttrs) => {
    const tag = String(rawTag).toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";

    const isClosing = match.startsWith("</");
    if (isClosing) return `</${tag}>`;

    const attrs: string[] = [];
    const attrRegex = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
      const name = attrMatch[1].toLowerCase();
      const value = attrMatch[3] ?? attrMatch[4] ?? "";
      if (name.startsWith("on")) continue; // strip event handlers
      if (!ALLOWED_ATTRS.has(name)) continue;
      if (name === "href") {
        const safe = sanitizeUrl(value);
        if (!safe) continue;
        attrs.push(`href="${escapeHtml(safe)}"`);
        continue;
      }
      attrs.push(`${name}="${escapeHtml(value)}"`);
    }

    return attrs.length ? `<${tag} ${attrs.join(" ")}>` : `<${tag}>`;
  });

  return clean.trim();
}

/**
 * Recursively sanitize an arbitrary JSON value (keys and string values) to
 * prevent stored-XSS through nested payloads. Non-string primitives pass
 * through untouched.
 */
export function sanitizeJson<T>(input: T): T {
  if (typeof input === "string") {
    return sanitizeUserInput(input) as unknown as T;
  }
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeJson(item)) as unknown as T;
  }
  if (input !== null && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([key, value]) => [
        sanitizePlainText(key),
        sanitizeJson(value),
      ]),
    ) as T;
  }
  return input;
}
