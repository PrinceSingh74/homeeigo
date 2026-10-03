import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * X-70 (same class as X-38 on the customer app and X-69 on the partner app, both device-found): a
 * ScrollView / FlatList / SectionList with the default `keyboardShouldPersistTaps` swallows the
 * first tap while the keyboard is open — the tap only dismisses the keyboard, so "Send", "Redeem",
 * "Submit rating" or a result row needs a second tap and the first sends no request. Every
 * scrollable in a file that renders a TextInput must say how taps behave with the keyboard up.
 */
const ROOT = join(import.meta.dir, "..", "..");
const SCROLLABLES = /<(ScrollView|FlatList|SectionList|Animated\.ScrollView|Animated\.FlatList)\b/g;

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name === "test-utils" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

/** The JSX opening tag starting at `start` (braces balanced, `=>` is not a tag end). */
function openingTag(src: string, start: number): string {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0 && src[i - 1] !== "=") return src.slice(start, i + 1);
  }
  return src.slice(start);
}

export function scrollablesMissingTapPolicy(src: string): string[] {
  if (!/<TextInput\b/.test(src)) return [];
  const missing: string[] = [];
  for (const m of src.matchAll(SCROLLABLES)) {
    // `useRef<ScrollView>` / `FlatList<Item>` are TypeScript generics, not JSX elements.
    if (/[\w$.]/.test(src[m.index! - 1] ?? "")) continue;
    const tag = openingTag(src, m.index!);
    if (!/keyboardShouldPersistTaps/.test(tag)) {
      const line = src.slice(0, m.index!).split("\n").length;
      missing.push(`${m[1]}@${line}`);
    }
  }
  return missing;
}

describe("keyboard tap policy", () => {
  test("the sweep fires on the pattern it guards against", () => {
    const bad = `const r = useRef<ScrollView>(null);
<ScrollView contentContainerStyle={{ gap: 4 }} onScroll={(e) => f(e)}>\n<TextInput />\n</ScrollView>`;
    expect(scrollablesMissingTapPolicy(bad)).toEqual(["ScrollView@2"]);
    const good = `<ScrollView keyboardShouldPersistTaps="handled">\n<TextInput />\n</ScrollView>`;
    expect(scrollablesMissingTapPolicy(good)).toEqual([]);
  });

  test("every scrollable next to a TextInput declares keyboardShouldPersistTaps", () => {
    const offenders: string[] = [];
    for (const f of [...files(join(ROOT, "app")), ...files(join(ROOT, "src"))]) {
      for (const hit of scrollablesMissingTapPolicy(readFileSync(f, "utf8"))) {
        offenders.push(`${relative(ROOT, f).replace(/\\/g, "/")} ${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
