const base = process.env.API_URL ?? "http://localhost:3000";
const wsBase = base.replace(/^http/i, "ws");

type ProbeResult = [string, string, number | string, boolean?];

const users = [
  { label: "customer", email: "customer@homigo.demo", password: "Homigo@123" },
  { label: "provider", email: "partner@homigo.demo", password: "Homigo@123" },
  { label: "admin", email: "admin@homigo.demo", password: "Homigo@123" },
];

async function req(path: string, init?: RequestInit) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = { raw: "<non-json>" };
  }
  return { status: res.status, body };
}

async function wsCheck(url: string): Promise<string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), 3000);
    const ws = new WebSocket(url);
    ws.onopen = () => {
      clearTimeout(timer);
      ws.close();
      resolve("open");
    };
    ws.onerror = () => {
      clearTimeout(timer);
      resolve("error");
    };
    ws.onclose = (event) => {
      if (event.code && event.code !== 1006) {
        clearTimeout(timer);
        resolve(`closed:${event.code}`);
      }
    };
  });
}

async function main() {
  const out: ProbeResult[] = [];

  for (const u of users) {
    const login = await req("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: u.email,
        password: u.password,
        setAuthCookies: false,
      }),
    });
    const token = (login.body.data as Record<string, unknown> | undefined)?.accessToken as string | undefined;
    out.push([u.label, "login", login.status, !!token]);
    if (!token) continue;

    const headers = { Authorization: `Bearer ${token}` };
    const checks =
      u.label === "customer"
        ? [
            ["/api/users/me", "GET"],
            ["/api/users/bookings?limit=5&page=1", "GET"],
            ["/api/wallet/balance", "GET"],
            ["/api/notifications?limit=5&page=1", "GET"],
          ]
        : u.label === "provider"
          ? [
              ["/api/bookings/upcoming", "GET"],
              ["/api/tracking/non-existent-id", "GET"],
              ["/api/wallet/withdraw", "POST", { amount: 100, bankAccountNumber: "1234567890", ifscCode: "SBIN0001234", accountHolder: "Smoke" }],
              ["/api/ratings/non-existent-id/respond", "POST", { response: "ok" }],
            ]
          : [
              ["/api/admin/dashboard", "GET"],
              ["/api/admin/users?limit=5&page=1", "GET"],
              ["/api/admin/providers?limit=5&page=1", "GET"],
              ["/api/admin/analytics?startDate=2026-01-01&endDate=2026-12-31", "GET"],
            ];

    for (const [path, method, body] of checks) {
      const res = await req(path as string, {
        method: method as string,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      out.push([u.label, path as string, res.status]);
    }

    for (const wsPath of ["/ws/notifications", "/ws/tracking/non-existent-id"]) {
      const wsResult = await wsCheck(`${wsBase}${wsPath}?token=${encodeURIComponent(token)}`);
      out.push([u.label, wsPath, wsResult]);
    }
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
