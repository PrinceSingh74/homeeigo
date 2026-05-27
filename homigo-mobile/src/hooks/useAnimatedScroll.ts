import { useSharedValue, useAnimatedScrollHandler } from "react-native-reanimated";

export function useAnimatedScroll() {
  const scrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  return { scrollY, scrollHandler };
}
