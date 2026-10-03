import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  const count = await prisma.serviceIntervalPolicy.count();
  console.log("ServiceIntervalPolicy rows:", count, "(must be 0 — no policy invented)");
  process.exit(count === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
