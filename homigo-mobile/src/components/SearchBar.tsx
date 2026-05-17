import React, { useState } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Text,
} from "react-native";
import { Search, Mic } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

export const SearchBar: React.FC = () => {
  const { colors: themeColors } = useTheme();
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState("");
  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  const handleMicPress = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.9,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
  };

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.searchBar,
          {
            backgroundColor: themeColors.cardBg,
            borderColor: focused ? themeColors.primary : themeColors.border,
            borderWidth: 1,
          },
          shadowStyles.md,
        ]}
      >
        <Search
          size={20}
          color={themeColors.textSecondary}
          style={styles.leftIcon}
        />

        <TextInput
          style={[
            styles.input,
            { color: themeColors.text },
          ]}
          placeholder="Search for a service…"
          placeholderTextColor={themeColors.textSecondary}
          value={text}
          onChangeText={setText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />

        <Animated.View
          style={[
            styles.micButton,
            { transform: [{ scale: scaleAnim }] },
          ]}
        >
          <TouchableOpacity onPress={handleMicPress}>
            <Mic size={20} color={themeColors.primary} />
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/* Quick Filters Button */}
      <TouchableOpacity
        style={[
          styles.filterButton,
          {
            backgroundColor: themeColors.cardBg,
            borderColor: themeColors.border,
            borderWidth: 1,
          },
          shadowStyles.sm,
        ]}
      >
        <Text style={{ color: themeColors.primary, fontSize: 20 }}>≡</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    marginVertical: 16,
  },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 20,
    paddingHorizontal: 12,
    height: 50,
  },
  leftIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
  },
  micButton: {
    padding: 8,
  },
  filterButton: {
    width: 50,
    height: 50,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
});
