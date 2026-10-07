import { router } from "expo-router";
import { SearchX } from "lucide-react-native";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { HqLinkRow } from "@/components/HqUi";
import { PartnerScreen } from "@/components/PartnerScreen";
import { Card, EmptyState, Field, Section } from "@/components/ui";
import { filterMenu } from "@/lib/hq-menu";
import { hqIcon } from "@/lib/partner-navigation";
import { space } from "@/theme/tokens";

/** The HQ menu: every screen that is not a tab, grouped, each row saying what its screen does. */
export function ExploreScreen() {
  const [query, setQuery] = useState("");
  const sections = useMemo(() => filterMenu(query), [query]);
  return (
    <PartnerScreen title="HQ">
      <Field label="Find a screen" value={query} onChangeText={setQuery} placeholder="For example: withdrawals" autoCorrect={false} autoCapitalize="none" returnKeyType="search" testID="hq-search" />
      {sections.length === 0 ? (
        <EmptyState icon={SearchX} title="No screen matches" message="Try a shorter word, or clear the search to see the whole menu." testID="hq-search-empty" />
      ) : (
        sections.map((section) => (
          <Section key={section.id} title={section.label}>
            <Card padded={false}>
              <View style={styles.rows}>
                {section.items.map((item) => (
                  <HqLinkRow key={item.id} label={item.label} subtitle={item.subtitle} icon={hqIcon(item.icon)} badgeLabel={item.badge} onPress={() => router.push(`/hq/${item.id}` as never)} />
                ))}
              </View>
            </Card>
          </Section>
        ))
      )}
    </PartnerScreen>
  );
}

const styles = StyleSheet.create({
  rows: { paddingHorizontal: space.lg },
});
