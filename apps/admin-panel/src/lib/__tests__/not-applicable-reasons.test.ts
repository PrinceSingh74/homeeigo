/**
 * "Why this section does not apply" — the form ⇄ `catalogConfig.notApplicableReasons` mapping.
 * The backend schema refuses an empty string, and the publish gate refuses a placeholder, so an
 * empty field is never saved and a dash is reported before the save.
 *
 *   bun test src/lib/__tests__/not-applicable-reasons.test.ts   (from apps/admin-panel)
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NOT_APPLICABLE_REASON_FILLER_WORDS,
  NOT_APPLICABLE_REASON_MAX,
  NOT_APPLICABLE_REASON_RULE,
  notApplicableReasonIssue,
  notApplicableReasonsFromConfig,
  notApplicableReasonsIssues,
  notApplicableReasonsToConfig,
} from "../not-applicable-reasons";

const EMPTY = { safety: "", quality: "", materials: "", equipment: "" };

describe("notApplicableReasonsFromConfig", () => {
  test("a config without the key loads four empty fields", () => {
    expect(notApplicableReasonsFromConfig(undefined)).toEqual(EMPTY);
    expect(notApplicableReasonsFromConfig(null)).toEqual(EMPTY);
    expect(notApplicableReasonsFromConfig({})).toEqual(EMPTY);
  });
  test("stored reasons populate their fields; the others stay empty", () => {
    expect(notApplicableReasonsFromConfig({ safety: "Remote consultation only", equipment: "Advice by phone, no tools" })).toEqual({
      ...EMPTY,
      safety: "Remote consultation only",
      equipment: "Advice by phone, no tools",
    });
  });
  test("a stored value that is not a string loads as empty rather than crashing the form", () => {
    expect(notApplicableReasonsFromConfig({ quality: 7 as unknown as string })).toEqual(EMPTY);
  });
});

describe("notApplicableReasonsToConfig", () => {
  test("all fields empty → the key is removed (undefined), never an empty object", () => {
    expect(notApplicableReasonsToConfig(EMPTY)).toBeUndefined();
    expect(notApplicableReasonsToConfig({ safety: "  ", quality: "\n", materials: "", equipment: "\t" })).toBeUndefined();
  });
  test("only filled fields are written, trimmed; empty ones are omitted, not sent as empty strings", () => {
    const out = notApplicableReasonsToConfig({ ...EMPTY, safety: "  Remote consultation only  ", materials: "Nothing is consumed on a call" });
    expect(out).toEqual({ safety: "Remote consultation only", materials: "Nothing is consumed on a call" });
    expect(Object.keys(out!)).toEqual(["safety", "materials"]);
  });
  test("clearing a field removes a stored reason", () => {
    const base = { safety: "Remote consultation only", quality: "Nothing is delivered on site" };
    expect(notApplicableReasonsToConfig({ ...notApplicableReasonsFromConfig(base), safety: "" }, base)).toEqual({ quality: "Nothing is delivered on site" });
  });
  test("a key this form does not model rides through from the stored object", () => {
    const base = { safety: "Remote consultation only", future: "kept" } as Record<string, string>;
    const saved: Record<string, unknown> | undefined = notApplicableReasonsToConfig(notApplicableReasonsFromConfig(base), base);
    expect(saved).toEqual({ safety: "Remote consultation only", future: "kept" });
  });
  test("round trip: load then save gives the stored object back", () => {
    const base = { safety: "Remote consultation only", quality: "Nothing is delivered on site", materials: "Nothing is consumed", equipment: "Advice by phone, no tools" };
    expect(notApplicableReasonsToConfig(notApplicableReasonsFromConfig(base), base)).toEqual(base);
  });
});

describe("notApplicableReasonIssue mirrors the publish gate", () => {
  test("an empty field is fine — a reason is optional", () => {
    expect(notApplicableReasonIssue("")).toBeUndefined();
    expect(notApplicableReasonIssue("   ")).toBeUndefined();
  });
  test("a dash, n/a, a placeholder word or too little text is refused", () => {
    for (const v of ["-", "n/a", "N/A", "none", "tbd", "...", "no need", "a b c d e f g h i"]) expect(notApplicableReasonIssue(v), v).toBeDefined();
  });
  test("a real reason (at least 10 letters or digits) passes, in any script", () => {
    expect(notApplicableReasonIssue("Remote consultation only")).toBeUndefined();
    expect(notApplicableReasonIssue("केवल फ़ोन पर सलाह दी जाती है")).toBeUndefined();
  });

  // Adversarial audit, 2026-10-07 (finding 3). The two lists are the backend's own
  // (service-publish-governance.test.ts, "audit 3"): the editor must refuse and accept the same text.
  const JUNK = [
    "aaaaaaaaaaaa", "aaaa aaaa aaaa", "1234567890", "12345 67890 12345", "not applicable", "Not Applicable.", "n/a n/a n/a n/a n/a", "safety not applicable",
    "quality is not applicable", "not applicable to this service", "none none none none", "materials not required", "no equipment needed", "nothing needed here",
    "abcdefghij", "ab ab ab ab ab ab", "a b c d e f g h i j k l",
  ];
  const REAL = [
    "Remote video consultation: nobody is on site", "Advice only: there is no finished work to inspect", "A consultation: nothing is consumed", "A consultation: nothing is used",
    "Remote consultation only", "Advice by phone, no tools", "Nothing is delivered on site", "केवल फ़ोन पर सलाह दी जाती है", "No materials: the customer supplies the paint",
  ];
  test("repeated characters, digits only, and the label said again are refused — with the rule, in one sentence", () => {
    for (const reason of JUNK) expect({ reason, refused: notApplicableReasonIssue(reason) !== undefined }).toEqual({ reason, refused: true });
    expect(notApplicableReasonIssue("safety not applicable")).toContain(NOT_APPLICABLE_REASON_RULE);
    expect(NOT_APPLICABLE_REASON_RULE.split(/[.!?]\s/).length).toBe(1);
  });
  test("the real reasons the gate accepts are accepted here", () => {
    for (const reason of REAL) expect({ reason, issue: notApplicableReasonIssue(reason) }).toEqual({ reason, issue: undefined });
  });
  test("the rule sentence and the label words are the backend's, word for word", () => {
    const backend = readFileSync(join(import.meta.dir, "../../../../backend/src/lib/service-domain.ts"), "utf8");
    expect(backend).toContain(`"${NOT_APPLICABLE_REASON_RULE}"`);
    const block = /REASON_FILLER_WORDS = new Set\(\[([^\]]*)\]\)/.exec(backend)?.[1] ?? "";
    const backendWords = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(backendWords.length).toBeGreaterThan(20);
    expect([...NOT_APPLICABLE_REASON_FILLER_WORDS].sort()).toEqual(backendWords);
  });
  test("longer than the backend limit is refused", () => {
    // One letter repeated is no longer a reason, so the limit is measured with a real one.
    const atLimit = "Remote consultation only. ".repeat(40).slice(0, NOT_APPLICABLE_REASON_MAX);
    expect(atLimit.length).toBe(NOT_APPLICABLE_REASON_MAX);
    expect(notApplicableReasonIssue(atLimit)).toBeUndefined();
    expect(notApplicableReasonIssue(`${atLimit}x`)).toContain(String(NOT_APPLICABLE_REASON_MAX));
  });
  test("notApplicableReasonsIssues names the section of each bad field", () => {
    expect(notApplicableReasonsIssues({ ...EMPTY, safety: "Remote consultation only" })).toEqual([]);
    const bad = notApplicableReasonsIssues({ safety: "-", quality: "n/a", materials: "Nothing is consumed on a call", equipment: "tbd" });
    expect(bad.map((i) => i.section)).toEqual(["safety", "quality", "equipment"]);
  });
});
