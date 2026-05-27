import { FadeInDown, FadeInUp, ZoomIn } from "react-native-reanimated";

/** Staggered section entrance — wallet screen */
export const walletEnter = {
  header: FadeInDown.duration(400).springify().damping(16),
  hero: FadeInUp.delay(80).duration(600).springify().damping(14),
  quick: (i: number) =>
    ZoomIn.delay(120 + i * 50)
      .duration(400)
      .springify()
      .damping(12),
  overview: (i: number) =>
    ZoomIn.delay(200 + i * 60)
      .duration(400)
      .springify()
      .damping(12),
  txn: (i: number) =>
    FadeInUp.delay(280 + i * 80)
      .duration(400)
      .springify()
      .damping(14),
  premium: FadeInUp.delay(380).duration(500).springify().damping(14),
};
