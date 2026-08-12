/**
 * API cold vs warm cache benchmark with evidence output.
 */
const API = process.env.API_URL ?? "http://localhost:3000";
const TS = new Date().toISOString();

const endpoints = [
  { name: "services", path: "/api/services" },
  { name: "stats", path: "/api/stats/overview" },
  { name: "featured", path: "/api/services/featured" },
];

async function timeOnce(url: string) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
  const body = await res.arrayBuffer();
  return {
    ms: Math.round(performance.now() - t0),
    status: res.status,
    bytes: body.byteLength,
  };
}

const results = [];
for (const ep of endpoints) {
  const url = `${API}${ep.path}`;
  const cold = await timeOnce(`${url}?_bust=${Date.now()}`);
  const warmSamples: number[] = [];
  for (let i = 0; i < 10; i++) {
    const s = await timeOnce(url);
    warmSamples.push(s.ms);
  }
  warmSamples.sort((a, b) => a - b);
  results.push({
    endpoint: ep.name,
    path: ep.path,
    timestamp: TS,
    cold,
    warm: {
      p50Ms: warmSamples[Math.floor(warmSamples.length * 0.5)]!,
      p95Ms: warmSamples[Math.floor(warmSamples.length * 0.95)]!,
      samples: warmSamples,
    },
  });
}

const out = "c:/Users/Kapiissh Green/OneDrive/Desktop/homigo/measurements/api-cache-benchmark.json";
await Bun.write(out, JSON.stringify({ timestamp: TS, results }, null, 2));
console.log(JSON.stringify(results, null, 2));
