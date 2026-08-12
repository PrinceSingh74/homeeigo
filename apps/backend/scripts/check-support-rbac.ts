import "../src/load-env";
import { PrismaClient } from "@prisma/client";
import { rbacService } from "../src/services/rbac.service";

const prisma = new PrismaClient();

const role = await prisma.adminRole.findUnique({
  where: { name: "SUPPORT_ADMIN" },
  include: { permissions: true },
});
console.log(
  "SUPPORT_ADMIN PAYMENTS perms:",
  role?.permissions.filter((p) => p.resource === "PAYMENTS"),
);

const user = await prisma.user.findFirst({
  where: { email: { contains: "support-admin" } },
  orderBy: { createdAt: "desc" },
  include: { adminProfile: { include: { role: { include: { permissions: true } } } } },
});
console.log("latest support user role:", user?.adminProfile?.role.name);
if (user) {
  const ctx = await rbacService.resolveAdminContext(user.id);
  console.log("ctx:", ctx);
  if (ctx) {
    console.log("PAYMENTS.APPROVE:", await rbacService.hasPermission(ctx, "PAYMENTS", "APPROVE"));
  }
}

await prisma.$disconnect();
