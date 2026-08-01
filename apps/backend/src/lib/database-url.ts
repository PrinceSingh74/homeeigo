/**
 * Normalize DATABASE_URL with Prisma PostgreSQL pool parameters.
 * Defaults are conservative for dev; raise via PRISMA_CONNECTION_LIMIT for load tests.
 */
export function resolvePrismaDatasourceUrl(): string {
  const raw = process.env.DATABASE_URL ?? "";
  if (!raw) return raw;

  try {
    const url = new URL(raw);
    if (!url.searchParams.has("connection_limit")) {
      const defaultLimit =
        process.env.PRISMA_CONNECTION_LIMIT ??
        (process.env.NODE_ENV === "production" ? "15" : "8");
      url.searchParams.set("connection_limit", defaultLimit);
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", process.env.PRISMA_POOL_TIMEOUT ?? "20");
    }
    return url.toString();
  } catch {
    return raw;
  }
}

export function prismaPoolConfigFromUrl(): { connectionLimit: number; poolTimeoutSec: number } {
  const raw = resolvePrismaDatasourceUrl();
  try {
    const url = new URL(raw);
    return {
      connectionLimit: Number(url.searchParams.get("connection_limit") ?? "25"),
      poolTimeoutSec: Number(url.searchParams.get("pool_timeout") ?? "20"),
    };
  } catch {
    return { connectionLimit: 25, poolTimeoutSec: 20 };
  }
}
