import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { Star } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";
import { RECOMMENDED } from "@/lib/services";
import { openBook } from "@/lib/navigation";

const { width } = Dimensions.get("window");
const CARD_W = width * 0.44;

export const RecommendedSection: React.FC = () => {
  const router = useRouter();
  const { colors: themeColors } = useTheme();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: themeColors.text }]}>
          Recommended for You
        </Text>
        <Pressable onPress={() => openBook(router)}>
          <Text style={[styles.seeAll, { color: themeColors.primary }]}>
            See all
          </Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
      >
        {RECOMMENDED.map((it) => (
          <Pressable
            key={it.title}
            onPress={() =>
              openBook(router, {
                service: it.serviceId,
                package: String(it.packageIndex),
              })
            }
            style={[
              styles.card,
              {
                width: CARD_W,
                backgroundColor: themeColors.cardBg,
                borderColor: themeColors.border,
              },
              shadowStyles.md,
            ]}
          >
            <Image source={{ uri: it.img }} style={styles.img} />
            <View style={styles.body}>
              <Text
                style={[styles.cardTitle, { color: themeColors.text }]}
                numberOfLines={1}
              >
                {it.title}
              </Text>
              <View style={styles.row}>
                <Text style={[styles.price, { color: themeColors.primary }]}>
                  {it.price}
                </Text>
                <View style={styles.rating}>
                  <Star size={12} color="#F59E0B" fill="#F59E0B" />
                  <Text style={{ color: themeColors.textSecondary, fontSize: 11 }}>
                    {it.rating}
                  </Text>
                </View>
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { marginVertical: 20 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    marginBottom: 14,
  },
  title: { fontSize: 20, fontWeight: "800" },
  seeAll: { fontSize: 13, fontWeight: "700" },
  list: { paddingHorizontal: 24, gap: 12 },
  card: {
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
  },
  img: { width: "100%", height: 120 },
  body: { padding: 12 },
  cardTitle: { fontSize: 14, fontWeight: "700", marginBottom: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  price: { fontSize: 16, fontWeight: "800" },
  rating: { flexDirection: "row", alignItems: "center", gap: 4 },
});
