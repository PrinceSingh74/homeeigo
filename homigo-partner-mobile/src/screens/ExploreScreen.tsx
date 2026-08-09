import { router } from "expo-router";
import { HqCard, HqCardTitle, HqLinkRow } from "@/components/HqUi";
import { PartnerScreen } from "@/components/PartnerScreen";
import { PARTNER_HQ_NAV } from "@/lib/partner-navigation";

export function ExploreScreen() {
  return (
    <PartnerScreen title="Partner OS" subtitle="Full HQ navigation — same modules as partner-web.">
      {PARTNER_HQ_NAV.map((section) => (
        <HqCard key={section.id}>
          <HqCardTitle>{section.label}</HqCardTitle>
          {section.items.map((item) => (
            <HqLinkRow
              key={item.id}
              label={item.label}
              subtitle={item.subtitle}
              icon={item.icon}
              badgeLabel={item.badgeLabel}
              onPress={() => router.push(`/hq/${item.id}`)}
            />
          ))}
        </HqCard>
      ))}
    </PartnerScreen>
  );
}
