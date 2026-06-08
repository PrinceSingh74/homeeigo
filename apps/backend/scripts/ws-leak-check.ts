/**
 * One-off WS cleanup verification (not part of the smoke suite).
 * - Opens N booking-WS connections, confirms count rises by N.
 * - Closes them, confirms count returns to the baseline (identity removal +
 *   connectionMap/set pruning).
 * - Confirms a connection survives >40s (no forced heartbeat disconnect).
 */
const BASE = process.env.API_URL ?? "http://localhost:3000";
const WS_BASE = BASE.replace(/^http/i, "ws");

async function login(email: string, password: string): Promise<string> {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, setAuthCookies: false }),
  });
  const j = (await r.json()) as { data?: { accessToken?: string } };
  if (!j.data?.accessToken) throw new Error(`login failed (${r.status})`);
  return j.data.accessToken;
}

async function totalConnections(): Promise<number> {
  const r = await fetch(`${BASE}/api/v1/ws/stats`);
  const j = (await r.json()) as { data: { totalConnections: number } };
  return j.data.totalConnections;
}

function openWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(e);
    setTimeout(() => reject(new Error("ws open timeout")), 5000);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const token = await login("customer@homigo.demo", "Homigo@123");
  const bookingId = "ws-leak-test-booking";
  const url = `${WS_BASE}/ws/booking/${bookingId}?token=${encodeURIComponent(token)}`;

  const baseline = await totalConnections();
  console.log(`baseline totalConnections = ${baseline}`);

  const N = 10;
  const sockets: WebSocket[] = [];
  for (let i = 0; i < N; i++) sockets.push(await openWs(url));
  await sleep(500);
  const afterOpen = await totalConnections();
  console.log(`after opening ${N} = ${afterOpen}  (expected ~${baseline + N})`);

  for (const s of sockets) s.close();
  await sleep(1500);
  const afterClose = await totalConnections();
  console.log(`after closing ${N} = ${afterClose}  (expected ~${baseline})`);

  // Reconnect / no-forced-disconnect check: open one, hold >40s, ensure still open.
  console.log("holding 1 connection for 45s to confirm no forced heartbeat disconnect...");
  const longLived = await openWs(url);
  let closedCode: number | null = null;
  longLived.onclose = (e) => {
    closedCode = e.code;
  };
  await sleep(45_000);
  const stillOpen = longLived.readyState === WebSocket.OPEN && closedCode === null;
  console.log(`after 45s: stillOpen=${stillOpen} readyState=${longLived.readyState} closeCode=${closedCode}`);
  longLived.close();
  await sleep(1000);
  const finalCount = await totalConnections();
  console.log(`final totalConnections = ${finalCount}  (expected ~${baseline})`);

  const leakOk = afterOpen >= baseline + N - 1 && afterClose <= baseline + 1;
  const reconnectOk = stillOpen;
  const finalOk = finalCount <= baseline + 1;

  console.log(
    JSON.stringify({
      result: {
        opened_delta_ok: leakOk,
        closed_back_to_baseline: afterClose <= baseline + 1,
        no_forced_disconnect_45s: reconnectOk,
        final_back_to_baseline: finalOk,
        PASS: leakOk && reconnectOk && finalOk,
      },
      counts: { baseline, afterOpen, afterClose, finalCount },
    }, null, 2),
  );
  process.exit(leakOk && reconnectOk && finalOk ? 0 : 1);
}

main().catch((e) => {
  console.error("ws-leak-check failed:", e);
  process.exit(1);
});
