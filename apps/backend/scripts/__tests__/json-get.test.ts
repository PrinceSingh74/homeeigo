/**
 * `scripts/json-get.ts` — the repository-local replacement for `jq` in the owner runbook.
 *
 *   cd apps/backend
 *   bun test "D:/homigo/apps/backend/scripts/__tests__/json-get.test.ts"
 *
 * Offline: every input is a literal in this file. No login, no HTTP, no database.
 */
import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";

const SCRIPT = join(resolve(import.meta.dir, "../.."), "scripts/json-get.ts");

function get(stdin: string, path?: string) {
  const r = Bun.spawnSync([process.execPath, SCRIPT, ...(path ? [path] : [])], {
    stdin: Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

describe("json-get", () => {
  test("prints the value at the path and nothing else", () => {
    // The shape of the platform's login response.
    const r = get(JSON.stringify({ success: true, data: { accessToken: "abc.def.ghi", user: { id: "u1" } } }), "data.accessToken");
    expect(r.code).toBe(0);
    expect(r.out).toBe("abc.def.ghi");
  });

  test("a failed login is an error, not the string `null`", () => {
    const r = get(JSON.stringify({ success: false, error: "INVALID_CREDENTIALS" }), "data.accessToken");
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toContain('"data" is not in the document');
    expect(r.err).toContain("success, error");
  });

  test("a null token, an empty token and an object are all refused", () => {
    expect(get(JSON.stringify({ data: { accessToken: null } }), "data.accessToken").code).toBe(1);
    expect(get(JSON.stringify({ data: { accessToken: "" } }), "data.accessToken").code).toBe(1);
    expect(get(JSON.stringify({ data: { accessToken: { nested: 1 } } }), "data.accessToken").code).toBe(1);
  });

  test("input that is not JSON, empty input and a missing path are refused with nothing on stdout", () => {
    const html = get("<html>502 Bad Gateway</html>", "data.accessToken");
    expect(html.code).toBe(1);
    expect(html.out).toBe("");
    expect(html.err).toContain("not JSON");
    expect(get("", "data.accessToken").code).toBe(1);
    expect(get("{}").code).toBe(1);
  });

  test("numbers and booleans are printed as text", () => {
    expect(get(JSON.stringify({ a: { n: 42, b: false } }), "a.n").out).toBe("42");
    expect(get(JSON.stringify({ a: { n: 42, b: false } }), "a.b").out).toBe("false");
  });
});
