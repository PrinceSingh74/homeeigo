import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, ActivityIndicator } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { Search, MapPin, Users, Clock, X } from "lucide-react-native";
import { PressableScale } from "@/components/ai/PressableScale";
import { useServicesTheme } from "./ServicesThemeContext";
import { useCoverageSearch } from "@/hooks/use-core-data";
import { serviceType } from "@/components/services/theme/typography";
import { layout } from "@/components/services/theme/layout";

/**
 * Hyperlocal coverage search — society / area / pincode, powered by the same
 * GET /api/coverage/search endpoint the website uses. Results are entirely
 * backend-derived (partners nearby, expected arrival, availability today).
 */
export function CoverageSearch({ onOpenCity }: { onOpenCity: (slug: string, name: string) => void }) {
  const { c } = useServicesTheme();
  const [query, setQuery] = useState("");
  const { data, isFetching, debouncedQuery } = useCoverageSearch(query);

  const results = data?.results ?? [];
  const showPanel = debouncedQuery.length >= 2;

  return (
    <View style={styles.wrap}>
      <View style={[styles.field, { backgroundColor: "rgba(255,255,255,0.12)", borderColor: "rgba(255,255,255,0.22)" }]}>
        <Search size={17} color="#6ee7b7" strokeWidth={2.4} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Check your society, area or pincode"
          placeholderTextColor="rgba(255,255,255,0.55)"
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search coverage by society, area or pincode"
        />
        {isFetching ? (
          <ActivityIndicator size="small" color="#6ee7b7" />
        ) : query.length > 0 ? (
          <PressableScale
            onPress={() => setQuery("")}
            scaleTo={0.9}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <X size={16} color="rgba(255,255,255,0.7)" strokeWidth={2.4} />
          </PressableScale>
        ) : null}
      </View>

      {showPanel ? (
        <Animated.View entering={FadeIn.duration(200)} style={styles.panel}>
          {results.length === 0 && !isFetching ? (
            <Text style={styles.noResult}>
              We don&apos;t cover “{debouncedQuery}” yet — try a nearby area or pincode.
            </Text>
          ) : (
            results.map((r) => (
              <PressableScale
                key={`${r.type}:${r.label}:${r.citySlug}`}
                haptic
                scaleTo={0.98}
                onPress={() => onOpenCity(r.citySlug, r.cityName)}
                style={styles.result}
                accessibilityRole="button"
                accessibilityLabel={`${r.label}, ${r.sublabel}, ${r.partnersNearby} partners nearby`}
              >
                <View style={styles.resultIcon}>
                  <MapPin size={14} color="#6ee7b7" strokeWidth={2.4} />
                </View>
                <View style={styles.resultMain}>
                  <Text style={styles.resultLabel} numberOfLines={1}>
                    {r.label}
                  </Text>
                  <Text style={styles.resultSub} numberOfLines={1}>
                    {r.sublabel}
                  </Text>
                </View>
                <View style={styles.resultMeta}>
                  {r.covered ? (
                    <>
                      <View style={styles.metaRow}>
                        <Users size={10} color="#a7f3d0" strokeWidth={2.6} />
                        <Text style={styles.metaText}>{r.partnersNearby}</Text>
                      </View>
                      <View style={styles.metaRow}>
                        <Clock size={10} color="rgba(255,255,255,0.6)" strokeWidth={2.4} />
                        <Text style={styles.metaSub}>{r.expectedArrivalMins}m</Text>
                      </View>
                    </>
                  ) : (
                    <Text style={styles.metaSub}>Coming soon</Text>
                  )}
                </View>
              </PressableScale>
            ))
          )}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 52,
    paddingHorizontal: 16,
    borderRadius: layout.cardRadius,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    color: "#fff",
    fontFamily: serviceType.body.fontFamily,
    fontSize: 14,
    padding: 0,
  },
  panel: {
    gap: 8,
    padding: 8,
    borderRadius: layout.cardRadius,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  noResult: {
    ...serviceType.caption,
    color: "rgba(255,255,255,0.72)",
    textAlign: "center",
    paddingVertical: 14,
  },
  result: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: layout.cardRadiusSm,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  resultIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(52,211,153,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  resultMain: { flex: 1, minWidth: 0 },
  resultLabel: { color: "#fff", fontSize: 13.5, fontWeight: "800", letterSpacing: -0.2 },
  resultSub: { color: "rgba(255,255,255,0.62)", fontSize: 11, marginTop: 1 },
  resultMeta: { alignItems: "flex-end", gap: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaText: { color: "#a7f3d0", fontSize: 11.5, fontWeight: "800" },
  metaSub: { color: "rgba(255,255,255,0.55)", fontSize: 10.5, fontWeight: "600" },
});
