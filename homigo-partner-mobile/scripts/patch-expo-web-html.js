import fs from "node:fs";
import path from "node:path";

const htmlPath = path.join(process.cwd(), "dist-e2e", "index.html");
let html = fs.readFileSync(htmlPath, "utf8");
const next = html.replace(
  /<script src="(\/_expo\/static\/js\/web\/[^"]+\.js)" defer><\/script>/,
  '<script type="module" src="$1"></script>',
);
if (next === html && !html.includes('type="module"')) {
  throw new Error("Could not patch Expo web index.html to load as an ES module");
}
fs.writeFileSync(htmlPath, next);
console.log("patched dist-e2e/index.html for import.meta (type=module)");
