import "../src/load-env";
import prisma from "../src/lib/prisma";

const total = await prisma.opsAlert.count({ where: { resolved: false } });
const critical = await prisma.opsAlert.count({ where: { resolved: false, severity: "CRITICAL" } });
const breakdown = await prisma.opsAlert.groupBy({
  by: ["severity", "alertType"],
  where: { resolved: false },
  _count: true,
  orderBy: { _count: { alertType: "desc" } },
});
console.log(JSON.stringify({ total, critical, breakdown }, null, 2));
await prisma.$disconnect();
