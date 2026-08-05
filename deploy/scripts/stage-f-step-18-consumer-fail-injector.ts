/**
 * Step 18 consumer-failure cert sidecar — isolated staging Cloud Run service.
 * Uses Bun.serve (no Elysia) to avoid extra deps in job context.
 */
import { incCounter, renderMetrics } from "/app/src/lib/metrics.ts";

const DURATION_SEC = Number(process.env.STEP18_FAIL_DURATION_SEC ?? 900);
const RATE_PER_SEC = Number(process.env.STEP18_FAIL_RATE ?? 3);
const PORT = Number(process.env.PORT ?? 8080);

let running = true;
let injected = 0;

async function injectLoop() {
  const end = Date.now() + DURATION_SEC * 1000;
  while (running && Date.now() < end) {
    for (let i = 0; i < RATE_PER_SEC; i++) {
      incCounter("homigo_consumer_failed_total", {
        consumer: "step18.cert.v1",
        event_type: "cert.synthetic_fail",
      });
      injected++;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(JSON.stringify({ phase: "inject_complete", injected, durationSec: DURATION_SEC }));
}

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/health") {
      return Response.json({ ok: true, service: "step18-consumer-fail-injector", injected });
    }
    if (path === "/metrics") {
      return new Response(await renderMetrics(), {
        headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
      });
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(
  JSON.stringify({
    service: "step18-consumer-fail-injector",
    port: PORT,
    durationSec: DURATION_SEC,
    ratePerSec: RATE_PER_SEC,
    listening: server.port,
  }),
);

void injectLoop();

process.on("SIGTERM", () => {
  running = false;
  server.stop();
});
