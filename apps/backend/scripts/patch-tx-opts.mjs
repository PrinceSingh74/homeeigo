import fs from "fs";

const path = process.argv[2];
const s0 = fs.readFileSync(path, "utf8");
const needle = "prisma.$transaction(async (tx) =>";
let s = s0;
let count = 0;
let i = 0;
while ((i = s.indexOf(needle, i)) !== -1) {
  const start = i + "prisma.$transaction".length;
  let depth = 0;
  let j = start;
  for (; j < s.length; j++) {
    const ch = s[j];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        const between = s.slice(start, j + 1);
        if (!between.includes("TX_OPTS")) {
          s = s.slice(0, j) + ", TX_OPTS" + s.slice(j);
          count++;
          j += ", TX_OPTS".length;
        }
        break;
      }
    }
  }
  i = j + 1;
}
fs.writeFileSync(path, s);
console.log(`patched ${count} transactions in ${path}`);
