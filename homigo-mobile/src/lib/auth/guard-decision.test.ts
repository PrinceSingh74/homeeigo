import { describe, expect, it } from "bun:test";
import { authGuardDecision, shouldNavigateToSignIn } from "./guard-decision";

describe("authGuardDecision", () => {
  it("waits while the session is unknown — before bootstrap starts and while it runs", () => {
    expect(authGuardDecision("idle", false)).toBe("wait");
    expect(authGuardDecision("initializing", false)).toBe("wait");
  });

  it("renders for a signed-in customer and asks a signed-out one to sign in", () => {
    expect(authGuardDecision("authenticated", true)).toBe("render");
    expect(authGuardDecision("unauthenticated", false)).toBe("sign_in");
    // "authenticated" without a user object is not a usable session.
    expect(authGuardDecision("authenticated", false)).toBe("sign_in");
  });
});

describe("shouldNavigateToSignIn", () => {
  it("never navigates before the navigation container is ready", () => {
    expect(shouldNavigateToSignIn("sign_in", false)).toBe(false);
  });

  it("navigates only for a signed-out customer once navigation is ready", () => {
    expect(shouldNavigateToSignIn("sign_in", true)).toBe(true);
    expect(shouldNavigateToSignIn("wait", true)).toBe(false);
    expect(shouldNavigateToSignIn("render", true)).toBe(false);
  });
});
