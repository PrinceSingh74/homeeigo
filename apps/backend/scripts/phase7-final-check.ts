import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  console.log("=== AUDIT TRAIL for 7B/7C certification ===");
  const audit = await prisma.activityLog.findMany({
    where: { action: "AUTOMATION_CERTIFICATION_APPROVED", description: { contains: "7B/7C" } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  for (const a of audit) console.log(` ${a.createdAt.toISOString()} [user:${a.userId}] ${a.description}`);

  console.log("\n=== FOLLOW_UP INSTANCE CHECK (must still be 0 — no real event yet) ===");
  const count = await prisma.workflowInstance.count({ where: { workflowId: "follow_up" } });
  console.log("follow_up instances:", count);
  console.log(count === 0 ? "STATUS: WAITING_FOR_REAL_BOOKING_EVENT" : "A REAL EVENT HAS FIRED — investigate before certifying");

  console.log("\n=== PRE-EXISTING CERTIFICATIONS — untouched check ===");
  const preExisting = await prisma.automationCertification.findMany({
    where: { automationId: { in: ["review_request", "payment_recovery", "checkout_recovery", "mobile_ai_concierge"] } },
    select: { automationId: true, workflowVersion: true, voidedAt: true, approvedExecutionMode: true },
  });
  for (const c of preExisting) {
    console.log(` ${c.automationId}.v${c.workflowVersion}: voided=${c.voidedAt ?? "no"} mode=${c.approvedExecutionMode}`);
  }

  console.log("\n=== FLAGS — confirm no lingering enabled row ===");
  const flags = await prisma.platformFeatureFlag.findMany({
    where: { key: { in: ["AI_FOLLOW_UP", "AI_REBOOKING", "AI_SATISFACTION_INTELLIGENCE"] } },
  });
  console.log("Rows found:", flags.length, "(0 expected — observation flags were reset)");

  console.log("\n=== LIVE CHECK ===");
  const live = await prisma.automationCertification.count({
    where: { automationId: { in: ["follow_up", "rebooking", "satisfaction_intelligence"] }, approvedExecutionMode: "LIVE" },
  });
  console.log("LIVE certifications among new capabilities:", live, "(must be 0)");

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
