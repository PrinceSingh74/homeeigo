import React from "react";
import { Animated } from "react-native";
import { render, screen } from "@/test-utils/rntl";
import { FeatureBanner, bannerGreeting } from "./FeatureBanner";
import { useAuthStore } from "@/stores/auth-store";

jest.mock("@/hooks/use-core-data", () => ({
  useWalletBalanceQuery: () => ({ data: undefined }),
}));

describe("FeatureBanner", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("drives every endless Home animation on the native driver (none on the JS thread)", async () => {
    // Found on the emulator: seven height animations with useNativeDriver:false kept the JS thread
    // near 100 % on Home and under every screen stacked on it, including the live-tracking map.
    const timing = jest.spyOn(Animated, "timing");
    await render(<FeatureBanner />);
    expect(timing.mock.calls.length).toBeGreaterThanOrEqual(7 * 2);
    const onJsThread = timing.mock.calls.filter(([, config]) => config.useNativeDriver !== true);
    expect(onJsThread).toEqual([]);
    expect(screen.getAllByTestId("waveform-bar")).toHaveLength(7);
  });

  it("greets the signed-in customer by their own first name, never an invented one", async () => {
    useAuthStore.setState({ user: { firstName: "Priya" } as never });
    await render(<FeatureBanner />);
    expect(screen.getByText("Hi Priya! 👋")).toBeTruthy();
    expect(screen.queryByText(/Arjun/)).toBeNull();
  });

  it("says a neutral hello when no name is known", async () => {
    await render(<FeatureBanner />);
    expect(screen.getByText("Hi there! 👋")).toBeTruthy();
    expect(bannerGreeting("   ")).toBe("Hi there! 👋");
    expect(bannerGreeting(undefined)).toBe("Hi there! 👋");
  });
});
