import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(import.meta.dir, "../../src/services/auth/api-client.ts"), "utf8");

describe("customer panel API origin", () => {
  test("login and refresh stay on this origin; the API port is only a failover", () => {
    expect(src).not.toMatch(/if \(path\.startsWith\("\/api\/auth\/"\)\) return \[direct, ""\]/);
    expect(src).toMatch(/return \["", direct\]/);
  });
});
