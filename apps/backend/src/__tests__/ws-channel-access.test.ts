import { describe, expect, it } from "bun:test";
import { mapUserRoleToWsType } from "../lib/ws-channel-access";

describe("mapUserRoleToWsType", () => {
  it("maps roles to websocket user types", () => {
    expect(mapUserRoleToWsType("CUSTOMER")).toBe("customer");
    expect(mapUserRoleToWsType("VENDOR")).toBe("vendor");
    expect(mapUserRoleToWsType("ADMIN")).toBe("admin");
  });
});
