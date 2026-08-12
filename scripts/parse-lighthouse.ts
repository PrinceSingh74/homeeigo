import { readFileSync } from "node:fs";
import { join } from "node:path";

const files = process.argv.slice(2);
for (const f of files) {
  const j = JSON.parse(readFileSync(f, "utf8"));
  const a = j.audits;
  const pick = (id: string) => ({
    ms: a[id]?.numericValue ?? null,
    display: a[id]?.displayValue ?? null,
    score: a[id]?.score ?? null,
  });
  console.log(f);
  console.log(JSON.stringify({
    url: j.finalUrl,
    fetchTime: j.fetchTime,
    performanceScore: j.categories?.performance?.score ?? null,
    fcp: pick("first-contentful-paint"),
    lcp: pick("largest-contentful-paint"),
    cls: pick("cumulative-layout-shift"),
    tbt: pick("total-blocking-time"),
    ttfb: pick("server-response-time"),
    speedIndex: pick("speed-index"),
    inp: pick("interaction-to-next-paint"),
  }, null, 2));
}
