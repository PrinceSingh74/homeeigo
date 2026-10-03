import "../src/load-env";
import app from "../src/index";
import prisma from "../src/lib/prisma";
import { JWTService } from "../src/services/jwt.service";
import { userPiiService } from "../src/services/user-pii.service";

const jwt = new JWTService();
const CUSTOMER_ID = "cmqbzopsk004jtzs8k3e08ihx";
const ADMIN_ID = "cmq9h67pk0000tz8s6tvnpet5";

function validJpeg(size = 600): string {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  return Buffer.concat([header, Buffer.alloc(Math.max(0, size - header.length))]).toString("base64");
}

async function main() {
  console.log("=== STEP 6: VISION VERIFICATION ===\n");

  const custRow = await prisma.user.findUnique({ where: { id: CUSTOMER_ID }, select: { id: true, email: true, emailEncrypted: true, emailHash: true, emailEncryptionKeyVersion: true } });
  const custEmail = await userPiiService.resolveEmail(custRow!, { actorId: CUSTOMER_ID, authorized: true });
  const custToken = jwt.generateAccessToken({ userId: CUSTOMER_ID, email: custEmail! });

  const adminRow = await prisma.user.findUnique({ where: { id: ADMIN_ID }, select: { id: true, email: true, emailEncrypted: true, emailHash: true, emailEncryptionKeyVersion: true } });
  const adminEmail = await userPiiService.resolveEmail(adminRow!, { actorId: ADMIN_ID, authorized: true });
  const adminToken = jwt.generateAccessToken({ userId: ADMIN_ID, email: adminEmail! });

  // 6a. Web end-to-end HTTP flow (submit -> analyze), REAL_PROVIDER mode (whatever this env is configured for)
  console.log("6a. End-to-end HTTP flow (submit -> analyze):");
  const submitRes = await app.handle(
    new Request("http://localhost/api/vision/images/submit", {
      method: "POST",
      headers: { Authorization: `Bearer ${custToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ bytes: validJpeg(), mimeType: "image/jpeg", purpose: "SERVICE_CONTEXT" }),
    }),
  );
  const submitBody = await submitRes.json();
  console.log("   submit status:", submitRes.status, "ok:", submitBody.success);
  const imageId = submitBody.data?.imageId;

  const analyzeRes = await app.handle(
    new Request(`http://localhost/api/vision/images/${imageId}/analyze`, {
      method: "POST",
      headers: { Authorization: `Bearer ${custToken}` },
    }),
  );
  const analyzeBody = await analyzeRes.json();
  console.log("   analyze status:", analyzeRes.status, "observationMode:", analyzeBody.data?.observationMode, "provider:", analyzeBody.data?.provider);

  // 6b. Admin dashboard endpoint
  console.log("\n6b. Admin dashboard (/api/vision/status):");
  const statusRes = await app.handle(new Request("http://localhost/api/vision/status", { headers: { Authorization: `Bearer ${adminToken}` } }));
  const statusBody = await statusRes.json();
  console.log("   status:", statusRes.status, JSON.stringify(statusBody.data));

  // 6c. Fallback mode explicitly
  console.log("\n6c. Fallback mode (VISION_FORCE_FALLBACK=true):");
  process.env.VISION_FORCE_FALLBACK = "true";
  const { visionObservationMode } = await import("../src/services/vision-intelligence.service");
  console.log("   visionObservationMode():", visionObservationMode());
  delete process.env.VISION_FORCE_FALLBACK;

  // 6d. Household-quality real-image search (re-confirm, do not fabricate)
  console.log("\n6d. Real household image search: (re-confirmed earlier this session — none exists)");
  console.log("   Classification: REAL_HOUSEHOLD_QUALITY_NOT_VERIFIED (unchanged, no image fabricated)");

  // 6e. Admin RBAC on vision status (non-admin should be refused)
  console.log("\n6e. RBAC check (customer token on admin-only endpoint):");
  const rbacRes = await app.handle(new Request("http://localhost/api/vision/status", { headers: { Authorization: `Bearer ${custToken}` } }));
  console.log("   customer -> /status:", rbacRes.status, "(must be 403)");

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
