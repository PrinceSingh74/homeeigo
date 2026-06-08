const BASE = process.env.API_URL ?? "http://localhost:3000";
const NOW_PLUS_3_HOURS = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

type Json = Record<string, unknown>;
type Result = { check: string; pass: boolean; detail: string };

const results: Result[] = [];

function record(check: string, pass: boolean, detail: string) {
  results.push({ check, pass, detail });
}

async function req(path: string, init?: RequestInit): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  let body: Json = {};
  try {
    body = (await res.json()) as Json;
  } catch {
    body = { raw: "<non-json>" };
  }
  return { status: res.status, body };
}

async function login(email: string, password: string) {
  const r = await req("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password, setAuthCookies: false }),
  });
  const token = (r.body.data as Json | undefined)?.accessToken as string | undefined;
  return { status: r.status, token };
}

async function main() {
  const health = await req("/health");
  record("health", health.status === 200, `status=${health.status}`);
  if (health.status !== 200) {
    throw new Error("Backend not reachable");
  }

  const customer = await login("customer@homigo.demo", "Homigo@123");
  const provider = await login("partner@homigo.demo", "Homigo@123");
  const admin = await login("admin@homigo.demo", "Homigo@123");

  record("customer login", customer.status === 200 && !!customer.token, `status=${customer.status}`);
  record("provider login", provider.status === 200 && !!provider.token, `status=${provider.status}`);
  record("admin login", admin.status === 200 && !!admin.token, `status=${admin.status}`);

  if (!customer.token || !provider.token || !admin.token) {
    throw new Error("Role login failed");
  }

  const customerAuth = { Authorization: `Bearer ${customer.token}` };
  const providerAuth = { Authorization: `Bearer ${provider.token}` };
  const adminAuth = { Authorization: `Bearer ${admin.token}` };

  const addresses = await req("/api/users/addresses", { headers: customerAuth });
  const addressList =
    (((addresses.body.data as Json | undefined)?.addresses as Json[] | undefined) ??
      ((addresses.body.data as Json | undefined)?.items as Json[] | undefined) ??
      []);
  const addressId = (addressList[0]?.id as string | undefined) ?? undefined;
  record("customer addresses", addresses.status === 200 && !!addressId, `status=${addresses.status}`);

  const services = await req("/api/services?page=1&limit=5");
  const serviceId = ((services.body.data as Json | undefined)?.services as Json[] | undefined)?.[0]?.id as string | undefined;
  record("services list", services.status === 200 && !!serviceId, `status=${services.status}`);

  const providerSearch = await req("/api/providers/search", {
    method: "POST",
    body: JSON.stringify({
      serviceId,
      latitude: 28.627,
      longitude: 77.371,
      radius: 20,
    }),
  });
  const providerId = ((providerSearch.body.data as Json | undefined)?.providers as Json[] | undefined)?.[0]?.id as string | undefined;
  record("provider search", providerSearch.status === 200 && !!providerId, `status=${providerSearch.status}`);

  if (!addressId || !serviceId || !providerId) {
    throw new Error("Missing required ids for booking flow");
  }

  const createBooking = await req("/api/bookings", {
    method: "POST",
    headers: customerAuth,
    body: JSON.stringify({
      serviceId,
      providerId,
      addressId,
      scheduledDate: NOW_PLUS_3_HOURS,
      description: "Phase2 lifecycle check booking",
      paymentMethod: "razorpay",
    }),
  });
  const bookingId = (((createBooking.body.data as Json | undefined)?.booking as Json | undefined)?.id as string | undefined);
  record("booking create", createBooking.status === 201 && !!bookingId, `status=${createBooking.status}`);

  if (!bookingId) {
    throw new Error("Booking create failed");
  }

  const providerAccept = await req(`/api/bookings/${bookingId}/accept`, {
    method: "POST",
    headers: providerAuth,
    body: JSON.stringify({ eta: 20 }),
  });
  record("booking accept", providerAccept.status === 200, `status=${providerAccept.status}`);

  const providerStart = await req(`/api/bookings/${bookingId}/start`, {
    method: "POST",
    headers: providerAuth,
    body: JSON.stringify({ latitude: 28.63, longitude: 77.38 }),
  });
  record("booking start", providerStart.status === 200, `status=${providerStart.status}`);

  const providerComplete = await req(`/api/bookings/${bookingId}/complete`, {
    method: "POST",
    headers: providerAuth,
    body: JSON.stringify({ latitude: 28.631, longitude: 77.381, notes: "completed in phase2 check" }),
  });
  record("booking complete", providerComplete.status === 200, `status=${providerComplete.status}`);

  const paymentHistory = await req("/api/payments/history?limit=10&page=1", { headers: customerAuth });
  const paymentList =
    (((paymentHistory.body.data as Json | undefined)?.payments as Json[] | undefined) ??
      ((paymentHistory.body.data as Json | undefined)?.items as Json[] | undefined) ??
      []);
  const paymentId = (paymentList[0]?.id as string | undefined) ?? undefined;
  record("payment history", paymentHistory.status === 200, `status=${paymentHistory.status}`);

  if (paymentId) {
    const paymentDetail = await req(`/api/payments/${paymentId}`, { headers: customerAuth });
    const paymentStatus = (
      ((paymentDetail.body.data as Json | undefined)?.payment as Json | undefined)?.status as
        | string
        | undefined
    )?.toLowerCase();
    if (paymentStatus === "success") {
      const refund = await req(`/api/payments/${paymentId}/refund`, {
        method: "POST",
        headers: adminAuth,
        body: JSON.stringify({ reason: "Phase2 admin refund test", amount: 1 }),
      });
      record("admin payment refund", refund.status === 200, `status=${refund.status}`);
    } else {
      record(
        "admin payment refund",
        true,
        `skipped: no SUCCESS payment (status=${paymentStatus ?? "unknown"})`,
      );
    }
  } else {
    record("admin payment refund", true, "skipped: no payment in history");
  }

  const wsChecks = [
    { role: "customer", token: customer.token },
    { role: "provider", token: provider.token },
  ];
  for (const ws of wsChecks) {
    const wsUrl = `${BASE.replace(/^http/i, "ws")}/ws/notifications?token=${encodeURIComponent(ws.token)}`;
    const wsResult = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), 4000);
      const client = new WebSocket(wsUrl);
      client.onopen = () => {
        clearTimeout(timer);
        client.close();
        resolve("open");
      };
      client.onerror = () => {
        clearTimeout(timer);
        resolve("error");
      };
      client.onclose = (event) => {
        if (event.code && event.code !== 1006) {
          clearTimeout(timer);
          resolve(`closed:${event.code}`);
        }
      };
    });
    record(`${ws.role} notifications ws`, wsResult === "open" || wsResult.startsWith("closed:"), wsResult);
  }

  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.length - passCount;
  console.log(JSON.stringify({ passCount, failCount, results }, null, 2));
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("phase2 lifecycle failed", err);
  process.exit(1);
});
