import prisma from "../src/lib/prisma";
import { requireDeclaredTarget } from "./lib/script-target";
import { complianceExpiryService } from "../src/services/compliance-expiry.service";
import { partnerSafetyService } from "../src/services/partner-safety.service";
requireDeclaredTarget({ label: "section05-restore-demo-partner" });

const p = await prisma.provider.findFirst({ where: { user: { email: "partner@homigo.demo" } } });
if (!p) throw new Error("no partner");
await prisma.providerDocument.updateMany({
  where: { providerId: p.id, documentNumber: "S05-LIVE-EXP" },
  data: { expiryDate: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000) },
});
const admin = await prisma.user.findFirst({ where: { email: "admin@homigo.demo" } });
if (!admin) throw new Error("no admin");
await complianceExpiryService.unrestrict(p.id, admin.id, "S05 restore after maintenance re-restrict");
const open = await prisma.partnerSafetyIncident.findFirst({
  where: { providerId: p.id, type: "SOS", status: { in: ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"] } },
});
if (open) {
  await partnerSafetyService.resolve(open.id, admin.id, "S05 restore close leftover SOS");
}
const after = await prisma.provider.findUnique({
  where: { id: p.id },
  select: { complianceRestricted: true, isOnline: true },
});
console.log(JSON.stringify({ ...after, closedSos: Boolean(open) }));
await prisma.$disconnect();
