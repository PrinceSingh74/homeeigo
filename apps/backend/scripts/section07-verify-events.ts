import "dotenv/config";
import prisma from "../src/lib/prisma";
import { EVENT_TYPES } from "../src/events/catalog/event-types";

const referralId = process.argv[2] ?? "cmth1b2fc000mtzqko4szcsn7";
const referrerId = "cmq9h687s0005tz8swhtkju1p";
const required = [
  EVENT_TYPES.PARTNER_REFERRAL_INVITED,
  EVENT_TYPES.PARTNER_REFERRAL_REGISTERED,
  EVENT_TYPES.PARTNER_REFERRAL_VERIFIED,
  EVENT_TYPES.PARTNER_REFERRAL_TRAINING,
  EVENT_TYPES.PARTNER_REFERRAL_ACTIVATED,
  EVENT_TYPES.PARTNER_REFERRAL_FIRST_JOB,
  EVENT_TYPES.PARTNER_REFERRAL_QUALIFIED,
  EVENT_TYPES.PARTNER_REFERRAL_REWARDED,
];
const events = await prisma.eventOutbox.findMany({
  where: {
    aggregateId: referrerId,
    eventType: { startsWith: "homigo.partner.referral." },
    createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
  },
  select: { eventType: true, payload: true },
});
const mine = events.filter((e) => JSON.stringify(e.payload).includes(referralId));
const types = new Set(mine.map((e) => e.eventType));
const missing = required.filter((t) => !types.has(t));
const counts = Object.fromEntries([...types].map((t) => [t, mine.filter((e) => e.eventType === t).length]));
console.log(JSON.stringify({ referralId, found: mine.length, missing, counts, pass: missing.length === 0 }, null, 2));
await prisma.$disconnect();
process.exit(missing.length ? 1 : 0);
