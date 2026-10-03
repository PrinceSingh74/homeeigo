/**
 * X-87 — the global error middleware classified ANY refused connection as the database being down.
 *
 * `isDatabaseError` matched message text (`connect econnrefused`, `connection refused`, `connection
 * timed out`), so a warehouse, Redis or HTTP upstream refusing a connection was answered
 * 503 "Database is not reachable. Start Docker…" and sent to Sentry as `category: database,
 * level: fatal`. Found by the X-84 red run (a warehouse ECONNREFUSED → that 503).
 *
 * Contract now: a database outage (Prisma's own error types / Prisma's own wording) keeps its
 * existing answer. A connection-level failure of anything else is 503 SERVICE_UNAVAILABLE with the
 * generic message — it does not name the database, does not tell the caller to start Docker, and is
 * reported as an integration error, not a fatal database event. Everything else stays a 500.
 */
import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { Elysia } from "elysia";
import { Prisma } from "@prisma/client";
import { errorMiddleware } from "../middleware/error.middleware";
import { connectionFailureCode } from "../lib/connection-errors";
import { observability } from "../lib/observability";

const capture = spyOn(observability, "captureException");
afterEach(() => capture.mockClear());
// A spy is process-global in bun; later files in the same run must get the real method back.
afterAll(() => capture.mockRestore());
const lastCapture = () => capture.mock.calls.at(-1)?.[1] as { category?: string; level?: string } | undefined;

function appThrowing(make: () => unknown) {
  return new Elysia().use(errorMiddleware).get("/boom", () => {
    throw make();
  });
}

async function hit(make: () => unknown) {
  const res = await appThrowing(make).handle(new Request("http://localhost/boom"));
  return { status: res.status, body: (await res.json()) as { success?: boolean; code?: string; error?: string; message?: string } };
}

const text = (b: Record<string, unknown>) => JSON.stringify(b).toLowerCase();

describe("X-87: a non-database connection failure is not reported as the database", () => {
  test("warehouse ECONNREFUSED → 503 SERVICE_UNAVAILABLE, no database wording", async () => {
    const { status, body } = await hit(() =>
      Object.assign(new Error("connect ECONNREFUSED 142.250.1.1:443"), { code: "ECONNREFUSED" }),
    );
    expect(status).toBe(503);
    expect(body.code).toBe("SERVICE_UNAVAILABLE");
    expect(text(body)).not.toContain("database");
    expect(text(body)).not.toContain("docker");
    // Reported as an integration failure, not a fatal database event.
    expect(lastCapture()?.category).toBe("integration");
    expect(lastCapture()?.level).toBe("error");
  });

  test("Redis-style 'Connection refused' with ECONNREFUSED on the cause → 503 SERVICE_UNAVAILABLE, not database", async () => {
    const { status, body } = await hit(() =>
      Object.assign(new Error("Connection refused"), { cause: { code: "ECONNREFUSED" } }),
    );
    expect(status).toBe(503);
    expect(body.code).toBe("SERVICE_UNAVAILABLE");
    expect(text(body)).not.toContain("database");
  });

  test("upstream 'connection timed out' (ETIMEDOUT) → 503 SERVICE_UNAVAILABLE, not database", async () => {
    const { status, body } = await hit(() =>
      Object.assign(new Error("connection timed out"), { code: "ETIMEDOUT" }),
    );
    expect(status).toBe(503);
    expect(body.code).toBe("SERVICE_UNAVAILABLE");
    expect(text(body)).not.toContain("database");
  });

  test("a message that merely mentions a refused connection, with no connection code, is a plain 500", async () => {
    const { status, body } = await hit(() => new Error("upstream said: connection refused by policy"));
    expect(status).toBe(500);
    expect(text(body)).not.toContain("database is not reachable");
  });
});

describe("X-87: a real database outage keeps its answer", () => {
  test("PrismaClientInitializationError → 503 database message (unchanged)", async () => {
    const { status, body } = await hit(
      () => new Prisma.PrismaClientInitializationError("Can't reach database server at `localhost:5433`", "6.19.3"),
    );
    expect(status).toBe(503);
    expect(body.code).toBe("SERVICE_UNAVAILABLE");
    expect(text(body)).toContain("database is not reachable");
    expect(lastCapture()?.category).toBe("database");
    expect(lastCapture()?.level).toBe("fatal");
  });

  test("P1001 known request error → 503 database message (unchanged)", async () => {
    const { status, body } = await hit(
      () => new Prisma.PrismaClientKnownRequestError("Can't reach database server", { code: "P1001", clientVersion: "6.19.3" }),
    );
    expect(status).toBe(503);
    expect(text(body)).toContain("database is not reachable");
  });

  test("Prisma's wording re-thrown as a plain Error → still the database (unchanged)", async () => {
    const { status, body } = await hit(() => new Error("Can't reach database server at `localhost:5433`"));
    expect(status).toBe(503);
    expect(text(body)).toContain("database is not reachable");
  });
});

describe("connectionFailureCode", () => {
  test("reads the code from the error or its cause; null for anything else", () => {
    expect(connectionFailureCode(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe("ECONNRESET");
    expect(connectionFailureCode(Object.assign(new Error("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }))).toBe("UND_ERR_CONNECT_TIMEOUT");
    expect(connectionFailureCode(Object.assign(new Error("x"), { code: "P2002" }))).toBeNull();
    expect(connectionFailureCode(Object.assign(new Error("x"), { code: 503 }))).toBeNull();
    expect(connectionFailureCode(null)).toBeNull();
  });
});
