/**
 * "Why this section does not apply" — form state ⇄ `catalogConfig.notApplicableReasons`.
 *
 * The publish gate (backend lib/service-domain.ts, `notApplicableReason`) lets an admin DECLARE that
 * safety or quality criteria do not apply, or that no materials / equipment are needed, by giving a
 * real reason. The reason is shown on the publish checklist and approved with the version.
 *
 * Pure: no React, no API types. The backend schema refuses an empty string, so a blank field is
 * never written — the key is removed instead.
 */

export const NOT_APPLICABLE_SECTIONS = ["safety", "quality", "materials", "equipment"] as const;
export type NotApplicableSection = (typeof NOT_APPLICABLE_SECTIONS)[number];

/** As stored: every key optional, none ever an empty string. */
export type NotApplicableReasons = Partial<Record<NotApplicableSection, string>>;
/** As edited: one string per section, "" when nothing is entered. */
export type NotApplicableReasonsForm = Record<NotApplicableSection, string>;

/** Mirrored from the backend schema (`text(500)`). */
export const NOT_APPLICABLE_REASON_MAX = 500;
/** Mirrored from the publish gate (`MIN_REASON_CHARS`): fewest letters and digits for a reason to count as one. */
export const NOT_APPLICABLE_REASON_MIN_CHARS = 10;

export function notApplicableReasonsFromConfig(stored?: NotApplicableReasons | null): NotApplicableReasonsForm {
  const read = (k: NotApplicableSection) => (typeof stored?.[k] === "string" ? (stored[k] as string) : "");
  return { safety: read("safety"), quality: read("quality"), materials: read("materials"), equipment: read("equipment") };
}

/**
 * Merged onto the stored object so a key this form does not model rides through. A blank field
 * removes its key; with no keys left the whole object is `undefined` (the caller deletes it).
 */
export function notApplicableReasonsToConfig(form: NotApplicableReasonsForm, base?: NotApplicableReasons | null): NotApplicableReasons | undefined {
  const out: Record<string, unknown> = { ...(base ?? {}) };
  for (const k of NOT_APPLICABLE_SECTIONS) {
    const text = form[k].trim();
    if (text) out[k] = text;
    else delete out[k];
  }
  return Object.keys(out).length ? (out as NotApplicableReasons) : undefined;
}

/**
 * Mirrored from the publish gate (`REASON_FILLER_WORDS`): words that only restate "this does not
 * apply" or name the section. A test compares this list with the backend's, word for word.
 */
export const NOT_APPLICABLE_REASON_FILLER_WORDS: ReadonlySet<string> = new Set([
  "not", "applicable", "apply", "applies", "na", "none", "nil", "nothing", "no", "null", "tbd", "todo", "test", "ok", "yes",
  "safety", "quality", "material", "materials", "equipment", "required", "needed", "need", "needs",
  "is", "are", "does", "do", "the", "this", "it", "to", "for", "of", "an", "here", "service",
]);

/** Mirrored from the publish gate (`NOT_APPLICABLE_REASON_RULE`), word for word: the same sentence the publish checklist shows. */
export const NOT_APPLICABLE_REASON_RULE =
  "A reason needs at least three different words (ten letters or more) that say why; “not applicable”, “none”, “not needed” and the section's own name are not a reason.";

/**
 * Mirrored from the publish gate (`isRealReason`): at least ten letters or digits, not one letter
 * repeated, at least three different words of two or more characters, and at least one of them
 * something other than the label words above.
 */
export function isRealNotApplicableReason(value: string): boolean {
  const text = value.trim().toLowerCase();
  const chars = text.match(/[\p{L}\p{N}]/gu) ?? [];
  if (chars.length < NOT_APPLICABLE_REASON_MIN_CHARS) return false;
  if (/\p{L}/u.test(text) && new Set(chars).size === 1) return false;
  // Marks are kept inside a word so scripts that write vowels as marks (Devanagari) are not split.
  const words = new Set(text.split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => /\p{L}/u.test(w) && new Set(w).size >= 2));
  if (words.size < 3) return false;
  return [...words].some((w) => !NOT_APPLICABLE_REASON_FILLER_WORDS.has(w));
}

/** What the publish gate would not accept as a reason. Empty is fine (a reason is optional). */
export function notApplicableReasonIssue(value: string): string | undefined {
  const text = value.trim();
  if (!text) return undefined;
  if (text.length > NOT_APPLICABLE_REASON_MAX) return `At most ${NOT_APPLICABLE_REASON_MAX} characters.`;
  if (!isRealNotApplicableReason(text)) return `Write the actual reason, or leave this empty. ${NOT_APPLICABLE_REASON_RULE}`;
  return undefined;
}

export function notApplicableReasonsIssues(form: NotApplicableReasonsForm): { section: NotApplicableSection; message: string }[] {
  const out: { section: NotApplicableSection; message: string }[] = [];
  for (const section of NOT_APPLICABLE_SECTIONS) {
    const message = notApplicableReasonIssue(form[section]);
    if (message) out.push({ section, message });
  }
  return out;
}
