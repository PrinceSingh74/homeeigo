import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  // Invoice number is `ERN-${id.slice(-8).toUpperCase()}` -> find matching earning
  const all = await prisma.earning.findMany({
    select: {
      id: true, providerId: true, bookingId: true, grossAmount: true, commission: true,
      netEarning: true, tax: true, createdAt: true, paymentStatus: true, notes: true,
      provider: { select: { user: { select: { firstName: true, lastName: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  const match = all.find((e) => e.id.slice(-8).toUpperCase() === "O6PA7ZBJ");
  if (!match) {
    console.log("STILL NOT FOUND among", all.length, "earning rows");
    process.exit(1);
  }

  console.log("Found matching Earning record:");
  console.log(JSON.stringify(match, null, 2));

  const computedNet = match.grossAmount - match.commission;
  console.log("\nSanity check:");
  console.log(`  grossAmount - commission = ${match.grossAmount} - ${match.commission} = ${computedNet}`);
  console.log(`  stored netEarning = ${match.netEarning}`);
  console.log(`  difference = ${match.netEarning - computedNet}`);

  // Also pull the real booking behind it for full context
  const booking = await prisma.booking.findUnique({
    where: { id: match.bookingId! },
    select: {
      bookingNumber: true, baseAmount: true, discount: true, taxes: true,
      finalAmount: true, tipAmount: true, totalAmount: true, couponCode: true, addons: true,
    },
  });
  console.log("\nUnderlying booking:", JSON.stringify(booking, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
