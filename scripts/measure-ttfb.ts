const routes: [string, string, string[]][] = [
  ["web-prod", "http://localhost:3011", ["/", "/services", "/login", "/legal/privacy", "/profile", "/wallet", "/ai"]],
  ["partner-prod", "http://localhost:3012", ["/", "/requests", "/earnings", "/analytics", "/wallet"]],
  ["admin-prod", "http://localhost:3003", ["/", "/bookings", "/fraud", "/operations"]],
];

for (const [app, base, paths] of routes) {
  for (const p of paths) {
    const t0 = performance.now();
    const res = await fetch(`${base}${p}`);
    const ms = Math.round(performance.now() - t0);
    const body = await res.text();
    console.log(`${app}\t${p}\t${ms}ms\t${res.status}\t${body.length}b`);
  }
}
