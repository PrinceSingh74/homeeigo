import { Elysia, t } from "elysia";

/** Partner API — consumed by apps/partner-web (partner.homigo.com) */
export const partnerRoutes = new Elysia({ prefix: "/api/v1/partner" })
  .get("/dashboard", () => ({
    todayEarnings: 4850,
    todayEarningsChange: 12.5,
    weeklyEarnings: 18650,
    weeklyEarningsChange: -15.3,
    monthlyEarnings: 54320,
    lifetimeEarnings: 124850,
    incentivesEarned: 7320,
    completedToday: 12,
    completedTodayDelta: 2,
    pendingRequests: 3,
    rating: 4.8,
    acceptanceRate: 92,
    responseRate: 95,
    onTimeRate: 90,
    cancellationRate: 2,
    completionRate: 92,
    bonusJobsRemaining: 2,
  }))
  .get("/profile", () => ({
    id: "vnd_001",
    name: "Rahul Sharma",
    rating: 4.8,
    reviewCount: 320,
    online: true,
    city: "Noida",
  }))
  .get("/requests", () => ({
    requests: [
      {
        id: "req_1",
        customerName: "Priya Verma",
        serviceType: "Deep Cleaning",
        distanceKm: 2.4,
        earnings: 799,
        etaMin: 12,
        address: "Sector 62, Noida",
        isNew: true,
      },
      {
        id: "req_2",
        customerName: "Amit Singh",
        serviceType: "AC Service",
        distanceKm: 3.1,
        earnings: 650,
        etaMin: 15,
        address: "Sector 45, Noida",
        isNew: true,
      },
      {
        id: "req_3",
        customerName: "Neha Kumari",
        serviceType: "Plumbing Repair",
        distanceKm: 4.6,
        earnings: 550,
        etaMin: 18,
        address: "Sector 18, Noida",
        isNew: true,
      },
    ],
  }))
  .get("/schedule", () => ({
    items: [
      { id: "sch_1", time: "10:00 AM", service: "AC Installation", status: "completed", earning: 1200 },
      { id: "sch_2", time: "12:30 PM", service: "AC Repair", status: "upcoming", earning: 850 },
      { id: "sch_3", time: "02:00 PM", service: "Deep Cleaning", status: "upcoming", earning: 650 },
      { id: "sch_4", time: "04:30 PM", service: "Plumbing Repair", status: "upcoming", earning: 550 },
    ],
  }))
  .post(
    "/requests/:id/accept",
    ({ params }) => ({
      ok: true,
      bookingId: params.id,
      status: "assigned",
    }),
    { params: t.Object({ id: t.String() }) }
  )
  .post(
    "/requests/:id/reject",
    ({ params }) => ({ ok: true, id: params.id }),
    { params: t.Object({ id: t.String() }) }
  )
  .put(
    "/availability",
    ({ body }) => ({ online: body.online }),
    { body: t.Object({ online: t.Boolean() }) }
  )
  .get("/wallet", () => ({
    balance: 12480,
    today: 4850,
    week: 18650,
    incentives: 7320,
  }))
  .get("/performance", () => ({
    completionRate: 92,
    responseRate: 95,
    onTimeRate: 90,
    cancellationRate: 2,
    acceptanceRate: 92,
  }))
  .get("/ai/insights", () => ({
    headline:
      "High demand for AC services in your area. You can earn up to ₹1,500 more today!",
    suggestions: [
      { id: "s1", text: "Accept nearby AC jobs" },
      { id: "s2", text: "Optimize your route" },
      { id: "s3", text: "Peak hours: 10 AM – 2 PM" },
    ],
  }));
