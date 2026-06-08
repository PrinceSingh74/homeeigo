import "../src/load-env";
import prisma from "../src/lib/prisma";

try {
  await prisma.$connect();
  const count = await prisma.oTP.count();
  console.log("DB_OK", count);
} catch (e) {
  console.log("DB_FAIL", e instanceof Error ? e.message : e);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
