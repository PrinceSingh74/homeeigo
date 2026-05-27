import { FadeInDown, FadeInRight, FadeInUp, ZoomIn } from "react-native-reanimated";

export const profileEnter = {
  header: FadeInDown.duration(420).springify().damping(16),
  hero: FadeInUp.delay(60).duration(520).springify().damping(14),
  premium: FadeInUp.delay(120).duration(560).springify().damping(14),
  stat: (i: number) =>
    ZoomIn.delay(160 + i * 45)
      .duration(380)
      .springify()
      .damping(12),
  section: FadeInUp.delay(200).duration(480).springify().damping(14),
  row: (i: number) =>
    FadeInRight.delay(240 + i * 70)
      .duration(400)
      .springify()
      .damping(14),
};
