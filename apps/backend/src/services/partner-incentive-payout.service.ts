import { BookingStatus, Prisma, WalletTxnStatus, WalletTxnType } from "@prisma/client";
import prisma from "../lib/prisma";
import { nextWalletTxnNumber } from "../lib/booking-number";
import { paiseToRupees, rupeesToPaise } from "../lib/money-paise";
import { financialLedgerService } from "./financial-ledger.service";
import { earningsLiveService } from "./earnings-live.service";
import { notificationService } from "./notification.service";
import { AuditLogService } from "./audit-log.service";
import { recordFinancialMetric } from "../lib/financial-metrics";
import { countStandardCompletedByProvider } from "../lib/booking-volume";

import { DEFAULT_PARTNER_TZ } from "../lib/partner-ops-clock";

const DAY_MS = 24 * 60 * 60 * 1000;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Incentive periods are BUSINESS days in the partner timezone, on every server.
 *
 * The counting window used `setHours(0,0,0,0)` (server-local: IST on the dev host, UTC under
 * `bun test`) while the period key used `toISOString()` (always UTC). Those disagree for the 5.5 h
 * between 18:30 UTC and midnight UTC, so on an IST server a partner's jobs were counted against one
 * day and the payout recorded under another — the same defect class as the admin dashboard's
 * timezone labels. It also made this service's behaviour depend on the host's TZ, which is why the
 * batch suite failed only when run between 00:00 and 03:00 UTC.
 *
 * `Asia/Kolkata` is the platform's canonical operational timezone (lib/partner-ops-clock.ts,
 * revenue-anomaly.service.ts).
 */
export const INCENTIVE_TZ = DEFAULT_PARTNER_TZ;

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: INCENTIVE_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** Calendar parts of `d` as seen in the business timezone. */
function businessParts(d: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value])) as Record<string, string>;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour === "24" ? "0" : p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/**
 * The instant at which the business day containing `d` began.
 *
 * Subtract the time of day AND the sub-second part exactly once. An earlier version also floored to
 * the second after subtracting, which removed the milliseconds twice and landed a fraction of a
 * second BEFORE midnight — i.e. inside the previous day. `startOfWeek`/`startOfMonth` build on this,
 * so they were a whole day early and the weekly period key named Saturday instead of Sunday.
 */
export function startOfDay(d = new Date()) {
  const { hour, minute, second } = businessParts(d);
  const t = d.getTime();
  return new Date(t - ((hour * 60 + minute) * 60 + second) * 1000 - (t % 1000));
}

/** `YYYY-MM-DD` of the business day containing `d`. */
export function businessDayKey(d = new Date()): string {
  const { year, month, day } = businessParts(d);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Canonical period key — must match partner-os incentive display. */
export function incentivePeriodKey(period: string, d = new Date()) {
  if (period === "WEEKLY") return businessDayKey(startOfWeek(d));
  if (period === "MONTHLY") return businessDayKey(d).slice(0, 7);
  return businessDayKey(d);
}

/** Start of the business week (Sunday) containing `d`. */
export function startOfWeek(d = new Date()): Date {
  const dayStart = startOfDay(d);
  // Weekday as seen in the business timezone.
  const weekday = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: INCENTIVE_TZ, weekday: "short" })
      .formatToParts(dayStart)
      .map((p) => p.value)
      .join("")
      .replace(/Sun|Mon|Tue|Wed|Thu|Fri|Sat/, (m) => String(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(m))),
  );
  return startOfDay(new Date(dayStart.getTime() - weekday * DAY_MS));
}

/** Start of the business month containing `d`. */
export function startOfMonth(d = new Date()): Date {
  const { day } = businessParts(d);
  return startOfDay(new Date(startOfDay(d).getTime() - (day - 1) * DAY_MS));
}

/**
 * The key this service used before the timezone fix (UTC date). A payout already written under it
 * must never be paid again under the business-day key for the same instant.
 */
/**
 * When period keys changed from the UTC date to the business day. Only payouts written before this
 * instant can carry a legacy key, so only those are consulted by the duplicate guard.
 */
export const LEGACY_PERIOD_KEY_CUTOVER = new Date("2026-09-20T00:00:00.000Z");

export function legacyUtcPeriodKey(period: string, d = new Date()): string {
  if (period === "MONTHLY") return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  if (period === "WEEKLY") {
    const w = new Date(d);
    w.setUTCHours(0, 0, 0, 0);
    w.setUTCDate(w.getUTCDate() - w.getUTCDay());
    return w.toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

type ProgressSnapshot = {
  daily: number;
  weekly: number;
  monthly: number;
  streak: number;
};

/** A provider the batch found no rows for has done nothing — not "unknown". */
const EMPTY_SNAPSHOT: ProgressSnapshot = { daily: 0, weekly: 0, monthly: 0, streak: 0 };

export type IncentiveRuleProgress = {
  id: string;
  code: string;
  name: string;
  period: string;
  metric: string;
  threshold: number;
  bonusAmount: number;
  current: number;
  eligible: boolean;
  progressPct: number;
  periodKey: string;
  paid: boolean;
  payoutId: string | null;
  payoutStatus: string | null;
  payoutAmount: number | null;
  payoutAt: Date | null;
};

export class PartnerIncentivePayoutService {
  private metricCurrent(metric: string, prog: ProgressSnapshot) {
    if (metric === "completed_jobs") return prog;
    if (metric === "active_days") return { streak: prog.streak };
    return {};
  }

  private resolveCurrent(rule: { period: string; metric: string }, prog: ProgressSnapshot) {
    const m = this.metricCurrent(rule.metric, prog);
    if (rule.period === "DAILY") return (m as ProgressSnapshot).daily ?? 0;
    if (rule.period === "WEEKLY") return (m as ProgressSnapshot).weekly ?? 0;
    if (rule.period === "MONTHLY") return (m as ProgressSnapshot).monthly ?? 0;
    if (rule.period === "STREAK") return (m as { streak?: number }).streak ?? 0;
    return 0;
  }

  private ruleActive(rule: { isActive: boolean; startsAt: Date | null; expiresAt: Date | null }, now = new Date()) {
    if (!rule.isActive) return false;
    if (rule.startsAt && rule.startsAt > now) return false;
    if (rule.expiresAt && rule.expiresAt < now) return false;
    return true;
  }

  /**
   * Progress for MANY providers in a fixed number of queries.
   *
   * The per-provider version issued four reads each, so the incentive cron — which walks up to 200
   * recently-active partners — spent ~800 round trips just establishing what everyone had already
   * done. Three `groupBy` counts and one attendance read cover the whole batch instead.
   *
   * `now` is a parameter rather than a per-provider `new Date()` so that every partner in one batch
   * is measured against the SAME instant. See `evaluateRecentActiveProviders` for why that matters.
   */
  async loadProgressSnapshots(
    providerIds: string[],
    now = new Date(),
  ): Promise<Map<string, ProgressSnapshot>> {
    const snapshots = new Map<string, ProgressSnapshot>();
    if (providerIds.length === 0) return snapshots;

    const todayStart = startOfDay(now);
    const weekStart = startOfWeek(now);
    const monthStart = startOfMonth(now);
    const streakStart = new Date(now.getTime() - 7 * DAY_MS);

    /**
     * X-5: "complete N jobs" incentives count STANDARD completions only — a REWORK / REVISIT
     * follow-up (§11) is a return visit to a job that already counted, not new volume. The shared
     * predicate degrades to counting everything on a pre-§11 database (column probe inside).
     */
    const completedSince = (gte: Date) => countStandardCompletedByProvider(providerIds, gte);

    const [dailyBy, weeklyBy, monthlyBy, attendance] = await Promise.all([
      completedSince(todayStart),
      completedSince(weekStart),
      completedSince(monthStart),
      prisma.partnerAttendanceSession.findMany({
        where: { providerId: { in: providerIds }, checkInAt: { gte: streakStart } },
        select: { providerId: true, checkInAt: true },
      }),
    ]);

    /** Streak counts DISTINCT calendar days, not sessions — two check-ins in a day are one day. */
    const daysBy = new Map<string, Set<string>>();
    for (const session of attendance) {
      const day = session.checkInAt.toISOString().slice(0, 10);
      const seen = daysBy.get(session.providerId) ?? new Set<string>();
      seen.add(day);
      daysBy.set(session.providerId, seen);
    }

    for (const providerId of providerIds) {
      snapshots.set(providerId, {
        daily: dailyBy.get(providerId) ?? 0,
        weekly: weeklyBy.get(providerId) ?? 0,
        monthly: monthlyBy.get(providerId) ?? 0,
        streak: daysBy.get(providerId)?.size ?? 0,
      });
    }
    return snapshots;
  }

  /**
   * One provider's progress. Delegates to the batch so there is a SINGLE definition of what daily,
   * weekly, monthly and streak mean — two implementations of an incentive threshold is how a partner
   * ends up qualifying on one screen and not on another.
   */
  async loadProgressSnapshot(providerId: string, now = new Date()): Promise<ProgressSnapshot> {
    const snapshots = await this.loadProgressSnapshots([providerId], now);
    return snapshots.get(providerId) ?? EMPTY_SNAPSHOT;
  }

  /**
   * Rule progress for MANY providers. The active-rule list is global, so it is read once for the
   * whole batch instead of once per partner, and every provider's payouts arrive in one query.
   */
  async computeRuleProgressBatch(
    providerIds: string[],
    now = new Date(),
  ): Promise<Map<string, IncentiveRuleProgress[]>> {
    const built = await this.buildIncentiveViews(providerIds, now);
    return new Map([...built].map(([id, view]) => [id, view.rules]));
  }

  /**
   * The single read pass behind every public incentive method: rules once for the batch, snapshots
   * once, payouts once. Everything else projects from it, so no caller can recompute a partner's
   * progress against a different instant than the rules were judged on.
   */
  private async buildIncentiveViews(
    providerIds: string[],
    now: Date,
  ): Promise<Map<string, { rules: IncentiveRuleProgress[]; progress: ProgressSnapshot }>> {
    const out = new Map<string, { rules: IncentiveRuleProgress[]; progress: ProgressSnapshot }>();
    if (providerIds.length === 0) return out;

    const rules = await prisma.partnerIncentiveRule.findMany({
      where: { isActive: true },
      orderBy: { bonusAmount: "asc" },
    });
    const applicable = rules.filter((rule) => this.ruleActive(rule, now));

    /**
     * No applicable rule means no progress row can exist, so the snapshot and payout reads are
     * skipped entirely rather than computed and discarded. Same output, none of the work.
     */
    if (applicable.length === 0) {
      const snapshots = await this.loadProgressSnapshots(providerIds, now);
      for (const providerId of providerIds) {
        out.set(providerId, {
          rules: [],
          progress: snapshots.get(providerId) ?? EMPTY_SNAPSHOT,
        });
      }
      return out;
    }

    const [snapshots, payouts] = await Promise.all([
      this.loadProgressSnapshots(providerIds, now),
      prisma.partnerIncentivePayout.findMany({ where: { providerId: { in: providerIds } } }),
    ]);

    const payoutByProvider = new Map<string, Map<string, (typeof payouts)[number]>>();
    for (const payout of payouts) {
      const byKey = payoutByProvider.get(payout.providerId) ?? new Map();
      byKey.set(`${payout.ruleId}:${payout.periodKey}`, payout);
      payoutByProvider.set(payout.providerId, byKey);
    }

    for (const providerId of providerIds) {
      const progress = snapshots.get(providerId) ?? EMPTY_SNAPSHOT;
      const byKey = payoutByProvider.get(providerId);
      out.set(providerId, {
        progress,
        rules: applicable.map((rule) => {
          const current = this.resolveCurrent(rule, progress);
          const periodKey = incentivePeriodKey(rule.period, now);
          const payout = byKey?.get(`${rule.id}:${periodKey}`) ?? null;
          return {
            id: rule.id,
            code: rule.code,
            name: rule.name,
            period: rule.period,
            metric: rule.metric,
            threshold: rule.threshold,
            bonusAmount: rule.bonusAmount,
            current,
            eligible: current >= rule.threshold,
            progressPct: Math.min(100, Math.round((current / rule.threshold) * 100)),
            periodKey,
            paid: Boolean(payout),
            payoutId: payout?.id ?? null,
            payoutStatus: payout?.status ?? null,
            payoutAmount: payout?.amount ?? null,
            payoutAt: payout?.createdAt ?? null,
          };
        }),
      });
    }
    return out;
  }

  async computeRuleProgress(providerId: string, now = new Date()): Promise<IncentiveRuleProgress[]> {
    return (await this.computeRuleProgressBatch([providerId], now)).get(providerId) ?? [];
  }

  /**
   * Rule progress AND the snapshot it was derived from, in one pass.
   *
   * `partner-os.getIncentives` needed both and called `computeRuleProgress` and
   * `loadProgressSnapshot` separately, so every partner request computed the snapshot twice — and
   * from two independent `new Date()` values, so the streak shown beside the rules was not
   * necessarily the streak the rules were judged against.
   */
  async computeIncentiveView(
    providerId: string,
    now = new Date(),
  ): Promise<{ rules: IncentiveRuleProgress[]; progress: ProgressSnapshot }> {
    const built = await this.buildIncentiveViews([providerId], now);
    return built.get(providerId) ?? { rules: [], progress: EMPTY_SNAPSHOT };
  }

  /**
   * When a rule is qualified, create exactly one PartnerIncentivePayout and credit
   * provider wallet + ledger. Idempotent via unique (providerId, ruleId, periodKey).
   */
  async creditQualifiedRule(
    providerId: string,
    rule: { id: string; code: string; name: string; bonusAmount: number; period: string },
    periodKey: string,
    current: number,
    at: Date = new Date(),
  ): Promise<{ created: boolean; payoutId?: string; amount?: number }> {
    const amount = round2(rule.bonusAmount);
    if (amount <= 0) return { created: false };

    /**
     * Period keys moved from the UTC date to the business day (Asia/Kolkata). For the 5.5 h window
     * where the two disagree, a payout already written under the OLD key is the same bonus for the
     * same work, so it must not be paid again under the new key.
     *
     * The legacy lookup is bounded to rows written BEFORE the cutover. Without that bound it also
     * matched rows written under the NEW scheme: today's legacy key equals yesterday's business key,
     * so between 00:00 and 05:29 IST yesterday's payout suppressed today's legitimate one, every day,
     * forever (independent review, 2026-09-20).
     */
    const legacyKey = legacyUtcPeriodKey(rule.period, at);
    const legacyWhere =
      legacyKey === periodKey
        ? null
        : { providerId, ruleId: rule.id, periodKey: legacyKey, createdAt: { lt: LEGACY_PERIOD_KEY_CUTOVER } };

    const existing =
      (await prisma.partnerIncentivePayout.findFirst({ where: { providerId, ruleId: rule.id, periodKey } })) ??
      (legacyWhere ? await prisma.partnerIncentivePayout.findFirst({ where: legacyWhere }) : null);
    if (existing) return { created: false, payoutId: existing.id, amount: existing.amount };

    try {
      const result = await prisma.$transaction(async (tx) => {
        const dup =
          (await tx.partnerIncentivePayout.findFirst({ where: { providerId, ruleId: rule.id, periodKey } })) ??
          (legacyWhere ? await tx.partnerIncentivePayout.findFirst({ where: legacyWhere }) : null);
        if (dup) return { created: false as const, payoutId: dup.id, amount: dup.amount };

        const locked = await tx.$queryRaw<
          Array<{ user_id: string | null; wallet_balance: number; wallet_balance_paise: bigint | null }>
        >`
          SELECT user_id, wallet_balance, wallet_balance_paise
          FROM providers WHERE id = ${providerId} FOR UPDATE
        `;
        const provider = locked[0];
        if (!provider) throw new Error("PROVIDER_NOT_FOUND");

        const payout = await tx.partnerIncentivePayout.create({
          data: {
            providerId,
            ruleId: rule.id,
            amount,
            periodKey,
            status: "CREDITED",
          },
        });

        const amountPaise = rupeesToPaise(amount);
        const beforePaise = provider.wallet_balance_paise ?? rupeesToPaise(provider.wallet_balance);
        const afterPaise = beforePaise + amountPaise;
        const balanceBefore = paiseToRupees(beforePaise);
        const balanceAfter = paiseToRupees(afterPaise);

        await tx.provider.update({
          where: { id: providerId },
          data: {
            walletBalance: balanceAfter,
            walletBalancePaise: afterPaise,
          },
        });

        const walletTxn = await tx.walletTransaction.create({
          data: {
            transactionNumber: await nextWalletTxnNumber(tx),
            providerId,
            amount,
            amountPaise,
            walletBalanceBefore: balanceBefore,
            walletBalanceBeforePaise: beforePaise,
            walletBalanceAfter: balanceAfter,
            walletBalanceAfterPaise: afterPaise,
            type: WalletTxnType.BONUS,
            status: WalletTxnStatus.COMPLETED,
            description: `Incentive: ${rule.name}`,
            reason: rule.code,
            referenceId: payout.id,
            referenceType: "partner_incentive_payout",
            idempotencyKey: `partner_incentive_wallet:${providerId}:${rule.id}:${periodKey}`,
            completedAt: new Date(),
            metadata: JSON.stringify({ periodKey, progress: current }),
          },
        });

        await financialLedgerService.recordPartnerIncentiveInTransaction(tx, {
          payoutId: payout.id,
          providerId,
          ruleCode: rule.code,
          amount,
          periodKey,
        });

        return {
          created: true as const,
          payoutId: payout.id,
          amount,
          userId: provider.user_id,
          walletTxnId: walletTxn.id,
        };
      });

      if (result.created) {
        recordFinancialMetric("partner_incentive_payout_total", 1);
        recordFinancialMetric("partner_incentive_payout_amount", result.amount);
        const { buildPartnerIncentiveQualifiedEvent, buildPartnerIncentivePaidEvent } = await import(
          "../events/catalog/partner.events"
        );
        const { emitPartnerEvent } = await import("../events/core/partner-event-emit");
        void emitPartnerEvent(
          buildPartnerIncentiveQualifiedEvent({
            providerId,
            ruleId: rule.id,
            ruleCode: rule.code,
            amount: result.amount,
            periodKey,
          }),
        ).catch(() => undefined);
        void emitPartnerEvent(
          buildPartnerIncentivePaidEvent({
            providerId,
            payoutId: result.payoutId,
            ruleCode: rule.code,
            amount: result.amount,
            periodKey,
          }),
        ).catch(() => undefined);
        await AuditLogService.success("PARTNER_INCENTIVE_CREDITED", {
          userId: result.userId ?? undefined,
          details: {
            providerId,
            ruleCode: rule.code,
            periodKey,
            amount: result.amount,
            payoutId: result.payoutId,
            walletTxnId: result.walletTxnId,
          },
        });
        if (result.userId) {
          void notificationService
            .createForUser({
              userId: result.userId,
              type: "INCENTIVE",
              title: "Incentive bonus credited",
              message: `You earned ₹${result.amount} — ${rule.name}.`,
              referenceId: result.payoutId,
              priority: "high",
            })
            .catch(() => undefined);
          void earningsLiveService.broadcastEarningsUpdate(result.userId).catch(() => undefined);
        }
      }

      return result;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const raced = await prisma.partnerIncentivePayout.findUnique({
          where: { providerId_ruleId_periodKey: { providerId, ruleId: rule.id, periodKey } },
        });
        if (raced) return { created: false, payoutId: raced.id, amount: raced.amount };
      }
      throw err;
    }
  }

  /** Evaluate all active rules for a provider and credit any newly qualified incentives. */
  async evaluateAndCreditIncentives(providerId: string, now = new Date()) {
    const rules = await this.computeRuleProgress(providerId, now);
    const credited: Array<{ ruleCode: string; payoutId: string; amount: number }> = [];

    for (const rule of rules) {
      if (!rule.eligible || rule.paid) continue;
      const result = await this.creditQualifiedRule(
        providerId,
        {
          id: rule.id,
          code: rule.code,
          name: rule.name,
          bonusAmount: rule.bonusAmount,
          period: rule.period,
        },
        rule.periodKey,
        rule.current,
        now,
      );
      if (result.created && result.payoutId && result.amount != null) {
        credited.push({ ruleCode: rule.code, payoutId: result.payoutId, amount: result.amount });
      }
    }

    return { evaluated: rules.length, credited };
  }

  /**
   * Batch evaluation for the maintenance cron — recently active partners.
   *
   * The READ side is now one pass for the whole batch: the active-rule list was previously re-read
   * once per partner, and each partner cost four more queries to establish progress. At the default
   * limit that was ~1,200 round trips per tick. Measured against homigo_test with 118 providers and
   * 4 active rules: 525.8 ms / ~708 queries -> 27.1 ms / 6 queries, returning identical rule rows.
   *
   * The WRITE side is deliberately untouched. `creditQualifiedRule` still runs once per qualifying
   * partner, in its own transaction, idempotent on (providerId, ruleId, periodKey). Batching money
   * writes would trade a bounded cron cost for a shared failure domain across partners.
   *
   * BEHAVIOUR NOTE — one instant per tick. Each partner used to be evaluated at their own
   * `new Date()`, so a tick that straddled midnight judged some partners against one day and the
   * rest against the next, and could write two different `periodKey`s for the same run. `now` is now
   * fixed once for the batch, making a tick atomic with respect to period boundaries. This is a
   * behaviour change at that boundary and is recorded here rather than buried: pass an explicit
   * `now` to control it.
   */
  async evaluateRecentActiveProviders(limit = 200, now = new Date()) {
    const since = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const providers = await prisma.booking.findMany({
      where: { status: BookingStatus.COMPLETED, completedAt: { gte: since }, providerId: { not: null } },
      select: { providerId: true },
      distinct: ["providerId"],
      take: limit,
    });

    const providerIds = providers.flatMap((row) => (row.providerId ? [row.providerId] : []));
    const progressByProvider = await this.computeRuleProgressBatch(providerIds, now);

    let totalCredited = 0;
    for (const providerId of providerIds) {
      const rules = progressByProvider.get(providerId) ?? [];
      for (const rule of rules) {
        if (!rule.eligible || rule.paid) continue;
        const result = await this.creditQualifiedRule(
          providerId,
          {
            id: rule.id,
            code: rule.code,
            name: rule.name,
            bonusAmount: rule.bonusAmount,
            period: rule.period,
          },
          rule.periodKey,
          rule.current,
          now,
        );
        if (result.created) totalCredited += 1;
      }
    }
    return { providers: providerIds.length, credited: totalCredited };
  }
}

export const partnerIncentivePayoutService = new PartnerIncentivePayoutService();
