/**
 * Track screen polling probe — mirrors refetchInterval logic from track/[bookingId].tsx.
 *
 *   node scripts/track-perf-probe.mjs
 */
const API = process.env.BACKEND_ORIGIN ?? "http://localhost:3000";
const WINDOW_MS = Number(process.env.PROBE_WINDOW_MS ?? 65_000);
const CUSTOMER = { email: "customer@homigo.demo", password: "Homigo@123" };

async function login() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...CUSTOMER, setAuthCookies: false }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(`login failed: ${JSON.stringify(json)}`);
  return json.data.accessToken;
}

async function findTrackableBooking(token) {
  const res = await fetch(`${API}/api/users/bookings?limit=20`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  const rows = json.data?.bookings ?? [];
  const hit = rows.find((b) =>
    ["accepted", "in_progress", "confirmed"].includes(String(b.status ?? "").toLowerCase()),
  );
  return hit?.id ?? rows[0]?.id ?? null;
}

function wsUrl(bookingId, token) {
  const base = API.replace(/^http/i, "ws").replace(/\/$/, "");
  return `${base}/ws/tracking/${bookingId}?token=${encodeURIComponent(token)}`;
}

async function countPolls({ intervalMs, gateOnWs }) {
  const token = await login();
  const bookingId = await findTrackableBooking(token);
  if (!bookingId) {
    return { ok: false, error: "no_booking_for_customer" };
  }

  let wsConnected = false;
  let polls = 0;
  const ws = new WebSocket(wsUrl(bookingId, token));

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("ws open timeout")), 15_000);
    ws.addEventListener("open", () => {
      wsConnected = true;
      clearTimeout(t);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(t);
      reject(new Error("ws error"));
    });
  });

  const pollOnce = async () => {
    const res = await fetch(`${API}/api/tracking/${bookingId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.ok) polls += 1;
  };

  const timer = setInterval(() => {
    const shouldPoll = gateOnWs ? !wsConnected : true;
    if (shouldPoll) void pollOnce();
  }, intervalMs);

  await new Promise((r) => setTimeout(r, WINDOW_MS));
  clearInterval(timer);
  ws.close();

  const perMin = (polls / WINDOW_MS) * 60_000;
  return {
    ok: true,
    bookingId,
    wsConnectedDuringWindow: wsConnected,
    intervalMs,
    gateOnWs,
    tracking_api_calls_total: polls,
    tracking_api_calls_per_min: Math.round(perMin * 10) / 10,
    windowMs: WINDOW_MS,
  };
}

async function main() {
  const before = await countPolls({ intervalMs: 5_000, gateOnWs: false });
  const after = await countPolls({ intervalMs: 30_000, gateOnWs: true });

  console.log(
    JSON.stringify(
      {
        scenario_before_legacy: before,
        scenario_after_fixed: after,
        target: "WS OR poll — not both when connected",
        pass:
          before.ok &&
          after.ok &&
          after.wsConnectedDuringWindow &&
          after.tracking_api_calls_total === 0 &&
          before.tracking_api_calls_per_min > 8,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
