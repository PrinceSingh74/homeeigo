import { renderHook, act } from "@testing-library/react-native";
import { useFeatureFlagsStore } from "./feature-flags-store";
import { useFeatureFlag } from "@/hooks/use-feature-flag";

describe("FeatureFlagsStore", () => {
  beforeEach(() => {
    useFeatureFlagsStore.setState({
      flags: {
        AI_CONCIERGE: false,
      },
    });
  });

  it("should initialize with default flags", async () => {
    const { result } = await renderHook(() => useFeatureFlagsStore((state) => state.flags));
    expect(result.current.AI_CONCIERGE).toBe(false);
  });

  it("should set individual flag", async () => {
    const { result } = await renderHook(() => useFeatureFlagsStore());

    await act(() => {
      result.current.setFlag("AI_CONCIERGE", true);
    });

    expect(result.current.flags.AI_CONCIERGE).toBe(true);
  });

  it("should set multiple flags", async () => {
    const { result } = await renderHook(() => useFeatureFlagsStore());

    await act(() => {
      result.current.setFlags({
        AI_CONCIERGE: true,
      });
    });

    expect(result.current.flags.AI_CONCIERGE).toBe(true);
  });

  it("should check if flag is enabled", async () => {
    const { result } = await renderHook(() => useFeatureFlagsStore());

    await act(() => {
      result.current.setFlag("AI_CONCIERGE", true);
    });

    expect(result.current.isEnabled("AI_CONCIERGE")).toBe(true);

    await act(() => {
      result.current.setFlag("AI_CONCIERGE", false);
    });

    expect(result.current.isEnabled("AI_CONCIERGE")).toBe(false);
  });

  it("should return false for undefined flags", async () => {
    const { result } = await renderHook(() => useFeatureFlagsStore());
    expect(result.current.isEnabled("AI_CONCIERGE" as never)).toBe(false);
  });
});

describe("useFeatureFlag hook", () => {
  beforeEach(() => {
    useFeatureFlagsStore.setState({
      flags: {
        AI_CONCIERGE: false,
      },
    });
  });

  it("should return flag enabled state", async () => {
    const { result } = await renderHook(() => useFeatureFlag("AI_CONCIERGE"));
    expect(result.current).toBe(false);

    await act(() => {
      useFeatureFlagsStore.setState((state) => ({
        flags: { ...state.flags, AI_CONCIERGE: true },
      }));
    });

    expect(result.current).toBe(true);
  });

  it("should update when flag changes", async () => {
    const { result, rerender } = await renderHook(() => useFeatureFlag("AI_CONCIERGE"));
    expect(result.current).toBe(false);

    await act(() => {
      useFeatureFlagsStore.getState().setFlag("AI_CONCIERGE", true);
    });

    await rerender(undefined);
    expect(result.current).toBe(true);
  });
});
