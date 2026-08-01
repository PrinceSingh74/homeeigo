import { Prisma } from "@prisma/client";

export type PrismaHttpMapping = {
  status: number;
  code: string;
  message: string;
  suggestion?: string;
  sentry: boolean;
  category?: "auth" | "payment" | "database" | "websocket" | "integration" | "security";
  level?: "fatal" | "error" | "warning";
};

/** Prisma pool timeout — all connections in use longer than pool_timeout. */
export function isPrismaPoolTimeout(error: unknown): boolean {
  return getPrismaErrorCode(error) === "P2024";
}

/** Postgres connection slot exhaustion surfaced as P2037 or init error text. */
export function isPrismaConnectionExhausted(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2037") {
    return true;
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return error.message.toLowerCase().includes("too many clients");
  }
  if (error instanceof Error) {
    return error.message.toLowerCase().includes("too many clients");
  }
  return false;
}

export function isPrismaConcurrencyError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2034" || error.code === "P2028" || error.code === "P2010";
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("write conflict") ||
      msg.includes("deadlock") ||
      msg.includes("serialization") ||
      msg.includes("could not serialize")
    );
  }
  return false;
}

export function isRetryablePrismaError(error: unknown): boolean {
  return (
    isPrismaPoolTimeout(error) ||
    isPrismaConcurrencyError(error) ||
    isPrismaConnectionExhausted(error)
  );
}

/** Extract Prisma error code from KnownRequestError or message text. */
export function getPrismaErrorCode(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  if (error instanceof Error) {
    const m = error.message.match(/\b(P20\d{2})\b/);
    if (m) return m[1] ?? null;
  }
  return null;
}

/** Map Prisma faults to HTTP responses — keeps 4xx/429 out of Sentry. */
export function mapPrismaKnownError(error: Prisma.PrismaClientKnownRequestError): PrismaHttpMapping | null {
  switch (error.code) {
    case "P2024":
      return {
        status: 429,
        code: "RATE_LIMIT_EXCEEDED",
        message: "Database pool busy — please retry shortly",
        suggestion: "Wait a moment and try again.",
        sentry: false,
      };
    case "P2037":
      return {
        status: 503,
        code: "SERVICE_UNAVAILABLE",
        message: "Database connection limit reached",
        suggestion: "Retry in a few seconds.",
        sentry: true,
        category: "database",
        level: "fatal",
      };
    case "P2002":
      return {
        status: 409,
        code: "CONFLICT",
        message: "Record already exists",
        sentry: false,
      };
    case "P2003":
      return {
        status: 400,
        code: "INVALID_REFERENCE",
        message: "Referenced record does not exist",
        sentry: false,
      };
    case "P2034":
    case "P2028":
      return {
        status: 409,
        code: "CONFLICT",
        message: "Transaction conflict — please retry",
        suggestion: "Retry the request; another operation updated the same record.",
        sentry: false,
      };
    case "P2010": {
      const msg = error.message.toLowerCase();
      if (msg.includes("deadlock") || msg.includes("serialization")) {
        return {
          status: 409,
          code: "CONFLICT",
          message: "Database conflict — please retry",
          sentry: false,
        };
      }
      return null;
    }
    case "P2032":
      return {
        status: 422,
        code: "DATA_INTEGRITY",
        message: "Stored data is incompatible with the current schema",
        sentry: true,
        category: "database",
      };
    default:
      return null;
  }
}

/** Domain `Error` messages that must not become anonymous 500s. */
export function mapDomainError(message: string): PrismaHttpMapping | null {
  if (message.startsWith("INVALID_TRANSITION:")) {
    return {
      status: 409,
      code: "INVALID_TRANSITION",
      message: "Invalid workflow transition",
      sentry: false,
    };
  }
  if (message === "LEDGER_UNBALANCED" || message === "LEDGER_MIN_TWO_LINES") {
    return {
      status: 422,
      code: message,
      message: "Ledger entry is not balanced",
      sentry: true,
      category: "database",
    };
  }
  if (message.startsWith("LEDGER_UNKNOWN_ACCOUNT:")) {
    return {
      status: 422,
      code: "LEDGER_UNKNOWN_ACCOUNT",
      message: "Unknown ledger account",
      sentry: true,
      category: "database",
    };
  }
  if (message === "CHARGEBACK_NOT_FOUND") {
    return { status: 404, code: "NOT_FOUND", message: "Chargeback not found", sentry: false };
  }
  if (message.includes("Unsupported state or unable to authenticate data")) {
    return {
      status: 500,
      code: "ENCRYPTION_ERROR",
      message: "Unable to decrypt stored data",
      sentry: true,
      category: "security",
    };
  }
  if (message.includes("JSON.stringify cannot serialize BigInt")) {
    return {
      status: 500,
      code: "SERIALIZATION_ERROR",
      message: "Internal serialization error",
      sentry: true,
    };
  }
  return null;
}
