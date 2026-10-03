/**
 * Read JSON on stdin, print the value at a dot path. A repository-local stand-in for the one thing
 * the owner runbook used `jq` for, so a live-closure step does not depend on a tool that happens to
 * be installed on one machine (on this one it is not).
 *
 *   curl -s … | bun run scripts/json-get.ts data.accessToken
 *
 * It prints the value and nothing else, so it can sit inside `$(…)`. It fails LOUDLY — exit 1, the
 * reason on stderr, nothing on stdout — when the input is not JSON, the path does not exist, or the
 * value is not a string, number or boolean. `jq -r` prints `null` for a missing path and exits 0,
 * which is how a failed login becomes `Authorization: Bearer null` two commands later.
 */
import { readFileSync } from "node:fs";

const path = process.argv[2];

function fail(message: string): never {
  console.error(`json-get: ${message}`);
  process.exit(1);
}

if (!path) fail("usage: bun run scripts/json-get.ts <dot.path>   (JSON on stdin)");

let raw = "";
try {
  raw = readFileSync(0, "utf8"); // file descriptor 0: stdin
} catch {
  fail("could not read stdin — pipe the JSON into this command");
}
if (!raw.trim()) fail("stdin was empty — the command before the pipe produced no output");

let doc: unknown;
try {
  doc = JSON.parse(raw);
} catch {
  fail(`stdin is not JSON (it starts with: ${JSON.stringify(raw.trim().slice(0, 60))})`);
}

let cursor: unknown = doc;
const walked: string[] = [];
for (const key of path.split(".")) {
  walked.push(key);
  if (cursor === null || typeof cursor !== "object" || !(key in (cursor as Record<string, unknown>))) {
    const top = doc && typeof doc === "object" ? Object.keys(doc as object).join(", ") : typeof doc;
    fail(`"${walked.join(".")}" is not in the document. Top-level keys: ${top}`);
  }
  cursor = (cursor as Record<string, unknown>)[key];
}

if (typeof cursor !== "string" && typeof cursor !== "number" && typeof cursor !== "boolean") {
  fail(`"${path}" is ${cursor === null ? "null" : Array.isArray(cursor) ? "an array" : typeof cursor}, not a plain value`);
}
if (typeof cursor === "string" && cursor.length === 0) fail(`"${path}" is an empty string`);

process.stdout.write(String(cursor));
