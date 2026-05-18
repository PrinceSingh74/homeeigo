import React, { useState } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { Search, Mic, SlidersHorizontal } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

export const SearchBar: React.FC = () => {
  const { colors: themeColors } = useTheme();
  const [text, setText] = useState("");

  const focusGlow = useSharedValue(0);
  const micScale = useSharedValue(1);

  const handleFocus = () => {
    focusGlow.value = withTiming(1, { duration: 300, easing: Easing.inOut(Easing.ease) });
  };

  const handleBlur = () => {
    focusGlow.value = withTiming(0, { duration: 300, easing: Easing.inOut(Easing.ease) });
  };

  const handleMicPress = () => {
    micScale.value = withTiming(0.92, { duration: 80, easing: Easing.inOut(Easing.ease) });
    setTimeout(() => {
      micScale.value = withTiming(1, { duration: 100, easing: Easing.inOut(Easing.ease) });
    }, 80);
  };

  const focusGlowStyle = useAnimatedStyle(() => ({
    borderColor: `rgba(37, 99, 235, ${focusGlow.value * 0.4})`,
    shadowColor: "#2563EB",
    shadowOpacity: focusGlow.value * 0.3,
  }));

  const micScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: micScale.value }],
  }));

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.searchBar,
          {
            backgroundColor: themeColors.cardBg,
          },
          shadowStyles.md,
          focusGlowStyle,
        ]}
      >
        <Search
          size={18}
          color="#94A3B8"
          style={styles.leftIcon}
        />

        <TextInput
          style={[
            styles.input,
            { color: themeColors.text },
          ]}
          placeholder="Search for a service…"
          placeholderTextColor="#94A3B8"
          value={text}
          onChangeText={setText}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />

        <Animated.View
          style={[
            styles.micButton,
            micScaleStyle,
          ]}
        >
          <TouchableOpacity onPress={handleMicPress} hitSlop={8}>
            <Mic size={18} color={themeColors.primary} />
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>

      {/* Filter Button */}
      <TouchableOpacity
        style={[
          styles.filterButton,
          {
            backgroundColor: themeColors.cardBg,
            borderColor: "rgba(0,0,0,0.05)",
          },
          shadowStyles.sm,
        ]}
      >
        <SlidersHorizontal size={18} color={themeColors.primary} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 24,
    marginTop: 4,
    marginBottom: 20,
  },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 28,
    paddingHorizontal: 16,
    paddingVertical: 13,
    height: 64,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.05)",
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 6,
  },
  leftIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    textAlignVertical: "center",
    height: "100%",
  },
  micButton: {
    padding: 6,
  },
  filterButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },
});
