/**
 * Parse bun test stdout and print file + test name for every (fail)/(error).
 * Usage: bun scripts/parse-bun-fails.ts < bun-test.log
 */
const text = await Bun.file("/dev/stdin").text();
const lines = text.split(/\r?\n/);
let currentFile = "(unknown)";
const fails: Array<{ file: string; name: string; kind: string }> = [];

for (const line of lines) {
  const fileMatch = line.match(/^((?:src|scripts)\/\S+\.(?:test|spec)\.ts):?\s*$/);
  if (fileMatch) {
    currentFile = fileMatch[1]!;
    continue;
  }
  const failMatch = line.match(/^\s*\((fail|error)\)\s+(.*?)(?:\s+\[[\d.]+m?s\])?\s*$/);
  if (failMatch) {
    fails.push({ file: currentFile, name: failMatch[2]!.trim(), kind: failMatch[1]! });
  }
}

const byFile = new Map<string, typeof fails>();
for (const f of fails) {
  const arr = byFile.get(f.file) ?? [];
  arr.push(f);
  byFile.set(f.file, arr);
}

console.log(`PARSE_FAILS count=${fails.length} files=${byFile.size}`);
for (const [file, items] of byFile) {
  console.log(`\nFILE ${file} (${items.length})`);
  for (const item of items) {
    console.log(`  ${item.kind} ${item.name}`);
  }
}
