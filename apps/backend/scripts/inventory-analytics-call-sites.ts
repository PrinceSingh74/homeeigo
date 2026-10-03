/**
 * Inventory of every aggregate query over a provenance-bearing model.
 *
 * DQ-7 is "adopt `analyticsWhere()`". The wrong way to close it is to add the predicate everywhere
 * the pattern matches: most of these call sites MUST see every row that exists. A reconciliation
 * that skips fixture rows cannot detect drift caused by fixture rows; a dispatcher that skips them
 * double-books their slots; a DSAR export that skips them breaks the law. Scoping is correct only
 * where the answer is a business statement about the real business.
 *
 * So this produces an inventory to classify by hand, not a codemod. For each call site it records
 * the enclosing function and a few signals that discriminate the categories — whether the query is
 * already narrowed to one entity, whether it is time-windowed, and what the file's role is.
 *
 * Read-only. Touches no database.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SEARCH_DIRS = ["src", "analytics"];

/** The three models that carry a `data_origin` column. */
const MODELS = ["booking", "user", "refundRequest"];
const OPS = ["count", "aggregate", "groupBy"];

const CALL = new RegExp(`prisma\\.(${MODELS.join("|")})\\.(${OPS.join("|")})\\b`);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === "generated") continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Nearest preceding function/method declaration — the unit a reader would judge. */
function enclosing(lines: string[], idx: number): string {
  for (let i = idx; i >= 0 && i > idx - 200; i--) {
    const m = lines[i]!.match(
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:^|\s)(?:private|public|protected|static|async)?\s*(\w+)\s*\([^)]*\)\s*(?::[^{]+)?\{|const\s+(\w+)\s*=\s*(?:async\s*)?\(/,
    );
    if (m) return m[1] || m[2] || m[3] || "?";
  }
  return "?";
}

type Row = {
  file: string;
  line: number;
  model: string;
  op: string;
  fn: string;
  scopedById: boolean;
  timeWindowed: boolean;
  /** The call collapsed onto one line, so 116 sites can be judged from one output. */
  snippet: string;
};

/** The call text from `prisma.` to the matching close paren, collapsed to one line. */
function balanced(lines: string[], idx: number): string {
  const text = lines.slice(idx, idx + 20).join(" ");
  const start = text.indexOf("prisma.");
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1).replace(/\s+/g, " ").slice(0, 190);
    }
  }
  return text.slice(start, start + 190).replace(/\s+/g, " ");
}

const rows: Row[] = [];

for (const dir of SEARCH_DIRS) {
  let files: string[];
  try {
    files = walk(join(ROOT, dir));
  } catch {
    continue;
  }
  for (const file of files) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    if (rel.includes("__tests__") || rel.endsWith("analytics-scope.ts")) continue;
    const text = readFileSync(file, "utf8");
    if (!CALL.test(text)) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i]!.match(CALL);
      if (!m) continue;
      // The argument object usually spans the next few lines.
      const window = lines.slice(i, i + 14).join("\n");
      rows.push({
        file: rel,
        line: i + 1,
        model: m[1]!,
        op: m[2]!,
        fn: enclosing(lines, i),
        scopedById: /\b(userId|customerId|providerId|bookingId|partnerId|id)\s*:/.test(window),
        timeWindowed: /\b(createdAt|completedAt|scheduledAt|dispatchedAt|updatedAt)\s*:/.test(window),
        snippet: balanced(lines, i),
      });
    }
  }
}

rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

if (process.argv.includes("--tsv")) {
  console.log("file\tline\tmodel\top\tfn\tscopedById\ttimeWindowed");
  for (const r of rows) {
    console.log([r.file, r.line, r.model, r.op, r.fn, r.scopedById, r.timeWindowed].join("\t"));
  }
} else {
  const byFile = new Map<string, Row[]>();
  for (const r of rows) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
  console.log(`call sites: ${rows.length}  files: ${byFile.size}`);
  console.log(`  already narrowed to one entity : ${rows.filter((r) => r.scopedById).length}`);
  console.log(`  time-windowed                  : ${rows.filter((r) => r.timeWindowed).length}`);
  console.log("");
  for (const [file, rs] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${String(rs.length).padStart(3)}  ${file}`);
    if (process.argv.includes("--detail")) {
      for (const r of rs) console.log(`     ${String(r.line).padStart(5)}  ${r.fn}  |  ${r.snippet}`);
    } else {
      console.log(`     ${[...new Set(rs.map((r) => r.fn))].join(", ")}`);
    }
  }
}
