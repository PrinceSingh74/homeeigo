import "../src/load-env";
import prisma from "../src/lib/prisma";

const since = new Date(Date.now() - 60 * 60 * 1000);
const failedOtp = await prisma.activityLog.count({
  where: { action: "FAILED_LOGIN", createdAt: { gte: since } },
});
const failedRefunds = await prisma.refundRequest.count({
  where: { status: "FAILED", createdAt: { gte: since } },
});

const open = await prisma.opsAlert.groupBy({
  by: ["alertType", "severity"],
  where: { resolved: false },
  _count: true,
});

console.log(
  JSON.stringify(
    {
      failedOtpLastHour: failedOtp,
      failedRefundsLastHour: failedRefunds,
      otpThresholdBreached: failedOtp >= 50,
      open,
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
