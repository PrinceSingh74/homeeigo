import { describe, expect, test } from "bun:test";
import { bindActorContext, bindEventContextFromRequest, getEventContext } from "../events/core/event-context";
import { logger } from "../lib/logger";

describe("Section 10 request context", () => {
  test("logs inherit actor/partner/request ids without secrets", () => {
    bindEventContextFromRequest({
      traceId: "trace_s10",
      requestId: "req_s10",
      deviceId: "dev_s10",
    });
    bindActorContext({ actorId: "admin_1", actorType: "admin", partnerId: "prov_9" });
    const lines: string[] = [];
    const orig = console.log;
    console.log = (msg?: unknown) => {
      lines.push(String(msg));
    };
    try {
      logger.info("section10.context", { password: "hunter2", otp: "123456" });
    } finally {
      console.log = orig;
    }
    const joined = lines.join("\n");
    expect(joined).toContain("req_s10");
    expect(joined).toContain("admin_1");
    expect(joined).toContain("prov_9");
    expect(joined).not.toContain("hunter2");
    expect(joined).not.toContain("123456");
    expect(getEventContext().requestId).toBe("req_s10");
  });
});
