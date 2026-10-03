/**
 * P1/P2 partner acquisition integration — isolated test DB (homigo_test).
 * Run via: bun --env-file=.env.test src/__tests__/run-p1p2-integration.ts
 */
process.env.NODE_ENV = "test";
process.env.EVENTS_OUTBOX_ENABLED = "false";
process.env.EVENTS_CONSUMERS_ENABLED = "false";

import type { PartnerLeadSource } from "@prisma/client";

console.log("[p1p2] start");
await import("../load-env");
console.log("[p1p2] env db=", (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0]);

const { default: prisma } = await import("../lib/prisma");
console.log("[p1p2] prisma loaded");

const rows = (await prisma.$queryRawUnsafe("SELECT current_database() AS db")) as Array<{ db: string }>;
if (!/test/i.test(rows[0]?.db ?? "")) {
  throw new Error(`[p1p2] REFUSING to run against non-test db "${rows[0]?.db}"`);
}
console.log("[p1p2] ping", rows[0]?.db);

const { EVENT_TYPES } = await import("../events/catalog/event-types");
const { partnerLeadService } = await import("../services/partner-lead.service");
console.log("[p1p2] lead service loaded");
const { markLeadDuplicate, mergeLeads, previewLeadMerge } = await import("../services/partner-lead-merge");
const { acquisitionSpendService } = await import("../services/acquisition-spend.service");
const { partnerAcquisitionQueueService } = await import("../services/partner-acquisition-queues.service");
const { partnerAcquisitionAnalyticsService } = await import("../services/partner-acquisition-analytics.service");
const { partnerOnboardingService } = await import("../services/partner-onboarding.service");
const { readFileSync } = await import("node:fs");
const { resolve } = await import("node:path");

let failed = 0;
let passed = 0;
const createdLeadIds: string[] = [];
const createdSpendIds: string[] = [];

function assert(cond: unknown, msg: string) {
  if (!cond) {
    failed += 1;
    console.error("  FAIL", msg);
  } else {
    passed += 1;
    console.log("  PASS", msg);
  }
}

async function makeLead(
  name: string,
  phone: string,
  extra?: { email?: string; city?: string; source?: PartnerLeadSource },
) {
  const lead = await partnerLeadService.createLead({
    name,
    phone,
    email: extra?.email,
    city: extra?.city ?? "Gurugram",
    source: extra?.source ?? "DIRECT",
    skillInterest: "electrician",
  });
  createdLeadIds.push(lead.id);
  return lead;
}

try {
  console.log("[p1p2] duplicate detection");
  {
    const phone = `98${Date.now().toString().slice(-8)}`;
    const a = await makeLead("Rahul Sharma", phone);
    const matches = await partnerLeadService.checkDuplicates({ phone });
    assert(matches.some((m) => m.type === "lead" && m.id === a.id), "duplicate detection finds matching phone");
    let threw = false;
    try {
      await partnerLeadService.createLead({ name: "Rahul S", phone, source: "APNA" });
    } catch (err) {
      threw = /DUPLICATE/i.test(err instanceof Error ? err.message : String(err));
    }
    assert(threw, "second create with same phone throws DUPLICATE");
  }

  console.log("[p1p2] mark duplicate");
  {
    const phone = `97${Date.now().toString().slice(-8)}`;
    const primary = await makeLead("Primary Lead", phone, { source: "REFERRAL" });
    const dupPhone = `96${Date.now().toString().slice(-8)}`;
    const dup = await makeLead("Dup Lead", dupPhone, { city: "Gurugram" });
    await markLeadDuplicate(dup.id, primary.id, "admin_test", "Same person from APNA");
    const after = await prisma.partnerLead.findUniqueOrThrow({ where: { id: dup.id } });
    assert(after.status === "DUPLICATE", "mark duplicate sets DUPLICATE");
    assert(after.duplicateOfLeadId === primary.id, "duplicateOfLeadId points at primary");
    let threw = false;
    try {
      await partnerLeadService.startApplication(dup.id, "admin_test");
    } catch (err) {
      threw = /duplicate|merged/i.test(err instanceof Error ? err.message : String(err));
    }
    assert(threw, "duplicate lead cannot start application");
  }

  console.log("[p1p2] merge");
  {
    const pPhone = `95${Date.now().toString().slice(-8)}`;
    const dPhone = `94${Date.now().toString().slice(-8)}`;
    const primary = await makeLead("Rahul S.", pPhone, { email: `p.${pPhone}@homigo.test`, city: "Gurugram" });
    await prisma.partnerLead.update({ where: { id: primary.id }, data: { notes: "HQ called" } });
    const duplicate = await makeLead("Rahul Sharma", dPhone, {
      email: `d.${dPhone}@homigo.test`,
      city: "Noida",
      source: "APNA",
    });
    await prisma.partnerLead.update({ where: { id: duplicate.id }, data: { notes: "Walk-in" } });

    const preview = await previewLeadMerge(primary.id, duplicate.id);
    const nameField = preview.fields.find((f) => f.key === "name");
    assert(nameField?.primaryValue === "Rahul S.", "merge preview shows primary name");
    assert(nameField?.duplicateValue === "Rahul Sharma", "merge preview shows duplicate name");
    assert(nameField?.conflict === true, "name conflict flagged");

    const first = await mergeLeads(primary.id, duplicate.id, "admin_test", {
      reason: "Same person, keep canonical CRM record",
      resolutions: { phone: "primary", email: "primary", city: "primary", name: "duplicate" },
    });
    assert(first.idempotent === false, "first merge is not idempotent replay");
    const merged = await prisma.partnerLead.findUniqueOrThrow({ where: { id: primary.id } });
    assert(merged.name === "Rahul Sharma", "survivorship keeps longer name");
    assert((merged.notes ?? "").includes("HQ called"), "primary notes preserved");
    assert((merged.notes ?? "").includes("Walk-in"), "duplicate notes preserved");
    assert(merged.source === "DIRECT", "source stays on primary");

    const secondary = await prisma.partnerLead.findUniqueOrThrow({ where: { id: duplicate.id } });
    assert(secondary.status === "DUPLICATE", "secondary becomes DUPLICATE");
    assert(secondary.mergedIntoLeadId === primary.id, "secondary linked to primary");

    const second = await mergeLeads(primary.id, duplicate.id, "admin_test", {
      reason: "retry",
      resolutions: { phone: "primary", email: "primary" },
    });
    assert(second.idempotent === true, "second merge is idempotent");

    const listed = await partnerLeadService.listLeads({ search: "Rahul Sharma", city: "Gurugram" });
    assert(!listed.leads.some((l) => l.id === duplicate.id), "merged secondary hidden from default list");
    assert(listed.leads.some((l) => l.id === primary.id), "primary remains listable");
  }

  console.log("[p1p2] filters");
  {
    const phone = `93${Date.now().toString().slice(-8)}`;
    const lead = await makeLead("Filter Target", phone, { city: "Pune", source: "REFERRAL" });
    const result = await partnerLeadService.listLeads({
      source: "REFERRAL",
      city: "Pune",
      status: "NEW",
      search: "Filter Target",
    });
    assert(result.leads.some((l) => l.id === lead.id), "source+city+status filter hits lead");
  }

  console.log("[p1p2] location validation");
  {
    let outside = false;
    try {
      await partnerOnboardingService.saveLocation("user_test", "provider_test", {
        city: "New York",
        serviceRegions: ["Manhattan"],
        serviceRadiusKm: 5,
        baseLatitude: 40.7,
        baseLongitude: -74,
      });
    } catch (err) {
      outside = /outside the HOMEEIGO service area/i.test(err instanceof Error ? err.message : String(err));
    }
    assert(outside, "NYC coordinates rejected");
    let radius = false;
    try {
      await partnerOnboardingService.saveLocation("user_test", "provider_test", {
        city: "Gurugram",
        serviceRegions: ["Cyber City"],
        serviceRadiusKm: 0,
      });
    } catch (err) {
      radius = /radius/i.test(err instanceof Error ? err.message : String(err));
    }
    assert(radius, "radius 0 rejected");
  }

  console.log("[p1p2] spend");
  {
    const empty = await acquisitionSpendService.totalsForRange(new Date("2010-01-01"), new Date("2010-01-31"));
    assert(empty.available === false, "no spend => unavailable");
    assert(empty.totalSpend === null, "no spend => null total, not 0");

    const row = await acquisitionSpendService.create(
      {
        source: "APNA",
        campaign: "p1p2-test",
        periodStart: new Date().toISOString(),
        periodEnd: new Date().toISOString(),
        amount: 10000,
      },
      "admin_test",
    );
    createdSpendIds.push(row.id);
    const totals = await acquisitionSpendService.totalsForRange(
      new Date(Date.now() - 86400_000),
      new Date(Date.now() + 86400_000),
      "APNA",
    );
    assert(totals.available === true, "recorded spend is available");
    assert((totals.totalSpend ?? 0) >= 10000, "spend amount attributed");

    let neg = false;
    try {
      await acquisitionSpendService.create(
        { source: "DIRECT", periodStart: new Date().toISOString(), periodEnd: new Date().toISOString(), amount: -50 },
        "admin_test",
      );
    } catch (err) {
      neg = /VALIDATION/i.test(err instanceof Error ? err.message : String(err));
    }
    assert(neg, "negative spend rejected");
  }

  console.log("[p1p2] events + queues + dashboard + follow-up");
  assert(EVENT_TYPES.PARTNER_LEAD_MERGED.startsWith("homigo."), "merged event is namespaced");

  const apps = await partnerAcquisitionQueueService.listApplications({ page: 1, limit: 5 });
  assert(apps.page === 1 && apps.limit === 5 && Array.isArray(apps.items), "applications queue paginated");
  const verification = await partnerAcquisitionQueueService.listVerification({ page: 1, limit: 5 });
  assert(Array.isArray(verification.items), "verification queue paginated");
  const approvals = await partnerAcquisitionQueueService.listApprovals({ page: 1, limit: 5 });
  assert(Array.isArray(approvals.items), "approvals queue paginated");

  const dashboard = await partnerAcquisitionAnalyticsService.getDashboard("7d");
  assert(dashboard.kpis.followUpToday >= 0, "follow-up today is a real count");
  assert(dashboard.kpis.followUpOverdue >= 0, "follow-up overdue is a real count");
  assert(["7d", "30d", "90d"].includes(dashboard.range), "7d range accepted");
  const thirty = await partnerAcquisitionAnalyticsService.getDashboard("30d");
  const ninety = await partnerAcquisitionAnalyticsService.getDashboard("90d");
  assert(thirty.range === "30d" && ninety.range === "90d", "30d/90d ranges accepted");

  {
    const phone = `92${Date.now().toString().slice(-8)}`;
    const lead = await makeLead("Follow Filter", phone);
    await partnerLeadService.assignLead(lead.id, "admin_filter", "admin_test");
    await partnerLeadService.setFollowUp(
      lead.id,
      { nextFollowUpAt: new Date(Date.now() - 86400_000), followUpReason: "Missed call" },
      "admin_test",
    );
    const overdue = await partnerLeadService.listLeads({ followUp: "overdue", search: "Follow Filter" });
    assert(overdue.leads.some((l) => l.id === lead.id), "overdue follow-up filter");
    const assigned = await partnerLeadService.listLeads({ assignedToAdminId: "admin_filter", search: "Follow Filter" });
    assert(assigned.leads.some((l) => l.id === lead.id), "assignee filter");
  }

  {
    const pPhone = `91${Date.now().toString().slice(-8)}`;
    const dPhone = `90${Date.now().toString().slice(-8)}`;
    const primary = await makeLead("Canonical", pPhone);
    const duplicate = await makeLead("Secondary", dPhone);
    await mergeLeads(primary.id, duplicate.id, "admin_test", {
      reason: "Audit trail check",
      resolutions: { phone: "primary", email: "primary" },
    });
    const activities = await prisma.partnerLeadActivity.findMany({
      where: { leadId: { in: [primary.id, duplicate.id] }, type: "MERGE" },
    });
    assert(activities.length > 0, "merge writes MERGE activity");
    const withMerged = await partnerLeadService.listLeads({ includeMerged: true, search: "Secondary" });
    assert(withMerged.leads.some((l) => l.id === duplicate.id), "secondary remains historically queryable");
  }

  const training = await partnerOnboardingService.getTraining("missing-provider");
  assert(/activation/i.test(training.policy), "training policy mentions activation");
  assert(/not for application submit/i.test(training.policy), "training is not a submit blocker");

  const register = readFileSync(resolve(import.meta.dir, "../routes/partner-register.ts"), "utf8");
  assert(!register.includes("acquisitionSpend"), "partner register does not import acquisition spend");
  assert(!register.includes("/spend"), "partner register has no spend route");
} finally {
  if (createdLeadIds.length) {
    await prisma.partnerLeadActivity.deleteMany({ where: { leadId: { in: createdLeadIds } } }).catch(() => undefined);
    await prisma.partnerLeadStatusHistory.deleteMany({ where: { leadId: { in: createdLeadIds } } }).catch(() => undefined);
    await prisma.partnerLead.deleteMany({ where: { id: { in: createdLeadIds } } }).catch(() => undefined);
  }
  if (createdSpendIds.length) {
    await prisma.acquisitionSpend.deleteMany({ where: { id: { in: createdSpendIds } } }).catch(() => undefined);
  }
}

console.log(`[p1p2] done passed=${passed} failed=${failed}`);
if (failed > 0) process.exit(1);
