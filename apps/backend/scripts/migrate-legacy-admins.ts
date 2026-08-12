/**
 * One-time migration: grant SUPER_ADMIN AdminUser rows to users with role=ADMIN
 * but no admin_users profile.
 *
 * Run: bun run scripts/migrate-legacy-admins.ts
 * Rollback: bun run scripts/migrate-legacy-admins.ts --rollback
 */
import "../src/load-env";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ROLLBACK = process.argv.includes("--rollback");

async function migrate() {
  await prisma.$executeRaw`SELECT 1`;
  const superRole = await prisma.adminRole.findUnique({ where: { name: "SUPER_ADMIN" } });
  if (!superRole) {
    throw new Error("SUPER_ADMIN role missing — run rbacService.bootstrap() first");
  }

  const legacyAdmins = await prisma.user.findMany({
    where: { role: "ADMIN", adminProfile: null },
    select: { id: true, email: true },
  });

  if (legacyAdmins.length === 0) {
    console.log("No legacy ADMIN users without AdminUser profile.");
    return;
  }

  for (const admin of legacyAdmins) {
    await prisma.adminUser.create({
      data: {
        userId: admin.id,
        roleId: superRole.id,
        grantedBy: "LEGACY_MIGRATION",
      },
    });
    console.log(`Migrated legacy admin: ${admin.email ?? admin.id} -> SUPER_ADMIN`);
  }

  console.log(`Migrated ${legacyAdmins.length} legacy admin(s).`);
}

async function rollback() {
  const result = await prisma.adminUser.deleteMany({
    where: { grantedBy: "LEGACY_MIGRATION" },
  });
  console.log(`Rollback removed ${result.count} admin_users row(s) created by LEGACY_MIGRATION.`);
}

async function main() {
  if (ROLLBACK) {
    await rollback();
  } else {
    await migrate();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
