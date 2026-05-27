import { Elysia } from "elysia";

/** Admin API — consumed by apps/admin-panel (admin.homigo.com) */
export const adminRoutes = new Elysia({ prefix: "/api/v1/admin" })
  .get("/overview", () => ({
    users: 12840,
    vendors: 3420,
    bookingsToday: 892,
    gmvToday: 1240000,
    fraudFlags: 3,
  }))
  .get("/vendors", () => ({
    vendors: [{ id: "v1", name: "Rajesh Kumar", status: "active", kyc: "verified" }],
  }))
  .get("/bookings", () => ({
    bookings: [{ id: "b1", status: "in_progress", service: "AC Repair" }],
  }));
