/**
 * Phase 05 — the quote is authoritative server output, end to end:
 * quote lines add up; forged amounts are ignored; the booking charges the server total and refuses
 * a changed / expired / foreign quote instead of silently charging something else; the payment
 * order is created for exactly the booking amount; historical bookings keep their price; fixture
 * services are never quoted; coupon brute force is throttled; admin price edits are audited and
 * never erase unrelated configuration.
 *
 * Isolated test database only.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import {
  bearer,
  cleanupAdversarialFixtures,
  dbReachable,
  futureSlot,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { signQuote, selectionFingerprint } from "../lib/quote-token";
import { paymentService } from "../services/payment.service";
import { resetRateLimitSmart } from "../middleware/rate-limit.middleware";
import { sumCounter } from "../lib/metrics";
import { weatherService } from "../services/weather.service";
import { cacheService } from "../services/cache.service";

const RUN_ID = `pq-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
const extraServices: string[] = [];

type Res = { status: number; json: any };
async function call(method: string, path: string, body?: unknown, token?: string | null): Promise<Res> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await app.handle(
    new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
  );
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const customer = () => bearer(ctx.customerA);
const admin = () => bearer(ctx.superAdmin);

const CONFIG = {
  materialPolicy: "PROFESSIONAL_PROVIDED",
  equipmentPolicy: "PROFESSIONAL_PROVIDED",
  coverage: { pincodes: [] as string[] },
  materials: [{ name: "Cleaning kit", provider: "PROFESSIONAL" }],
  quantity: { type: "UNIT", unitLabel: "room", unitLabelPlural: "rooms", min: 1, max: 5, unitPrice: 250 },
  variants: [
    { id: "standard", name: "Standard", price: 250 },
    { id: "deep", name: "Deep", price: 400 },
  ],
  variantRequired: true,
  addons: [
    { id: "balcony", name: "Balcony", price: 99, compatibleVariantIds: ["deep"] },
    { id: "fan", name: "Fan", price: 49.5, maxQuantity: 3 },
  ],
};

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN_ID);
  const r = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { pricingModel: "per-unit", basePrice: 250, minPrice: 250, maxPrice: 250, catalogConfig: CONFIG }, admin());
  if (r.status !== 200) throw new Error(`setup: ${JSON.stringify(r.json)}`);
}, 90_000);

afterAll(async () => {
  if (!dbOk) return;
  for (const id of extraServices) await prisma.service.delete({ where: { id } }).catch(() => {});
  await cleanupAdversarialFixtures(RUN_ID);
}, 60_000);

const selection = { variantId: "deep", quantity: 2, addonIds: ["balcony", "fan"], addonQuantities: { fan: 2 } };
async function quote(extra: Record<string, unknown> = {}) {
  return call("POST", "/api/bookings/price-quote", { serviceId: ctx.serviceId, addressId: ctx.addressAId, ...selection, ...extra }, customer());
}

describe.serial("Phase 05 — authoritative quote", () => {
  test("lines add up to the payable total, in integer paise, with the tax policy stated", async () => {
    if (!dbOk) return;
    const r = await quote();
    expect(r.status).toBe(200);
    const q = r.json.data.quote;
    // 2 × ₹400 + ₹99 + 2 × ₹49.50 = ₹998 → tax 10% = ₹99.80 → rounded once, half-up = ₹100.
    expect(q.subtotalPaise).toBe(99800);
    expect(q.taxesPaise).toBe(10000);
    expect(q.finalAmountPaise).toBe(109800);
    expect(q.finalAmount).toBe(1098);
    expect(q.lines.reduce((s: number, l: { amountPaise: number }) => s + l.amountPaise, 0)).toBe(q.finalAmountPaise);
    expect(q.lines.map((l: { code: string }) => l.code)).toEqual(["SERVICE", "ADDON", "ADDON", "TAX"]);
    expect(q).toMatchObject({ currency: "INR", pricingVersion: "pricing.v2", tax: { mode: "EXCLUSIVE", rateBps: 1000 } });
    expect(q.freeDeliveryDiscount).toBe(0);
    expect(q.lines.some((l: { code: string }) => l.code === "DISCOUNT_FEE_WAIVER" || l.code === "FEE")).toBe(false);
    expect(typeof q.quoteToken).toBe("string");
  });

  test("weather surge is computed in integer paise at the quote layer (1.15× on ₹250 = ₹37.50 → ₹38)", async () => {
    if (!dbOk) return;
    // The float formula round(250 × (1.15 − 1)) = round(37.4999…) = ₹37 under-charged by a rupee.
    const original = { getByCoords: weatherService.getByCoords, surgeMultiplier: weatherService.surgeMultiplier };
    (weatherService as any).getByCoords = async () => ({ description: "Heavy rain" });
    (weatherService as any).surgeMultiplier = () => 1.15;
    try {
      const r = await call("POST", "/api/bookings/price-quote", {
        serviceId: ctx.serviceId, addressId: ctx.addressAId, variantId: "standard", quantity: 1, addonIds: [], lat: 28.62, lng: 77.37,
      }, customer());
      expect(r.status).toBe(200);
      const q = r.json.data.quote;
      const surge = q.lines.find((l: { code: string }) => l.code === "SURGE_WEATHER");
      expect(surge?.amountPaise).toBe(3800);
      // (25000 + 3800) × 10% = 2880 → ₹29 half-up
      expect(q.finalAmountPaise).toBe(25000 + 3800 + 2900);
      expect(q.lines.reduce((s: number, l: { amountPaise: number }) => s + l.amountPaise, 0)).toBe(q.finalAmountPaise);
    } finally {
      Object.assign(weatherService, original);
    }
  });

  test("a price that moves without a catalogue change (weather) is refused, never charged silently", async () => {
    if (!dbOk) return;
    // The service version is unchanged, so only the quoted-amount check (fp) can catch this.
    const original = { getByCoords: weatherService.getByCoords, surgeMultiplier: weatherService.surgeMultiplier };
    let multiplier = 1;
    (weatherService as any).getByCoords = async () => ({ description: "Clear" });
    (weatherService as any).surgeMultiplier = () => multiplier;
    try {
      const sel = { variantId: "standard", quantity: 1, addonIds: [] as string[] };
      const q = (await call("POST", "/api/bookings/price-quote", { serviceId: ctx.serviceId, addressId: ctx.addressAId, ...sel }, customer())).json.data.quote;
      expect(q.finalAmountPaise).toBe(27500); // ₹250 + 10% tax, no surge
      multiplier = 1.15; // rain starts between the quote and the booking
      const before = await prisma.booking.count({ where: { userId: ctx.customerA.id } });
      const b = await call("POST", "/api/bookings", {
        serviceId: ctx.serviceId, addressId: ctx.addressAId, scheduledDate: futureSlot(200).toISOString(), ...sel, quoteToken: q.quoteToken,
      }, customer());
      expect(b.status).toBe(409);
      expect(b.json.code).toBe("PRICE_CHANGED");
      expect(b.json.quote.finalAmountPaise).toBe(25000 + 3800 + 2900);
      expect(await prisma.booking.count({ where: { userId: ctx.customerA.id } })).toBe(before);
    } finally {
      Object.assign(weatherService, original);
    }
  });

  test("forged money fields in the request are ignored", async () => {
    if (!dbOk) return;
    const r = await quote({ finalAmount: 1, taxes: 0, discount: 999, price: 1, unitPrice: 1, membership: true, fees: 0 });
    expect(r.status).toBe(200);
    expect(r.json.data.quote.finalAmountPaise).toBe(109800);
  });

  test("an incompatible add-on never contributes to a quote", async () => {
    if (!dbOk) return;
    const r = await quote({ variantId: "standard" });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("INVALID_ADDON");
    expect(r.json.issues.map((i: { code: string }) => i.code)).toContain("ADDON_INCOMPATIBLE");
  });

  test("simultaneous quotes for the same selection agree to the paisa", async () => {
    if (!dbOk) return;
    const rs = await Promise.all(Array.from({ length: 8 }, () => quote()));
    expect(new Set(rs.map((r) => r.json.data?.quote?.finalAmountPaise)).size).toBe(1);
  });

  let bookingId = "";
  test("booking with the quote charges exactly the server total; the payment order uses it", async () => {
    if (!dbOk) return;
    const q = (await quote()).json.data.quote;
    const b = await call(
      "POST",
      "/api/bookings",
      { serviceId: ctx.serviceId, addressId: ctx.addressAId, scheduledDate: futureSlot(120).toISOString(), ...selection, quoteToken: q.quoteToken, finalAmount: 1 },
      customer(),
    );
    expect([200, 201]).toContain(b.status);
    bookingId = b.json.data.booking?.id ?? b.json.data.id;
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(row.finalAmount).toBe(1098);
    expect(Number(row.finalAmountPaise)).toBe(q.finalAmountPaise);
    expect((row.serviceConfigSnapshot as any).pricing).toMatchObject({ version: "pricing.v2", currency: "INR", finalAmountPaise: 109800 });
    const order = await paymentService.createOrder(ctx.customerA.id, bookingId);
    expect(order && !("error" in order)).toBe(true);
    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId } });
    expect(payment.amount).toBe(row.finalAmount);
  });

  test("a price change after the quote is refused with the new quote, never charged silently", async () => {
    if (!dbOk) return;
    const q = (await quote()).json.data.quote;
    const bump = await call("PUT", `/api/admin/services/${ctx.serviceId}`, {
      catalogConfig: { ...CONFIG, variants: [{ id: "standard", name: "Standard", price: 250 }, { id: "deep", name: "Deep", price: 450 }] },
      changeReason: "Deep clean price review",
    }, admin());
    expect(bump.status).toBe(200);
    const before = await prisma.booking.count({ where: { userId: ctx.customerA.id } });
    const b = await call(
      "POST",
      "/api/bookings",
      { serviceId: ctx.serviceId, addressId: ctx.addressAId, scheduledDate: futureSlot(130).toISOString(), ...selection, quoteToken: q.quoteToken },
      customer(),
    );
    expect(b.status).toBe(409);
    expect(b.json.code).toBe("PRICE_CHANGED");
    expect(b.json.quote.finalAmountPaise).toBe(Math.round((2 * 450 + 99 + 99) * 1.1) * 100);
    expect(await prisma.booking.count({ where: { userId: ctx.customerA.id } })).toBe(before);
  });

  test("the historical booking keeps its price after the catalogue change", async () => {
    if (!dbOk) return;
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(row.finalAmount).toBe(1098);
    expect((row.serviceSelection as any).variant).toEqual({ id: "deep", name: "Deep", price: 400 });
    expect((row.serviceConfigSnapshot as any).pricing.finalAmountPaise).toBe(109800);
  });

  test("the price change is audited with before/after, versions and reason", async () => {
    if (!dbOk) return;
    const logs = await prisma.activityLog.findMany({ where: { action: "ADMIN_ACTION" }, orderBy: { createdAt: "desc" }, take: 20 });
    const hit = logs.map((l) => JSON.parse(l.description ?? "{}")).find((d) => d.serviceId === ctx.serviceId && d.reason === "Deep clean price review");
    expect(hit).toMatchObject({ action: "SERVICE_CONFIG_VERSIONED", configChanged: true });
    expect(hit.version).toBe(hit.previousVersion + 1);
  });

  test("expired, tampered, foreign and different-selection quotes are refused", async () => {
    if (!dbOk) return;
    const body = { serviceId: ctx.serviceId, addressId: ctx.addressAId, scheduledDate: futureSlot(140).toISOString(), ...selection };
    const svc = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId } });
    const fp = (await quote()).json.data.quote.finalAmountPaise;
    const expired = signQuote(
      { uid: ctx.customerA.id, sid: ctx.serviceId, sv: svc.version, sel: selectionFingerprint(body), fp, pv: "pricing.v2" },
      Date.now() - 3_600_000,
    ).token;
    expect((await call("POST", "/api/bookings", { ...body, quoteToken: expired }, customer())).json.code).toBe("QUOTE_EXPIRED");
    const good = (await quote()).json.data.quote.quoteToken as string;
    expect((await call("POST", "/api/bookings", { ...body, quoteToken: `${good.split(".")[0]}.forged` }, customer())).json.code).toBe("QUOTE_INVALID");
    expect((await call("POST", "/api/bookings", { ...body, quantity: 3, quoteToken: good }, customer())).json.code).toBe("QUOTE_MISMATCH");
    const other = await call("POST", "/api/bookings", { ...body, addressId: ctx.addressBId, quoteToken: good }, bearer(ctx.customerB));
    expect(["QUOTE_MISMATCH", "ADDRESS_NOT_FOUND", "VALIDATION_ERROR"]).toContain(other.json.code ?? "VALIDATION_ERROR");
    expect(other.status).not.toBe(201);
  });

  test("every priced field is bound: changing any of them after the quote is refused, nothing booked", async () => {
    if (!dbOk) return;
    // A second address for the SAME customer: a legitimate address, just not the quoted one.
    const second = await prisma.address.create({
      data: { userId: ctx.customerA.id, label: "Office", addressLine1: "Tower B", city: "Noida", state: "UP", zipCode: "201301", latitude: 28.62, longitude: 77.37 },
    });
    // A twin with the identical priced configuration: the selection is valid there, so only the quote's
    // service binding (sid) can refuse the swap.
    const src = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId } });
    const other = await prisma.service.create({
      data: {
        name: `Twin ${RUN_ID}`, slug: `twin-${RUN_ID}`, description: src.description, category: src.category,
        basePrice: src.basePrice, minPrice: src.minPrice, maxPrice: src.maxPrice, currency: src.currency,
        estimatedDuration: src.estimatedDuration, pricingModel: src.pricingModel, partnerSlotPolicy: src.partnerSlotPolicy,
        catalogConfig: src.catalogConfig ?? undefined, availableCities: src.availableCities,
        lifecycleStatus: src.lifecycleStatus, configStatus: src.configStatus,
        isCustomerVisible: src.isCustomerVisible, isBookable: src.isBookable,
        categoryId: src.categoryId, subcategoryId: src.subcategoryId,
      },
    });
    extraServices.push(other.id);
    const q = (await quote()).json.data.quote;
    const base = { serviceId: ctx.serviceId, addressId: ctx.addressAId, scheduledDate: futureSlot(210).toISOString(), ...selection, quoteToken: q.quoteToken };
    const mutations: Array<[string, Record<string, unknown>]> = [
      ["quantity", { quantity: 3 }],
      ["variant", { variantId: "standard", addonIds: ["fan"] }],
      ["add-on set", { addonIds: ["balcony"], addonQuantities: {} }],
      ["add-on quantity", { addonQuantities: { fan: 3 } }],
      ["address", { addressId: second.id }],
      ["coupon", { couponCode: "WELCOME10" }],
      ["service", { serviceId: other.id }],
    ];
    const before = await prisma.booking.count({ where: { userId: ctx.customerA.id } });
    try {
      for (const [field, change] of mutations) {
        const r = await call("POST", "/api/bookings", { ...base, ...change }, customer());
        expect(r.status, field).not.toBe(201);
        expect(r.status, field).toBeLessThan(500);
        // The binding itself must be what refuses: an identical-config twin, a valid own address, a valid
        // add-on set — only the quote fingerprint / service binding differs.
        expect(r.json.code, field).toBe("QUOTE_MISMATCH");
      }
      expect(await prisma.booking.count({ where: { userId: ctx.customerA.id } })).toBe(before);
      // Duration is derived server-side: a client-supplied duration is ignored, the booking stores the resolver's.
      const ok = await call("POST", "/api/bookings", { ...base, estimatedDuration: 5, slotDurationMinutes: 5, durationMinutes: 5 }, customer());
      expect(ok.status).toBe(201);
      const row = await prisma.booking.findUniqueOrThrow({ where: { id: ok.json.data.booking?.id ?? ok.json.data.id } });
      expect(row.estimatedDuration).not.toBe(5);
      expect(row.slotDurationMinutes).not.toBe(5);
      expect(Number(row.finalAmountPaise)).toBe(q.finalAmountPaise);
    } finally {
      await prisma.address.delete({ where: { id: second.id } }).catch(() => {});
    }
  });

  test("an unpriced service is PRICING_CONFIG_MISSING, not a ₹0 quote", async () => {
    if (!dbOk) return;
    const s = await prisma.service.create({
      data: { name: `Unpriced ${RUN_ID}`, slug: `unpriced-${RUN_ID}`, description: "No price configured yet", category: "cleaning", basePrice: 0, estimatedDuration: 60, pricingModel: "quote" },
    });
    extraServices.push(s.id);
    const r = await call("POST", "/api/bookings/price-quote", { serviceId: s.id, addressId: ctx.addressAId }, customer());
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("PRICING_CONFIG_MISSING");
    // Fail closed everywhere: never advertised as bookable, never quoted, never booked.
    const res = await call("POST", `/api/services/${s.id}/resolve-selection`, {});
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("SERVICE_NOT_BOOKABLE");
    const detail = await call("GET", `/api/services/${s.id}`);
    expect(detail.json.data.service.bookable).toBe(false);
    const list = await call("GET", "/api/services?limit=100&sortBy=newest");
    expect(list.json.data.services.find((x: { id: string }) => x.id === s.id)?.bookable).toBe(false);
    const book = await call("POST", "/api/bookings", { serviceId: s.id, addressId: ctx.addressAId, scheduledDate: futureSlot(200).toISOString() }, customer());
    expect(book.status).toBe(400);
    expect(book.json.code).toBe("PRICING_CONFIG_MISSING");
    // The admin gate refuses to (re)publish it while unpriced …
    await prisma.service.update({ where: { id: s.id }, data: { isActive: false, lifecycleStatus: "DRAFT", isCustomerVisible: false, isBookable: false } });
    const publish = await call("POST", `/api/admin/services/${s.id}/lifecycle`, { to: "ACTIVE" }, admin());
    expect(publish.status).toBe(400);
    expect(publish.json.issues.map((i: { code: string }) => i.code)).toContain("PRICING_INCOMPLETE");
    // … and publishing works once a real price is configured.
    expect((await call("PUT", `/api/admin/services/${s.id}`, {
      basePrice: 450, minPrice: 450, maxPrice: 450,
      catalogConfig: { materialPolicy: "PROFESSIONAL_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED" },
    }, admin())).status).toBe(200);
    const pub2 = await call("POST", `/api/admin/services/${s.id}/lifecycle`, { to: "ACTIVE" }, admin());
    expect(pub2.status).toBe(200);
    const q = await call("POST", "/api/bookings/price-quote", { serviceId: s.id, addressId: ctx.addressAId }, customer());
    expect(q.status).toBe(200);
    expect(q.json.data.quote.finalAmountPaise).toBe(49500);
  });

  test("admin cannot create a live service without a price", async () => {
    if (!dbOk) return;
    const r = await call("POST", "/api/admin/services", {
      name: `Unpriced new ${RUN_ID}`, slug: `unpriced-new-${RUN_ID}`, description: "No price yet", category: "cleaning",
      basePrice: 0, estimatedDuration: 60, pricingModel: "quote",
      catalogConfig: { materialPolicy: "PROFESSIONAL_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED" },
    }, admin());
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("SERVICE_NOT_BOOKABLE");
    expect(r.json.issues.map((i: { code: string }) => i.code)).toContain("PRICING_INCOMPLETE");
  });

  test("fixture / test services never enter customer commercial truth", async () => {
    if (!dbOk) return;
    const s = await prisma.service.create({
      data: { name: `Fixture ${RUN_ID}`, slug: `fixture-${RUN_ID}`, description: "A fixture service", category: "cleaning", basePrice: 300, estimatedDuration: 60, dataOrigin: "INFERRED_FIXTURE" },
    });
    extraServices.push(s.id);
    expect((await call("GET", `/api/services/${s.id}`)).status).toBe(404);
    const list = await call("GET", "/api/services?limit=100&sortBy=newest");
    expect(list.json.data.services.some((x: { id: string }) => x.id === s.id)).toBe(false);
    const q = await call("POST", "/api/bookings/price-quote", { serviceId: s.id, addressId: ctx.addressAId }, customer());
    expect(q.status).toBe(400);
    expect(q.json.code).toBe("SERVICE_UNAVAILABLE");
    const search = await call("POST", "/api/services/search", { q: `Fixture ${RUN_ID}` });
    expect(search.json.data.services.length).toBe(0);
  });

  test("fixture services stay out of the secondary surfaces (public stats, provider profiles)", async () => {
    if (!dbOk) return;
    // Same row, flipped fixture → commercial: each surface must change, so the check cannot pass vacuously.
    const s = await prisma.service.create({
      data: { name: `Surface ${RUN_ID}`, slug: `surface-${RUN_ID}`, description: "Surface probe", category: "cleaning", basePrice: 300, estimatedDuration: 60, dataOrigin: "INFERRED_FIXTURE" },
    });
    extraServices.push(s.id);
    const provider = await prisma.provider.findUniqueOrThrow({ where: { id: ctx.providerId }, select: { serviceCategories: true } });
    await prisma.provider.update({ where: { id: ctx.providerId }, data: { serviceCategories: [...provider.serviceCategories, s.id] } });
    const partner = bearer({ id: ctx.vendorUserId, email: null });
    const surfaces = async () => {
      await cacheService.invalidate("stats:overview");
      const stats = await call("GET", "/api/stats/overview");
      const profile = await call("GET", `/api/providers/${ctx.providerId}`);
      const me = await call("GET", "/api/providers/me", undefined, partner);
      const names = (r: Res) => ((r.json.data?.services ?? r.json.data?.provider?.services ?? []) as Array<{ id: string }>).map((x) => x.id);
      return { count: stats.json.data.availableServices as number, profile: names(profile), me: names(me), statuses: [stats.status, profile.status, me.status] };
    };
    try {
      const asFixture = await surfaces();
      expect(asFixture.statuses).toEqual([200, 200, 200]);
      expect(asFixture.profile).not.toContain(s.id);
      expect(asFixture.me).not.toContain(s.id);
      await prisma.service.update({ where: { id: s.id }, data: { dataOrigin: null } });
      const asCommercial = await surfaces();
      expect(asCommercial.count).toBe(asFixture.count + 1);
      expect(asCommercial.profile).toContain(s.id);
      expect(asCommercial.me).toContain(s.id);
    } finally {
      await prisma.provider.update({ where: { id: ctx.providerId }, data: { serviceCategories: provider.serviceCategories } });
      await cacheService.invalidate("stats:overview");
    }
  });

  test("coupon brute force is throttled; the quote itself keeps working", async () => {
    if (!dbOk) return;
    await resetRateLimitSmart(`coupon-fail:${ctx.customerA.id}`);
    const errors: string[] = [];
    for (let i = 0; i < 12; i++) errors.push((await quote({ couponCode: `NOPE${i}${RUN_ID}` })).json.data?.quote?.couponError);
    expect(errors.slice(0, 10).every((e) => e === "INVALID_CODE")).toBe(true);
    expect(errors.slice(10)).toEqual(["COUPON_RATE_LIMITED", "COUPON_RATE_LIMITED"]);
    const plain = await quote();
    expect(plain.status).toBe(200);
    await resetRateLimitSmart(`coupon-fail:${ctx.customerA.id}`);
  });

  test("an admin price edit without config keeps unrelated configuration", async () => {
    if (!dbOk) return;
    const r = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { basePrice: 260, minPrice: 250, maxPrice: 260 }, admin());
    expect(r.status).toBe(200);
    const cfg = (await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId } })).catalogConfig as any;
    expect(cfg.materials).toEqual([{ name: "Cleaning kit", provider: "PROFESSIONAL" }]);
    expect(cfg.addons.find((a: { id: string }) => a.id === "balcony").compatibleVariantIds).toEqual(["deep"]);
  });

  test("invalid prices are refused at the authority", async () => {
    if (!dbOk) return;
    const bad = async (body: unknown) => (await call("PUT", `/api/admin/services/${ctx.serviceId}`, body, admin())).status;
    expect([400, 422]).toContain(await bad({ basePrice: -5 }));
    expect(await bad({ minPrice: 900, basePrice: 260 })).toBe(400);
    expect(await bad({ basePrice: 10.005 })).toBe(400);
    expect(await bad({ catalogConfig: { ...CONFIG, variants: [{ id: "deep", name: "Deep", price: -1 }] } })).toBe(400);
    expect(await bad({ catalogConfig: { ...CONFIG, addons: [{ id: "fan", name: "Fan", price: 49.999 }] } })).toBe(400);
    await expect(
      Promise.resolve(prisma.service.update({ where: { id: ctx.serviceId }, data: { basePrice: 10.005 } })),
    ).rejects.toThrow(/services_price_paise_precision/);
  });

  test("two admins saving prices against the same version: exactly one wins", async () => {
    if (!dbOk) return;
    const v = (await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId } })).version;
    const rs = await Promise.all([270, 280].map((p) => call("PUT", `/api/admin/services/${ctx.serviceId}`, { basePrice: p, maxPrice: p, expectedVersion: v }, admin())));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  test("customers and partners cannot change prices or read the advisory pricing engine", async () => {
    if (!dbOk) return;
    const partner = bearer({ id: ctx.vendorUserId, email: `${RUN_ID}@partner.test` });
    for (const t of [customer(), partner, null]) {
      expect([401, 403]).toContain((await call("PUT", `/api/admin/services/${ctx.serviceId}`, { basePrice: 1 }, t)).status);
    }
    const q = "baseFare=100&fromLat=28.6&fromLng=77.2&toLat=28.61&toLng=77.21";
    expect([401, 403]).toContain((await call("GET", `/api/pricing/quote?${q}`, undefined, customer())).status);
    expect([401, 403]).toContain((await call("GET", `/api/pricing/quote?${q}`, undefined, partner)).status);
    expect((await call("GET", `/api/pricing/quote?${q}`)).status).toBe(401);
  });

  test("the partner sees what was sold, not the pricing internals", async () => {
    if (!dbOk) return;
    await prisma.booking.update({ where: { id: bookingId }, data: { providerId: ctx.providerId } });
    const r = await call("GET", `/api/bookings/${bookingId}`, undefined, bearer({ id: ctx.vendorUserId, email: `${RUN_ID}@partner.test` }));
    expect(r.status).toBe(200);
    const body = JSON.stringify(r.json);
    for (const k of ["quoteToken", "membershipCouponId", "pricingVersion", "\"lines\"", "catalogConfig", "campaignId"]) expect(body).not.toContain(k);
    const job = r.json.data.booking?.job ?? r.json.data.job;
    expect(job).toMatchObject({ variant: "Deep", quantity: 2 });
  });

  test("mobile-style quote (lat/lng + addressId) books with its token; a quote without the address cannot", async () => {
    if (!dbOk) return;
    const when = futureSlot(150).toISOString();
    const withAddr = (await call("POST", "/api/bookings/price-quote", { serviceId: ctx.serviceId, addressId: ctx.addressAId, lat: 28.6, lng: 77.2, ...selection }, customer())).json.data.quote;
    const noAddr = (await call("POST", "/api/bookings/price-quote", { serviceId: ctx.serviceId, lat: 28.6, lng: 77.2, ...selection }, customer())).json.data.quote;
    const body = { serviceId: ctx.serviceId, addressId: ctx.addressAId, scheduledDate: when, ...selection };
    expect((await call("POST", "/api/bookings", { ...body, quoteToken: noAddr.quoteToken }, customer())).json.code).toBe("QUOTE_MISMATCH");
    const ok = await call("POST", "/api/bookings", { ...body, quoteToken: withAddr.quoteToken }, customer());
    expect([200, 201]).toContain(ok.status);
  });

  test("canonical selection: omitted default quantity and reordered add-ons are the same quote", async () => {
    if (!dbOk) return;
    const svc = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId } });
    const cfg = svc.catalogConfig as any;
    await prisma.service.update({ where: { id: ctx.serviceId }, data: { catalogConfig: { ...cfg, quantity: { ...cfg.quantity, default: 2 } } } });
    const q = (await call("POST", "/api/bookings/price-quote", { serviceId: ctx.serviceId, addressId: ctx.addressAId, variantId: "deep", addonIds: ["fan", "balcony"], addonQuantities: { fan: 2 } }, customer())).json.data.quote;
    const b = await call("POST", "/api/bookings", {
      serviceId: ctx.serviceId, addressId: ctx.addressAId, scheduledDate: futureSlot(160).toISOString(),
      variantId: "deep", quantity: 2, addonIds: ["balcony", "fan"], addonQuantities: { fan: 2 }, quoteToken: q.quoteToken,
    }, customer());
    expect([200, 201]).toContain(b.status);
    await prisma.service.update({ where: { id: ctx.serviceId }, data: { catalogConfig: cfg } });
  });

  test("a quote replayed by another customer (own address) is refused", async () => {
    if (!dbOk) return;
    const q = (await quote()).json.data.quote;
    const r = await call("POST", "/api/bookings", {
      serviceId: ctx.serviceId, addressId: ctx.addressBId, scheduledDate: futureSlot(170).toISOString(), ...selection, quoteToken: q.quoteToken,
    }, bearer(ctx.customerB));
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("QUOTE_MISMATCH");
  });

  test("a republished service (same price) invalidates the quote", async () => {
    if (!dbOk) return;
    const q = (await quote()).json.data.quote;
    // Duration change bumps the version but not the price.
    const svc = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId } });
    const up = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { estimatedDuration: svc.estimatedDuration + 15 }, admin());
    expect(up.status).toBe(200);
    const r = await call("POST", "/api/bookings", {
      serviceId: ctx.serviceId, addressId: ctx.addressAId, scheduledDate: futureSlot(180).toISOString(), ...selection, quoteToken: q.quoteToken,
    }, customer());
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("PRICE_CHANGED");
    expect(r.json.quote.finalAmountPaise).toBe(q.finalAmountPaise);
  });

  test("payment route ignores a forged amount and charges the booking total", async () => {
    if (!dbOk) return;
    const q = (await quote()).json.data.quote;
    const b = await call("POST", "/api/bookings", {
      serviceId: ctx.serviceId, addressId: ctx.addressAId, scheduledDate: futureSlot(190).toISOString(), ...selection, quoteToken: q.quoteToken,
    }, customer());
    expect([200, 201]).toContain(b.status);
    const id = b.json.data.booking?.id ?? b.json.data.id;
    const mismatchBefore = sumCounter("payment_amount_mismatch_attempt_total");
    const o = await call("POST", "/api/payments/create-order", { bookingId: id, amount: 1 }, customer());
    expect(o.status).toBe(200);
    // The forged amount is observable (counted once), and never charged.
    expect(sumCounter("payment_amount_mismatch_attempt_total")).toBe(mismatchBefore + 1);
    // Gateway order amount is in paise and equals the quote total — never the forged ₹1.
    expect(o.json.data.amount).toBe(q.finalAmountPaise);
    const pay = await prisma.payment.findFirstOrThrow({ where: { bookingId: id } });
    expect(pay.amount).toBe(q.finalAmount);
    // A second create-order for the same booking reuses the same payment (no double charge state).
    const again = await call("POST", "/api/payments/create-order", { bookingId: id, amount: 2 }, customer());
    expect(again.status).toBe(200);
    expect(again.json.data.amount).toBe(q.finalAmountPaise);
    expect(await prisma.payment.count({ where: { bookingId: id } })).toBe(1);
    // The correct total in either unit is not an attempt.
    const matchedBefore = sumCounter("payment_amount_mismatch_attempt_total");
    await call("POST", "/api/payments/create-order", { bookingId: id, amount: q.finalAmount }, customer());
    await call("POST", "/api/payments/create-order", { bookingId: id, amount: q.finalAmountPaise }, customer());
    expect(sumCounter("payment_amount_mismatch_attempt_total")).toBe(matchedBefore);
  });
});
