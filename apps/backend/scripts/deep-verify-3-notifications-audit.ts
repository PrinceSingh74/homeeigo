import "../src/load-env";
import prisma from "../src/lib/prisma";

const BOOKING_ID = "cmt720w6a0002tz6c5bufo43h";
const JOB_ID = "cmt720w8i0005tz6c72zfum15";
const PROVIDER_USER_IDS = [
  "usr_phase2-cert-1786084840318_prov",
  "usr_phase2-cert-1786085479780_prov",
  "usr_phase2-cert-1786085847281_prov",
];

async function main() {
  console.log("=== DEEP VERIFY 2: Real Notification DB rows ===\n");
  const notifications = await prisma.notification.findMany({
    where: { userId: { in: PROVIDER_USER_IDS }, referenceId: BOOKING_ID },
    select: { id: true, userId: true, type: true, title: true, body: true, isRead: true, createdAt: true },
  });
  console.log(`Found ${notifications.length} real Notification rows for this booking:`);
  console.log(JSON.stringify(notifications, null, 2));

  console.log("\n=== DEEP VERIFY 3: AssignmentAudit trail (full history for this job) ===\n");
  const audits = await prisma.assignmentAudit.findMany({
    where: { jobId: JOB_ID },
    orderBy: { createdAt: "asc" },
    select: { action: true, details: true, createdAt: true },
  });
  for (const a of audits) {
    console.log(`${a.createdAt.toISOString()} [${a.action}]`);
    console.log(`  ${a.details}`);
  }

  console.log("\n=== DEEP VERIFY 4: Real-time WS event outbox (homigo.partner.dispatched) ===\n");
  const outboxEvents = await prisma.eventOutbox.findMany({
    where: { aggregateId: BOOKING_ID, eventType: "homigo.partner.dispatched" },
    select: { id: true, eventType: true, aggregateId: true, publishedAt: true, createdAt: true, payload: true },
  });
  console.log(`Found ${outboxEvents.length} real outbox event(s):`);
  console.log(JSON.stringify(outboxEvents, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
