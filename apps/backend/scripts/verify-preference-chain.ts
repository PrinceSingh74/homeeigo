/**
 * End-to-end proof that a saved preference actually changes what the notification router does.
 *
 * The bug this verifies against was invisible to unit tests: the settings UI wrote `User` booleans
 * and the router read `NotificationPreference`, so both halves worked perfectly and the feature did
 * nothing. Only a check that spans the two — write through the bridge, read through the router's
 * own `evaluatePreference` — can tell the difference.
 *
 * Read-mostly and self-cleaning: it picks an existing user, records their current rows, exercises
 * the chain, then restores exactly what it found.
 */
import prisma from "../src/lib/prisma";
import { mirrorLegacyFlagsToPreferences } from "../src/notifications/legacy-preference-bridge";
import { evaluatePreference } from "../src/notifications/preferences.service";

async function main() {
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) throw new Error("no user to verify against");

  const before = await prisma.notificationPreference.findMany({ where: { userId: user.id } });

  const results: Array<{ check: string; expected: string; actual: string; pass: boolean }> = [];
  const record = (check: string, expected: string, actual: string) =>
    results.push({ check, expected, actual, pass: expected === actual });

  try {
    await prisma.notificationPreference.deleteMany({ where: { userId: user.id } });

    // Baseline: no rows means "use the default".
    const emailDefault = await evaluatePreference({
      userId: user.id, channel: "EMAIL", category: "OPTIONAL",
    });
    record("OPTIONAL/EMAIL with no preference", "SYSTEM_DEFAULT:false",
      `${emailDefault.reason}:${emailDefault.allowed}`);

    // Turning a legacy toggle off must reach the router.
    await mirrorLegacyFlagsToPreferences(user.id, { pushNotifications: false });
    const pushOff = await evaluatePreference({
      userId: user.id, channel: "PUSH", category: "OPTIONAL",
    });
    record("OPTIONAL/PUSH after legacy opt-out", "EXPLICIT_PREFERENCE:false",
      `${pushOff.reason}:${pushOff.allowed}`);

    // And must not reach the categories it has no authority over.
    const pushTransactional = await evaluatePreference({
      userId: user.id, channel: "PUSH", category: "TRANSACTIONAL",
    });
    record("TRANSACTIONAL/PUSH after legacy opt-out", "MANDATORY_CATEGORY:true",
      `${pushTransactional.reason}:${pushTransactional.allowed}`);

    const smsSecurity = await evaluatePreference({
      userId: user.id, channel: "SMS", category: "SECURITY",
    });
    record("SECURITY/SMS after legacy opt-out", "MANDATORY_CATEGORY:true",
      `${smsSecurity.reason}:${smsSecurity.allowed}`);

    // Turning it back on restores the default rather than writing a stronger explicit yes.
    await mirrorLegacyFlagsToPreferences(user.id, { pushNotifications: true });
    const pushBack = await evaluatePreference({
      userId: user.id, channel: "PUSH", category: "OPTIONAL",
    });
    record("OPTIONAL/PUSH after re-enabling", "CATEGORY_DEFAULT:true",
      `${pushBack.reason}:${pushBack.allowed}`);

    const rowsAfterReenable = await prisma.notificationPreference.count({
      where: { userId: user.id, channel: "PUSH" },
    });
    record("re-enabling leaves no explicit row", "0", String(rowsAfterReenable));

    // The bridge must never author a mandatory-category row.
    await mirrorLegacyFlagsToPreferences(user.id, {
      emailNotifications: false, smsNotifications: false, notificationsEnabled: false,
    });
    const mandatoryRows = await prisma.notificationPreference.count({
      where: { userId: user.id, category: { in: ["TRANSACTIONAL", "SECURITY"] } },
    });
    record("bridge writes no mandatory rows", "0", String(mandatoryRows));
  } finally {
    await prisma.notificationPreference.deleteMany({ where: { userId: user.id } });
    if (before.length) {
      await prisma.notificationPreference.createMany({ data: before });
    }
  }

  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.check}\n      expected ${r.expected}  got ${r.actual}`);
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
