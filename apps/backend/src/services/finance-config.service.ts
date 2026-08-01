import prisma from "../lib/prisma";
import { AuditLogService } from "./audit-log.service";

/** Supported finance intelligence config keys. */
export const FINANCE_CONFIG_KEYS = {
  OPERATING_EXPENSE_MONTHLY: "OPERATING_EXPENSE_MONTHLY",
  CASH_ON_HAND: "CASH_ON_HAND",
  PAYMENT_GATEWAY_FEE_PCT: "PAYMENT_GATEWAY_FEE_PCT",
} as const;

export type FinanceConfigKey = (typeof FINANCE_CONFIG_KEYS)[keyof typeof FINANCE_CONFIG_KEYS];

const KEY_SET = new Set<string>(Object.values(FINANCE_CONFIG_KEYS));
const DEFAULT_GATEWAY_FEE_PCT = 2;

export type ConfigValueSource = "db" | "env" | "default";

export type ResolvedFinanceConfig = {
  operatingExpenseMonthly: number | null;
  cashOnHand: number | null;
  gatewayFeePct: number;
  sources: {
    operatingExpenseMonthly: ConfigValueSource | "missing";
    cashOnHand: ConfigValueSource | "missing";
    gatewayFeePct: ConfigValueSource | "missing";
  };
  updatedAt: Record<string, string | null>;
  updatedBy: Record<string, string | null>;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function readEnvNum(key: string): number | null {
  const raw = process.env[key];
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function isValidKey(key: string): key is FinanceConfigKey {
  return KEY_SET.has(key);
}

export class FinanceConfigService {
  /** Resolve config: DB first, then env fallback (backward compat), then default for gateway fee only. */
  async resolve(): Promise<ResolvedFinanceConfig> {
    const rows = await prisma.financeConfig.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));

    const resolveKey = (
      key: FinanceConfigKey,
      envKey: string,
      defaultValue?: number,
    ): { value: number | null; source: ConfigValueSource | "missing" } => {
      const db = byKey.get(key);
      if (db != null && Number.isFinite(db.value)) {
        return { value: round2(db.value), source: "db" };
      }
      const env = readEnvNum(envKey);
      if (env != null) return { value: round2(env), source: "env" };
      if (defaultValue != null) return { value: defaultValue, source: "default" };
      return { value: null, source: "missing" };
    };

    const opex = resolveKey(FINANCE_CONFIG_KEYS.OPERATING_EXPENSE_MONTHLY, "OPERATING_EXPENSE_MONTHLY");
    const cash = resolveKey(FINANCE_CONFIG_KEYS.CASH_ON_HAND, "CASH_ON_HAND");
    const gateway = resolveKey(
      FINANCE_CONFIG_KEYS.PAYMENT_GATEWAY_FEE_PCT,
      "PAYMENT_GATEWAY_FEE_PCT",
      DEFAULT_GATEWAY_FEE_PCT,
    );

    const updatedAt: Record<string, string | null> = {};
    const updatedBy: Record<string, string | null> = {};
    for (const row of rows) {
      updatedAt[row.key] = row.updatedAt.toISOString();
      updatedBy[row.key] = row.updatedBy;
    }

    return {
      operatingExpenseMonthly: opex.value,
      cashOnHand: cash.value,
      gatewayFeePct: gateway.value ?? DEFAULT_GATEWAY_FEE_PCT,
      sources: {
        operatingExpenseMonthly: opex.source,
        cashOnHand: cash.source,
        gatewayFeePct: gateway.source,
      },
      updatedAt,
      updatedBy,
    };
  }

  async getAll() {
    const [rows, resolved] = await Promise.all([
      prisma.financeConfig.findMany({ orderBy: { key: "asc" } }),
      this.resolve(),
    ]);
    return {
      entries: rows,
      resolved,
      keys: Object.values(FINANCE_CONFIG_KEYS),
    };
  }

  async update(
    key: string,
    value: number,
    actor: { adminId: string; userId: string },
    meta?: { reason?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!isValidKey(key)) throw new Error("INVALID_CONFIG_KEY");
    if (!Number.isFinite(value) || value < 0) throw new Error("INVALID_VALUE");
    if (key === FINANCE_CONFIG_KEYS.PAYMENT_GATEWAY_FEE_PCT && value > 100) {
      throw new Error("INVALID_GATEWAY_FEE");
    }

    const existing = await prisma.financeConfig.findUnique({ where: { key } });
    const valueBefore = existing?.value ?? null;
    const rounded = round2(value);

    const config = await prisma.financeConfig.upsert({
      where: { key },
      create: { key, value: rounded, updatedBy: actor.adminId },
      update: { value: rounded, updatedBy: actor.adminId },
    });

    await prisma.financeConfigHistory.create({
      data: {
        configKey: key,
        valueBefore,
        valueAfter: rounded,
        changedBy: actor.adminId,
        reason: meta?.reason?.trim() || null,
        ipAddress: meta?.ipAddress ?? null,
        userAgent: meta?.userAgent ?? null,
      },
    });

    await AuditLogService.success("ADMIN_ACTION", {
      userId: actor.userId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      details: {
        action: "FINANCE_CONFIG_UPDATED",
        key,
        valueBefore,
        valueAfter: rounded,
        adminId: actor.adminId,
        reason: meta?.reason ?? null,
      },
    });

    return config;
  }

  async getHistory(opts: { key?: string; limit?: number } = {}) {
    const limit = Math.min(opts.limit ?? 50, 200);
    if (opts.key && !isValidKey(opts.key)) throw new Error("INVALID_CONFIG_KEY");

    return prisma.financeConfigHistory.findMany({
      where: opts.key ? { configKey: opts.key } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}

export const financeConfigService = new FinanceConfigService();
