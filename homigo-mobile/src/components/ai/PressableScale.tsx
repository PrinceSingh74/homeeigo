import React, { forwardRef } from "react";
import { Pressable, type PressableProps, type ViewStyle, type StyleProp } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  haptic?: boolean;
  children?: React.ReactNode;
};

/**
 * Buttery-smooth Pressable with spring scale + optional haptic.
 * Used for every tappable surface on the AI screen.
 */
export const PressableScale = forwardRef<any, Props>(function PressableScale(
  { children, style, scaleTo = 0.96, haptic = false, onPressIn, onPressOut, onPress, ...rest },
  ref,
) {
  const scale = useSharedValue(1);

  const aStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      ref={ref}
      style={[style, aStyle]}
      onPressIn={(e) => {
        scale.value = withSpring(scaleTo, { damping: 18, stiffness: 320, mass: 0.6 });
        if (haptic) {
          Haptics.selectionAsync().catch(() => {});
        }
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, { damping: 16, stiffness: 280, mass: 0.6 });
        onPressOut?.(e);
      }}
      onPress={onPress}
      {...rest}
    >
      {children as any}
    </AnimatedPressable>
  );
});
