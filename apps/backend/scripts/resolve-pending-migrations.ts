import { execSync } from "child_process";

const pending = [
  "20260608140000_referral_fraud_engine",
  "20260608160000_prelaunch_compliance",
  "20260608180000_membership_enterprise_10",
  "20260608200000_membership_finalization",
  "20260608210000_financial_ledger",
  "20260608220000_financial_core",
  "20260608230000_finance_ops_finalization",
];

for (const name of pending) {
  console.log(`Marking applied: ${name}`);
  execSync(`bunx prisma migrate resolve --applied ${name}`, {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });
}

console.log("\nDone. Run: bunx prisma migrate deploy");
