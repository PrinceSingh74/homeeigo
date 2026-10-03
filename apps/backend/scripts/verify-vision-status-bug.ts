import "../src/load-env";
import app from "../src/index";
import prisma from "../src/lib/prisma";
import { JWTService } from "../src/services/jwt.service";
import { userPiiService } from "../src/services/user-pii.service";

const jwt = new JWTService();
const ADMIN_ID = "cmq9h67pk0000tz8s6tvnpet5";

async function main() {
  const userRow = await prisma.user.findUnique({
    where: { id: ADMIN_ID },
    select: { id: true, email: true, emailEncrypted: true, emailHash: true, emailEncryptionKeyVersion: true },
  });
  const email = await userPiiService.resolveEmail(userRow!, { actorId: ADMIN_ID, authorized: true });
  const token = jwt.generateAccessToken({ userId: ADMIN_ID, email: email! });

  const res = await app.handle(
    new Request("http://localhost/api/vision/status", { headers: { Authorization: `Bearer ${token}` } }),
  );
  console.log("status:", res.status);
  const body = await res.text();
  console.log("body:", body.slice(0, 500));
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
