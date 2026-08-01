import { Elysia, t } from "elysia";
import { z } from "zod";
import { authPlugin } from "../plugins/auth.plugin";
import { consumeRateLimitSmart } from "../middleware/rate-limit.middleware";
import { sanitizeUserInput } from "../utils/sanitizer";
import { coverageService, MANAGEABLE_CITY_STATUSES } from "../services/coverage.service";

/**
 * Hyperlocal Coverage Engine V1 — additive coverage-intelligence layer.
 * Public reads (city coverage, hyperlocal search) + public demand capture,
 * plus ADMIN-only coverage requests queue and intelligence dashboard.
 * Does not touch booking, catalog, or geo logic.
 */

const getIp = (request: Request) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  request.headers.get("x-real-ip") ||
  "unknown";

const requestSchema = z.object({
  name: z.string().trim().min(2).max(80),
  mobile: z
    .string()
    .trim()
    .regex(/^(\+91[\s-]?)?[6-9]\d{9}$/, "Enter a valid Indian mobile number"),
  city: z.string().trim().max(60).optional(),
  area: z.string().trim().min(2).max(120),
  society: z.string().trim().max(120).optional(),
  pincode: z
    .string()
    .trim()
    .regex(/^\d{6}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  source: z.string().trim().max(60).optional(),
});

const VALID_STATUSES = ["NEW", "REVIEWING", "PLANNED", "LAUNCHED", "DECLINED"] as const;

const routes = new Elysia({ prefix: "/api/coverage" })
  .use(authPlugin)

  // ── Public: city coverage summaries (services page cities grid) ──
  .get("/cities", async () => {
    const cities = await coverageService.cities();
    return { success: true, data: { cities, total: cities.length } };
  })

  // ── Public: full hyperlocal detail for one city (coverage explorer) ──
  .get("/cities/:slug", async ({ params, set }) => {
    const detail = await coverageService.cityDetail(params.slug);
    if (!detail) {
      set.status = 404;
      return { success: false, error: "City not covered yet", code: "CITY_NOT_FOUND" };
    }
    return { success: true, data: detail };
  })

  // ── Public: real-time coverage search (society / area / pincode) ──
  .get("/search", async ({ query, request, set }) => {
    const gate = await consumeRateLimitSmart(`coverage:search:${getIp(request)}`, 120, 60_000);
    if (!gate.allowed) {
      set.status = 429;
      return { success: false, error: "Too many requests", code: "RATE_LIMITED" };
    }
    const q = String(query.q ?? "").trim();
    if (q.length < 2) return { success: true, data: { results: [], query: q } };
    const results = coverageService.search(q, query.limit ? Number(query.limit) : 12);
    return { success: true, data: { results, query: q } };
  })

  // ── Public: demand capture for uncovered areas (rate-limited per IP) ──
  .post(
    "/requests",
    async ({ body, request, set }) => {
      const gate = await consumeRateLimitSmart(`coverage:req:${getIp(request)}`, 10, 60 * 60 * 1000);
      if (!gate.allowed) {
        set.status = 429;
        return { success: false, error: "Too many requests — try again later", code: "RATE_LIMITED" };
      }
      const parsed = requestSchema.safeParse(body);
      if (!parsed.success) {
        set.status = 400;
        return {
          success: false,
          error: parsed.error.issues[0]?.message ?? "Invalid request",
          code: "VALIDATION_ERROR",
        };
      }
      const d = parsed.data;
      const { request: created, duplicate } = await coverageService.createRequest({
        name: sanitizeUserInput(d.name, 80),
        mobile: d.mobile.replace(/[\s-]/g, ""),
        city: d.city ? sanitizeUserInput(d.city, 60) : undefined,
        area: sanitizeUserInput(d.area, 120),
        society: d.society ? sanitizeUserInput(d.society, 120) : undefined,
        pincode: d.pincode,
        source: d.source ? sanitizeUserInput(d.source, 60) : undefined,
      });
      set.status = duplicate ? 200 : 201;
      return { success: true, data: { id: created.id, duplicate } };
    },
    {
      body: t.Object({
        name: t.String(),
        mobile: t.String(),
        city: t.Optional(t.String()),
        area: t.String(),
        society: t.Optional(t.String()),
        pincode: t.Optional(t.String()),
        source: t.Optional(t.String()),
      }),
    },
  )

  // ── Admin: coverage requests queue ──
  .get("/requests", async ({ requireRole, query }) => {
    requireRole("ADMIN");
    const data = await coverageService.listRequests({
      status: typeof query.status === "string" ? query.status : undefined,
      search: typeof query.search === "string" ? query.search : undefined,
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    });
    return { success: true, data };
  })

  .patch(
    "/requests/:id",
    async ({ requireRole, params, body, set }) => {
      const { userId } = requireRole("ADMIN");
      const b = body as { status?: string; notes?: string };
      if (b.status && !VALID_STATUSES.includes(b.status as (typeof VALID_STATUSES)[number])) {
        set.status = 400;
        return { success: false, error: "Invalid status", code: "INVALID_STATUS" };
      }
      const request = await coverageService.updateRequest(
        params.id,
        { status: b.status, notes: b.notes !== undefined ? sanitizeUserInput(b.notes, 500) : undefined },
        userId,
      );
      return { success: true, data: { request } };
    },
    { body: t.Object({ status: t.Optional(t.String()), notes: t.Optional(t.String()) }) },
  )

  // ── Admin: coverage intelligence dashboard (Operations HQ + Executive HQ) ──
  .get("/intelligence", async ({ requireRole }) => {
    requireRole("ADMIN");
    const data = await coverageService.intelligence();
    return { success: true, data };
  })

  // ── Admin: managed cities list (live metrics + manual status overrides) ──
  .get("/admin/cities", async ({ requireRole }) => {
    requireRole("ADMIN");
    const cities = await coverageService.managedCities();
    return { success: true, data: { cities, total: cities.length } };
  })

  // ── Admin: set / clear a city's operational status (source of truth) ──
  .patch(
    "/cities/:slug",
    async ({ requireRole, params, body, set }) => {
      const { userId } = requireRole("ADMIN");
      const b = body as { status?: string | null; note?: string };
      const status = b.status == null || b.status === "" ? null : b.status;
      if (status !== null && !MANAGEABLE_CITY_STATUSES.includes(status as (typeof MANAGEABLE_CITY_STATUSES)[number])) {
        set.status = 400;
        return { success: false, error: "Invalid status", code: "INVALID_STATUS" };
      }
      const result = await coverageService.setCityStatus(
        params.slug,
        status as (typeof MANAGEABLE_CITY_STATUSES)[number] | null,
        b.note !== undefined ? sanitizeUserInput(b.note, 300) : undefined,
        userId,
      );
      if (!result.ok) {
        set.status = result.reason === "CITY_NOT_FOUND" ? 404 : 400;
        return { success: false, error: result.reason, code: result.reason };
      }
      const cities = await coverageService.managedCities();
      const city = cities.find((c) => c.slug === params.slug);
      return { success: true, data: { city } };
    },
    { body: t.Object({ status: t.Optional(t.Union([t.String(), t.Null()])), note: t.Optional(t.String()) }) },
  );

// Exported with a widened type so the already-huge index.ts plugin chain does
// not blow TypeScript's instantiation depth (TS2589). Handlers above are still
// fully type-checked; runtime behaviour is unchanged.
export const coverageRoutes = routes as unknown as Elysia;
