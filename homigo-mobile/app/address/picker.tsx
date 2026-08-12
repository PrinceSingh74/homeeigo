import React, { useEffect, useState } from "react";
import { View, Text, TextInput, FlatList, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useTheme } from "@/hooks/useTheme";
import { parityApi, type Prediction } from "@/services/core/parity-api";
import { useAddressPickStore } from "@/lib/address-pick-store";

/**
 * Address geo picker — Google-Places autocomplete via /api/geo/* (the same APIs the web uses).
 * Selecting a prediction resolves its coordinates and stores the result for the opening screen.
 */
export default function AddressPickerScreen() {
  const { colors: c } = useTheme();
  const router = useRouter();
  const setPicked = useAddressPickStore((s) => s.setPicked);
  const [input, setInput] = useState("");
  const [debounced, setDebounced] = useState("");
  const [near, setNear] = useState<{ lat: number; lng: number } | undefined>(undefined);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(input.trim()), 350);
    return () => clearTimeout(t);
  }, [input]);

  // Bias results to the user's current location when permission is granted.
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
        setNear({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      }
    })().catch(() => undefined);
  }, []);

  const predictionsQ = useQuery({
    queryKey: ["geo-autocomplete", debounced, near?.lat, near?.lng],
    queryFn: () => parityApi.geo.autocomplete(debounced, near),
    enabled: debounced.length >= 3,
  });

  async function choose(p: Prediction) {
    setResolving(true);
    try {
      const address = await parityApi.geo.place(p.placeId);
      setPicked(address);
      router.back();
    } catch {
      setResolving(false);
    }
  }

  async function useCurrentLocation() {
    if (!near) return;
    setResolving(true);
    try {
      const address = await parityApi.geo.reverse(near.lat, near.lng);
      setPicked(address);
      router.back();
    } catch {
      setResolving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Choose address" />
      <View style={{ padding: 16 }}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Search for area, street, landmark"
          placeholderTextColor={c.textSecondary}
          autoFocus
          style={{ borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: c.text, backgroundColor: c.cardBg }}
        />
        {near && (
          <Pressable onPress={useCurrentLocation} style={{ marginTop: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: c.primary, fontWeight: "600" }}>◎ Use my current location</Text>
          </Pressable>
        )}
      </View>
      {resolving ? (
        <ActivityIndicator color={c.primary} style={{ marginTop: 16 }} />
      ) : (
        <FlatList
          data={predictionsQ.data ?? []}
          keyExtractor={(p) => p.placeId}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          renderItem={({ item }: { item: Prediction }) => (
            <Pressable
              onPress={() => choose(item)}
              style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.border }}
            >
              <Text style={{ color: c.text }}>{item.description}</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            predictionsQ.isFetching ? (
              <ActivityIndicator color={c.primary} style={{ marginTop: 16 }} />
            ) : debounced.length >= 3 ? (
              <Text style={{ textAlign: "center", color: c.textSecondary, marginTop: 24 }}>No matches.</Text>
            ) : (
              <Text style={{ textAlign: "center", color: c.textSecondary, marginTop: 24 }}>Type at least 3 characters.</Text>
            )
          }
        />
      )}
    </View>
  );
}
