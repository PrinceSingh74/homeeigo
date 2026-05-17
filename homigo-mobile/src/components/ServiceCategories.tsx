import React from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { Card } from "./Card";
import { shadowStyles } from "@/lib/colors";
import {
  Sparkles,
  Wind,
  Droplets,
  Zap,
  Bug,
  Scissors,
} from "lucide-react-native";

const { width } = Dimensions.get("window");

const services = [
  { id: 1, name: "Cleaning", icon: Sparkles, price: "₹199", gradient: ["#A855F7", "#EC4899"] },
  { id: 2, name: "AC Service", icon: Wind, price: "₹299", gradient: ["#06B6D4", "#0EA5E9"] },
  { id: 3, name: "Plumbing", icon: Droplets, price: "₹249", gradient: ["#3B82F6", "#60A5FA"] },
  { id: 4, name: "Electrician", icon: Zap, price: "₹249", gradient: ["#F59E0B", "#FCD34D"] },
  { id: 5, name: "Pest Control", icon: Bug, price: "₹299", gradient: ["#10B981", "#34D399"] },
  { id: 6, name: "Salon", icon: Scissors, price: "₹199", gradient: ["#EC4899", "#F472B6"] },
];

export const ServiceCategories: React.FC = () => {
  const { colors: themeColors } = useTheme();

  const renderServiceCard = ({ item, index }: any) => {
    const IconComponent = item.icon;
    const isFeatured = index === 0;

    return (
      <TouchableOpacity
        activeOpacity={0.8}
        style={{
          width: isFeatured ? width * 0.42 : width * 0.28,
        }}
      >
        <Card
          variant={isFeatured ? "premium" : "standard"}
          style={{
            height: 180,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: isFeatured ? themeColors.violet : themeColors.cardBg,
          }}
        >
          <View
            style={{
              width: 60,
              height: 60,
              borderRadius: 30,
              backgroundColor: isFeatured
                ? "rgba(255, 255, 255, 0.2)"
                : "rgba(37, 99, 235, 0.1)",
              justifyContent: "center",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <IconComponent
              size={32}
              color={isFeatured ? "white" : themeColors.primary}
            />
          </View>

          <Text
            style={[
              styles.serviceName,
              { color: isFeatured ? "white" : themeColors.text },
            ]}
          >
            {item.name}
          </Text>

          <Text
            style={[
              styles.servicePrice,
              { color: isFeatured ? "rgba(255, 255, 255, 0.8)" : themeColors.textSecondary },
            ]}
          >
            From {item.price}
          </Text>
        </Card>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
        <Text style={[styles.title, { color: themeColors.text }]}>
          Popular Services
        </Text>
      </View>
      <FlatList
        data={services}
        renderItem={renderServiceCard}
        keyExtractor={(item) => item.id.toString()}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        snapToInterval={width * 0.48}
        decelerationRate="fast"
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 260,
    marginVertical: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
  },
  listContent: {
    paddingHorizontal: 16,
    gap: 12,
  },
  serviceName: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  servicePrice: {
    fontSize: 12,
    fontWeight: "500",
  },
});
