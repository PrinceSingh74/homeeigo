import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { NotificationCategory, NotificationChannel } from "@prisma/client";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import {
  decidePreference,
  evaluatePreference,
  evaluatePreferences,
} from "../notifications/preferences.service";

/**
 * 5F — the preferences screen builds a 3x4 matrix of (category, channel) cells. Each cell used to
 * call the async evaluator, which issued its own `findUnique` — twelve queries restating rows the
 * handler had already fetched.
 *
 * The tempting repair is for the screen to work the cells out itself from those rows. That is also
 * the repair that lets the screen and the router drift apart: a recipient would be shown a decision
 * computed by different code from the one the platform acts on, and the two would diverge silently
 * the first time either changed. So the precedence rules live in one pure function and both
 * evaluators wrap it.
 *
 * These cases assert that equivalence directly, across every combination the matrix can contain —
 * including the ones where the rules disagree with each other (mandatory overriding an opt-out,
 * absence meaning "default" rather than "off").
 */
const RUN = `pref-batch-${Date.now().toString(36)}`;
const CATEGORIES: NotificationCategory[] = ["TRANSACTIONAL", "SECURITY", "OPTIONAL"];
const CHANNELS: NotificationChannel[] = ["IN_APP", "PUSH", "EMAIL", "SMS"];
let ctx: AdvCtx;
let dbOk = false;

async function setPreference(
  channel: NotificationChannel,
  category: NotificationCategory,
  enabled: boolean,
  language: string | null = null,
) {
  await prisma.notificationPreference.upsert({
    where: { userId_channel_category: { userId: ctx.customerA.id, channel, category } },
    create: { userId: ctx.customerA.id, channel, category, enabled, language },
    update: { enabled, language },
  });
}

async function clearPreferences() {
  await prisma.notificationPreference.deleteMany({ where: { userId: ctx.customerA.id } });
}

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN);
  await clearPreferences();
}, 60_000);

afterAll(async () => {
  if (!dbOk) return;
  await clearPreferences();
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

const allCells = CATEGORIES.flatMap((category) => CHANNELS.map((channel) => ({ category, channel })));

describe("batched preference evaluation", () => {
  test("every cell of the matrix matches the per-cell evaluator, with no preferences set", async () => {
    if (!dbOk) return;
    await clearPreferences();

    const batched = await evaluatePreferences(ctx.customerA.id, allCells);
    for (const [i, cell] of allCells.entries()) {
      const single = await evaluatePreference({ userId: ctx.customerA.id, ...cell });
      expect(batched[i]).toEqual(single);
    }
  });

  test("every cell matches once the recipient has expressed preferences, including opt-outs", async () => {
    if (!dbOk) return;
    await clearPreferences();
    // An OPTIONAL opt-out that must be honoured, an OPTIONAL opt-in on a non-default channel, and a
    // language set on a MANDATORY category — where the opt-out is ignored but the language is not.
    await setPreference("PUSH", "OPTIONAL", false);
    await setPreference("EMAIL", "OPTIONAL", true);
    await setPreference("SMS", "SECURITY", false, "hi");
    await setPreference("EMAIL", "TRANSACTIONAL", true, "mr");

    const batched = await evaluatePreferences(ctx.customerA.id, allCells);
    for (const [i, cell] of allCells.entries()) {
      const single = await evaluatePreference({ userId: ctx.customerA.id, ...cell });
      expect(batched[i]).toEqual(single);
    }
  });

  test("a mandatory category still cannot be switched off through the batched path", async () => {
    if (!dbOk) return;
    await clearPreferences();
    await setPreference("EMAIL", "SECURITY", false);
    await setPreference("EMAIL", "TRANSACTIONAL", false);

    const [security, transactional] = await evaluatePreferences(ctx.customerA.id, [
      { channel: "EMAIL", category: "SECURITY" },
      { channel: "EMAIL", category: "TRANSACTIONAL" },
    ]);

    // A recipient cannot silence a login code or a failed payment. Batching must not become the
    // loophole that lets them.
    expect(security!.allowed).toBe(true);
    expect(security!.reason).toBe("MANDATORY_CATEGORY");
    expect(transactional!.allowed).toBe(true);
    expect(transactional!.reason).toBe("MANDATORY_CATEGORY");
  });

  test("a stated language survives the batch, including on mandatory categories", async () => {
    if (!dbOk) return;
    await clearPreferences();
    await setPreference("EMAIL", "SECURITY", false, "ta");

    const [decision] = await evaluatePreferences(ctx.customerA.id, [
      { channel: "EMAIL", category: "SECURITY" },
    ]);
    // The recipient controls how the message reads, not whether it arrives.
    expect(decision!.allowed).toBe(true);
    expect(decision!.language).toBe("ta");
  });

  test("absence of a preference means the default, never off", async () => {
    if (!dbOk) return;
    await clearPreferences();

    const [pushOptional, smsOptional] = await evaluatePreferences(ctx.customerA.id, [
      { channel: "PUSH", category: "OPTIONAL" },
      { channel: "SMS", category: "OPTIONAL" },
    ]);

    // OPTIONAL defaults to push only — so PUSH is on by category default and SMS is off by system
    // default. Neither is an opt-out, and the reasons must say so.
    expect(pushOptional).toEqual({ allowed: true, reason: "CATEGORY_DEFAULT" });
    expect(smsOptional).toEqual({ allowed: false, reason: "SYSTEM_DEFAULT" });
  });

  test("one recipient's preferences never leak into another's cells", async () => {
    if (!dbOk) return;
    await clearPreferences();
    // customerA opts out of optional push; customerB has said nothing at all.
    await setPreference("PUSH", "OPTIONAL", false);

    const [a] = await evaluatePreferences(ctx.customerA.id, [{ channel: "PUSH", category: "OPTIONAL" }]);
    const [b] = await evaluatePreferences(ctx.customerB.id, [{ channel: "PUSH", category: "OPTIONAL" }]);

    expect(a).toEqual({ allowed: false, reason: "EXPLICIT_PREFERENCE", language: undefined });
    expect(b).toEqual({ allowed: true, reason: "CATEGORY_DEFAULT" });
  });

  test("an empty cell list reads nothing", async () => {
    if (!dbOk) return;
    expect(await evaluatePreferences(ctx.customerA.id, [])).toEqual([]);
  });

  test("the pure decision is the one both evaluators use", async () => {
    if (!dbOk) return;
    await clearPreferences();
    await setPreference("PUSH", "OPTIONAL", false);

    const explicit = { enabled: false, language: null };
    const pure = decidePreference({ channel: "PUSH", category: "OPTIONAL", explicit });
    const single = await evaluatePreference({ userId: ctx.customerA.id, channel: "PUSH", category: "OPTIONAL" });
    const [batched] = await evaluatePreferences(ctx.customerA.id, [{ channel: "PUSH", category: "OPTIONAL" }]);

    expect(single).toEqual(pure);
    expect(batched).toEqual(pure);
  });
});
