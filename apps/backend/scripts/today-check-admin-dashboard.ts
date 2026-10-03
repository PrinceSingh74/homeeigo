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
  if (!userRow) throw new Error("admin not found");
  const email = await userPiiService.resolveEmail(userRow, { actorId: ADMIN_ID, authorized: true });
  if (!email) throw new Error("email not resolved");
  const token = jwt.generateAccessToken({ userId: ADMIN_ID, email });

  console.log("=== Real ADMIN DASHBOARD via real HTTP route ===\n");
  const res = await app.handle(
    new Request("http://localhost/api/admin/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
  const body = await res.json();
  console.log("status:", res.status);
  console.log(JSON.stringify(body, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
