/**
 * Seeds one booking for customer2@homigo.demo (IDOR pentest / cross-user isolation).
 */
import prisma from "../src/lib/prisma";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";

async function login(email: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Homigo@123", setAuthCookies: false }),
  });
  const j = (await res.json()) as { data?: { accessToken?: string }; accessToken?: string };
  const token = j?.data?.accessToken ?? j?.accessToken;
  if (!token) throw new Error(`login failed for ${email}`);
  return token;
}

async function main() {
  const email = "customer2@homigo.demo";
  const token = await login(email);
  const user = await prisma.user.findFirstOrThrow({
    where: { email },
    select: { id: true, defaultAddressId: true, walletBalance: true },
  });
  const addressId =
    user.defaultAddressId ??
    (await prisma.address.findFirstOrThrow({ where: { userId: user.id }, select: { id: true } })).id;
  const service = await prisma.service.findFirstOrThrow({
    where: { isActive: true, basePrice: { lte: Math.min(user.walletBalance, 1500) } },
    select: { id: true, name: true },
  });
  const scheduledDate = new Date(Date.now() + 14 * 86_400_000);
  scheduledDate.setHours(10, 30, 0, 0);

  const res = await fetch(`${BASE}/api/bookings`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ serviceId: service.id, addressId, scheduledDate: scheduledDate.toISOString() }),
  });
  const j = (await res.json()) as { data?: { booking?: { id: string }; id?: string } };
  if (!res.ok) throw new Error(`create booking failed (${res.status}): ${JSON.stringify(j).slice(0, 200)}`);
  const bookingId = j.data?.booking?.id ?? j.data?.id;
  if (!bookingId) throw new Error("missing booking id");
  console.log(JSON.stringify({ email, bookingId, service: service.name }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
