/**
 * P3-9 — regression for a REAL defect found by service-backed execution of the AI-tools WRITE path.
 *
 * `bookingService.accept()` REPORTS refusal, it does not throw it: on a business refusal it
 * resolves with `{ ok: false, error: "PAYMENT_NOT_SETTLED" | "ALREADY_CLAIMED" | ... }`. The
 * acceptJob handler returned that object unchecked, so the execution engine — which treats any
 * resolved value as success — recorded SUCCESS.
 *
 * Observed against a real booking in an isolated database before the fix:
 *     ENGINE STATUS : SUCCESS
 *     RESULT PAYLOAD: {"ok":false,"error":"PAYMENT_NOT_SETTLED"}
 *     booking       : status PENDING, acceptedAt null   (nothing happened)
 *
 * So a job that was never accepted was reported to the partner as accepted, counted as a
 * successful execution in the metrics, and written to the tool audit as SUCCESS. `rejectJob` had
 * the same shape (`{ error: ... }` returned unchecked).
 *
 * The fix is NOT simply "throw": a business refusal must not be treated as a broken tool.
 * ALREADY_CLAIMED is the normal outcome when two partners race for one job, and the engine trips a
 * circuit breaker after 5 failures — so throwing a plain error would let five ordinary race losses
 * disable acceptJob for every partner for a minute. Hence `ToolDomainRejection`, which the engine
 * records as FAILED (with the domain's own code) while leaving the circuit breaker alone.
 */
import { describe, test, expect } from "bun:test";
import { ToolDomainRejection } from "../ai-tools/execution/errors";

describe("P3-9 — ToolDomainRejection carries the domain's own reason", () => {
  test("preserves the business error code rather than flattening it", () => {
    const e = new ToolDomainRejection("Job could not be accepted: ALREADY_CLAIMED", "ALREADY_CLAIMED");
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("ALREADY_CLAIMED");
    expect(e.name).toBe("ToolDomainRejection");
  });

  test("is NOT a ToolExecutionError — the engine must be able to tell them apart", async () => {
    const { ToolExecutionError } = await import("../ai-tools/execution/execution-engine");
    expect(new ToolDomainRejection("x", "CODE")).not.toBeInstanceOf(ToolExecutionError);
  });

  test("lives in a leaf module so handlers do not deepen the engine→registry→handlers cycle", async () => {
    const src = await Bun.file(`${import.meta.dir}/../ai-tools/execution/errors.ts`).text();
    // Any import here would be pulled in by both the engine and every handler.
    expect(src).not.toMatch(/^import /m);
  });
});

describe("P3-9 — the partner handlers surface domain refusals", () => {
  let code = "";
  test("acceptJob and rejectJob check the result instead of returning it unchecked", async () => {
    code = (await Bun.file(`${import.meta.dir}/../ai-tools/execution/handlers/index.ts`).text())
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/\s+/g, " ");
    // The exact shape that produced the false SUCCESS must not come back.
    expect(code).not.toContain("return bookingService.accept(providerId, String(args.bookingId));");
    expect(code).toContain("if (!accepted.ok)");
    expect(code).toContain("throw new ToolDomainRejection");
    expect(code).toContain('"error" in rejected');
  });
});

describe("P3-9 — the engine treats a domain refusal as failed-but-healthy", () => {
  let engine = "";
  test("no circuit-breaker penalty and no retry for a domain rejection", async () => {
    engine = (await Bun.file(`${import.meta.dir}/../ai-tools/execution/execution-engine.ts`).text())
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/\s+/g, " ");
    // Verified live: 7 consecutive rejections against a threshold of 5 left failures=0, open=false.
    expect(engine).toContain("if (!domainRejection) recordCircuitFailure(tool.toolId);");
    expect(engine).toContain("if (lastError instanceof ToolDomainRejection) break;");
    // Still not a success: the domain's code reaches the audit row.
    expect(engine).toContain("lastError instanceof ToolDomainRejection");
  });

  test("recordCircuitFailure is never called unconditionally", () => {
    expect(engine).not.toContain("EXECUTION_FAILED\"; recordCircuitFailure(tool.toolId);");
  });
});
