import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  const provider = await prisma.provider.findUnique({
    where: { id: "cmrfxj1fm02aitz78sm9depfw" },
    select: {
      id: true, isOnline: true, isApproved: true, currentStatus: true,
      serviceRadiusKm: true, baseLatitude: true, baseLongitude: true,
      user: { select: { id: true, email: true, firstName: true, lastName: true, phoneNumber: true, emailEncrypted: true, emailHash: true } },
    },
  });
  console.log(JSON.stringify(provider, (k, v) => (k === "emailEncrypted" || k === "emailHash" ? "[present]" : v), 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
