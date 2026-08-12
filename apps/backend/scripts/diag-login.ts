/**
 * Diagnose login failures for demo users.
 * Run: bun run scripts/diag-login.ts
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { PasswordService } from "../src/services/password.service";
import { userPiiService } from "../src/services/user-pii.service";

const DEMO = [
  { email: "admin@homigo.demo", password: "Homigo@123" },
  { email: "partner@homigo.demo", password: "Homigo@123" },
  { email: "customer@homigo.demo", password: "Homigo@123" },
];

for (const { email, password } of DEMO) {
  const user = await userPiiService.findByEmail(email);
  if (!user) {
    console.log(JSON.stringify({ email, found: false }));
    continue;
  }
  const bcryptOk = user.password
    ? await PasswordService.comparePassword(password, user.password)
    : false;
  const bunOk = user.password ? await Bun.password.verify(password, user.password) : false;
  console.log(
    JSON.stringify({
      email,
      found: true,
      role: user.role,
      isActive: user.isActive,
      hasPassword: !!user.password,
      passwordPrefix: user.password?.slice(0, 7),
      bcryptjsMatch: bcryptOk,
      bunVerifyMatch: bunOk,
    }),
  );
}

await prisma.$disconnect();
