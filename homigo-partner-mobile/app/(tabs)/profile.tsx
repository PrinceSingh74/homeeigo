import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { HqLinkRow } from "@/components/HqUi";
import { PartnerScreen } from "@/components/PartnerScreen";
import { Card, Section } from "@/components/ui";
import { usePullRefresh } from "@/hooks/account/queries";
import { findMenuItem } from "@/lib/hq-menu";
import { hqIcon } from "@/lib/partner-navigation";
import { ProfileBody } from "@/screens/account/profile";
import { space } from "@/theme/tokens";

/** The account screens a partner reaches for from their profile, in the menu's own words. */
const LINKS = ["account-notifications", "account-support", "trust-documents", "account-availability", "account-settings", "wellbeing-sos"] as const;

export default function ProfileTab() {
  const qc = useQueryClient();
  const { refreshing, onRefresh } = usePullRefresh(
    { refetch: () => qc.invalidateQueries({ queryKey: ["partner", "user-profile"] }) },
    { refetch: () => qc.invalidateQueries({ queryKey: ["partner", "sessions"] }) },
  );
  return (
    <PartnerScreen title="Profile" refreshing={refreshing} onRefresh={onRefresh}>
      <ProfileBody />
      <Section title="More">
        <Card padded={false}>
          <View style={styles.rows}>
            {LINKS.map((id) => {
              const hit = findMenuItem(id);
              if (!hit) return null;
              return <HqLinkRow key={id} label={hit.item.label} subtitle={hit.item.subtitle} icon={hqIcon(hit.item.icon)} onPress={() => router.push(`/hq/${id}` as never)} />;
            })}
          </View>
        </Card>
      </Section>
    </PartnerScreen>
  );
}

const styles = StyleSheet.create({
  rows: { paddingHorizontal: space.lg },
});
