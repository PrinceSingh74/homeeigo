import { describe, expect, test } from "bun:test";
import { coordinatedRefresh, resetRefreshCoordinator } from "./refresh-coordinator";

describe("refresh-coordinator", () => {
  test("concurrent refresh calls share one in-flight promise", async () => {
    resetRefreshCoordinator();
    let calls = 0;
    const slowRefresh = () =>
      new Promise<boolean>((resolve) => {
        calls++;
        setTimeout(() => resolve(true), 30);
      });

    const [a, b, c] = await Promise.all([
      coordinatedRefresh(slowRefresh),
      coordinatedRefresh(slowRefresh),
      coordinatedRefresh(slowRefresh),
    ]);

    expect(calls).toBe(1);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(c).toBe(true);
  });

  test("second refresh after first completes issues new call", async () => {
    resetRefreshCoordinator();
    let calls = 0;
    const refresh = async () => {
      calls++;
      return true;
    };
    await coordinatedRefresh(refresh);
    await coordinatedRefresh(refresh);
    expect(calls).toBe(2);
  });
});
