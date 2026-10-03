import "../src/load-env";
import prisma from "../src/lib/prisma";

const CUSTOMER_ID = "cmqbzopsk004jtzs8k3e08ihx";
const SERVICE_ID = "cmq67k4br0007tznkspayufug"; // Bathroom Cleaning — known real candidate provider exists

async function main() {
  const customer = await prisma.user.findUnique({
    where: { id: CUSTOMER_ID },
    select: { id: true, isEmailVerified: true, isActive: true, isBanned: true, role: true },
  });
  console.log("Customer:", JSON.stringify(customer));

  const address = await prisma.address.findFirst({
    where: { userId: CUSTOMER_ID },
    select: { id: true, fullAddress: true, latitude: true, longitude: true },
  });
  console.log("Address:", JSON.stringify(address));

  const service = await prisma.service.findUnique({
    where: { id: SERVICE_ID },
    select: { id: true, name: true, isActive: true, basePrice: true },
  });
  console.log("Service:", JSON.stringify(service));

  // Real matching providers for this service.
  const providers = await prisma.provider.findMany({
    where: { isActive: true, isApproved: true, serviceCategories: { has: SERVICE_ID } },
    select: { id: true, userId: true, isOnline: true, currentStatus: true, serviceCategories: true },
  });
  console.log("\nMatching real providers:", JSON.stringify(providers, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
