import { useMemo } from "react";
import { useWindowDimensions, PixelRatio } from "react-native";
import { aiSpacing } from "@/lib/ai-mobile-theme";

/** Responsive metrics for live-tracking / booking confirmed section */
export function useTrackingLayout() {
  const { width, height } = useWindowDimensions();

  return useMemo(() => {
    const screenW = width;
    const contentW = screenW - aiSpacing.screen * 2;
    const scale = Math.min(1.12, Math.max(0.82, contentW / 390));
    const isCompact = screenW < 360;
    const isSmall = screenW < 375;
    const isLarge = screenW >= 414;

    /** Map: ~52% of content width, clamped for all phones */
    const mapH = Math.round(
      Math.min(isLarge ? 360 : 320, Math.max(isCompact ? 200 : 220, contentW * 0.54)),
    );

    const riderSize = Math.round(Math.min(100, Math.max(64, 88 * scale)));
    const riderOffset = Math.round(riderSize / 2);

    return {
      screenW,
      contentW,
      scale,
      isCompact,
      isSmall,
      isLarge,
      mapH,
      riderSize,
      riderOffset,
      chipPadH: Math.round(5 * scale),
      chipPadW: Math.round(10 * scale),
      chipFont: Math.max(8, Math.round(9 * scale)),
      chipFontSm: Math.max(8, Math.round(10 * scale)),
      kmFont: Math.max(14, Math.round(16 * scale)),
      liveFont: Math.max(9, Math.round(10 * scale)),
      pinSize: Math.round(32 * scale),
      homePinSize: Math.round(36 * scale),
      etaBig: Math.round(Math.min(48, Math.max(36, 44 * scale))),
      etaUnit: Math.round(Math.min(20, Math.max(14, 18 * scale))),
      expertName: Math.round(Math.min(17, Math.max(14, 16 * scale))),
      avatarSize: Math.round(Math.min(60, Math.max(48, 56 * scale))),
      detailsPad: Math.round(Math.max(12, 14 * scale)),
      shellRadius: Math.round(Math.max(18, 22 * scale)),
      pixelDensity: PixelRatio.get(),
    };
  }, [width, height]);
}
