import "../src/load-env";
import app from "../src/index";
import prisma from "../src/lib/prisma";
import { JWTService } from "../src/services/jwt.service";
import { userPiiService } from "../src/services/user-pii.service";

const jwt = new JWTService();
const CUSTOMER_ID = "cmqbzopsk004jtzs8k3e08ihx";

function validJpeg(size = 600): string {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const buf = Buffer.concat([header, Buffer.alloc(Math.max(0, size - header.length))]);
  return buf.toString("base64");
}

async function main() {
  const userRow = await prisma.user.findUnique({
    where: { id: CUSTOMER_ID },
    select: { id: true, email: true, emailEncrypted: true, emailHash: true, emailEncryptionKeyVersion: true },
  });
  const email = await userPiiService.resolveEmail(userRow!, { actorId: CUSTOMER_ID, authorized: true });
  const token = jwt.generateAccessToken({ userId: CUSTOMER_ID, email: email! });

  console.log("--- POST /api/vision/images/submit (real customer, real JPEG) ---");
  const submitRes = await app.handle(
    new Request("http://localhost/api/vision/images/submit", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ bytes: validJpeg(), mimeType: "image/jpeg", purpose: "SERVICE_CONTEXT" }),
    }),
  );
  const submitBody = await submitRes.json();
  console.log("status:", submitRes.status, "body:", JSON.stringify(submitBody));
  if (!submitBody.success) throw new Error("submit failed");
  const imageId = submitBody.data.imageId;

  console.log("\n--- POST /api/vision/images/:id/analyze (exactly what the fixed frontend now consumes directly) ---");
  const analyzeRes = await app.handle(
    new Request(`http://localhost/api/vision/images/${imageId}/analyze`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    }),
  );
  const analyzeBody = await analyzeRes.json();
  console.log("status:", analyzeRes.status);
  console.log("body:", JSON.stringify(analyzeBody, null, 2));

  console.log("\n--- Simulating the fixed frontend's mapping ---");
  const result = analyzeBody.data;
  const mapped = {
    status: "COMPLETE",
    result: [result.observedCategory ? `Category: ${result.observedCategory}` : null, ...result.observations].filter(Boolean).join("\n") || "No observations returned.",
    confidence: result.confidence,
    safetyFlags: result.safetyFlags,
    provider: result.provider === "GEMINI" ? "GEMINI" : "FALLBACK",
    mode: result.observationMode === "REAL_PROVIDER" ? "REAL" : "SHADOW",
  };
  console.log(JSON.stringify(mapped, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
