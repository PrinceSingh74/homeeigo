/**
 * Link orphan chargebacks to platform payments/bookings.
 * Usage: bun --env-file=.env run scripts/link-orphan-chargebacks.ts
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { chargebackWorkflowService } from "../src/services/chargeback-workflow.service";

async function main() {
  const orphans = await prisma.chargeback.findMany({
    where: { paymentId: null },
    orderBy: { createdAt: "desc" },
  });

  let linked = 0;
  for (const cb of orphans) {
    let updated = await chargebackWorkflowService.ensurePaymentLink(cb.id);
    if (updated?.paymentId) {
      linked++;
      console.log(`linked ${cb.razorpayDisputeId ?? cb.id} -> payment ${updated.paymentId}`);
      continue;
    }

    // Demo/test chargebacks: attach latest successful platform payment
    if (cb.razorpayDisputeId?.startsWith("pw-dispute")) {
      const demoPayment = await prisma.payment.findFirst({
        where: { status: "SUCCESS" },
        orderBy: { createdAt: "desc" },
      });
      if (demoPayment) {
        updated = await prisma.chargeback.update({
          where: { id: cb.id },
          data: {
            paymentId: demoPayment.id,
            razorpayPaymentId: demoPayment.razorpayPaymentId,
            amount: demoPayment.amountPaid,
            amountPaise: demoPayment.amountPaidPaise,
            metadata: JSON.stringify({
              paymentId: demoPayment.id,
              bookingId: demoPayment.bookingId,
              source: "link-orphan-chargebacks",
            }),
          },
        });
        linked++;
        console.log(`demo-linked ${cb.razorpayDisputeId} -> ${demoPayment.id} (${demoPayment.amountPaid})`);
      }
    }
  }

  console.log(`Done. Linked ${linked}/${orphans.length} orphan chargeback(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
