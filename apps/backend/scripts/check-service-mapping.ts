import "../src/load-env";
import prisma from "../src/lib/prisma";

const serviceId = "cmq6v5gjt0000tz6gow1lxmfj";

async function main() {
  const svc = await prisma.service.findUnique({ where: { id: serviceId } });
  console.log("BOOKED SERVICE:", svc);

  const providers = await prisma.provider.findMany({
    where: { isActive: true, isApproved: true },
    select: {
      id: true,
      isOnline: true,
      serviceCategories: true,
      serviceRegions: true,
      city: true,
      user: { select: { email: true, firstName: true } },
    },
  });
  console.log("\nPROVIDERS:");
  for (const p of providers) {
    console.log(
      `${p.id} | ${p.user.email} | online=${p.isOnline} | categories=${JSON.stringify(p.serviceCategories)}`,
    );
  }

  const allServices = await prisma.service.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true, category: true },
  });
  console.log("\nALL ACTIVE SERVICES:");
  for (const s of allServices) console.log(`${s.id} | ${s.name} | ${s.slug} | ${s.category}`);

  await prisma.$disconnect();
}
main();
