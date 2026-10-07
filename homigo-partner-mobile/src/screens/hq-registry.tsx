import { Redirect, router } from "expo-router";
import { Compass } from "lucide-react-native";
import type { ComponentType } from "react";
import { PartnerScreen } from "@/components/PartnerScreen";
import { Button, EmptyState } from "@/components/ui";
import { HQ_REDIRECTS, findMenuItem } from "@/lib/hq-menu";
import { AvailabilityWorkspaceScreen } from "@/screens/availability-workspace";
import { MyCredentialsScreen } from "@/screens/hq-credentials";
import { MyServicesScreen } from "@/screens/hq-services";
import * as Account from "@/screens/hq-academy-account";
import * as Performance from "@/screens/hq-performance-ai-territory";
import * as Money from "@/screens/hq-work-earnings";
import { PartnerLiveMapScreen } from "@/screens/partner-live-map";

type ScreenComponent = ComponentType;

/**
 * The money and performance screens are owned elsewhere and are being rebuilt: an export may be
 * renamed or dropped. They are looked up by NAME at run time, so a missing one becomes the "not
 * available" screen for its row instead of a crash (or a type error) for the whole menu.
 */
function optional(module: object, name: string): ScreenComponent | undefined {
  const value = (module as Record<string, unknown>)[name];
  return typeof value === "function" ? (value as ScreenComponent) : undefined;
}

const money = (name: string) => optional(Money, name);
const performance = (name: string) => optional(Performance, name);

/** `/hq/<id>` → screen. An id with no entry (or whose optional screen is missing) renders "not available". */
export const HQ_SCREEN_REGISTRY: Record<string, ScreenComponent | undefined> = {
  // Work
  "account-availability": AvailabilityWorkspaceScreen,
  "work-hq": money("WorkHqScreen"),
  "work-schedule": money("WorkScheduleScreen"),
  "account-map": PartnerLiveMapScreen,
  "route-center": money("RouteCenterScreen"),
  "work-attendance": money("WorkAttendanceScreen"),
  "work-service-history": Account.ServiceHistoryScreen,
  // Earnings
  "earnings-hq": money("EarningsHqScreen"),
  "earnings-detail": money("EarningsDetailScreen"),
  wallet: money("WalletScreen"),
  "earnings-payouts": money("EarningsPayoutsScreen"),
  "earnings-incentives": money("EarningsIncentivesScreen"),
  "earnings-tax": money("EarningsTaxScreen"),
  "earnings-forecast": money("EarningsForecastScreen"),
  "account-invoices": Account.AccountInvoicesScreen,
  // Performance
  "performance-reviews": performance("PerformanceReviewsScreen"),
  "performance-scorecard": performance("PerformanceScorecardScreen"),
  "performance-career": performance("PerformanceCareerScreen"),
  "performance-rankings": performance("PerformanceRankingsScreen"),
  "performance-quality": performance("PerformanceQualityScreen"),
  "performance-analytics": performance("PerformanceAnalyticsScreen"),
  // Assistant and insights
  "ai-assistant": performance("AiAssistantScreen"),
  "ai-demand-forecast": performance("AiDemandForecastScreen"),
  "ai-route": performance("AiRouteScreen"),
  "ai-intelligence": performance("AiIntelligenceScreen"),
  // Territory
  "territory-navigation": performance("TerritoryNavigationScreen"),
  "territory-heatmap": performance("TerritoryHeatmapScreen"),
  "territory-coverage": performance("TerritoryCoverageScreen"),
  "territory-analytics": performance("TerritoryAnalyticsScreen"),
  // Training and credentials
  "academy-training": Account.AcademyTrainingScreen,
  "academy-certifications": Account.AcademyCertificationsScreen,
  "academy-credentials": MyCredentialsScreen,
  "academy-services": MyServicesScreen,
  // Trust
  "trust-documents": Account.TrustDocumentsScreen,
  "trust-verification": Account.TrustVerificationScreen,
  "trust-compliance": Account.TrustComplianceScreen,
  // Rewards
  "rewards-hub": Account.RewardsHubScreen,
  "rewards-badges": Account.RewardsBadgesScreen,
  "rewards-referrals": Account.RewardsReferralsScreen,
  // Safety and wellbeing
  "wellbeing-sos": Account.WellbeingSosScreen,
  "wellbeing-insurance": Account.WellbeingInsuranceScreen,
  "wellbeing-community": Account.WellbeingCommunityScreen,
  // Account
  "account-profile": Account.AccountProfileScreen,
  "account-notifications": Account.AccountNotificationsScreen,
  "account-settings": Account.AccountSettingsScreen,
  "account-support": Account.AccountSupportScreen,
  "account-membership": Account.AccountMembershipScreen,
};

function NotAvailableScreen({ id }: { id: string }) {
  const known = findMenuItem(id);
  return (
    <PartnerScreen title={known?.item.label ?? "Not found"} showBack>
      <EmptyState
        icon={Compass}
        testID="hq-not-available"
        title={known ? "This screen is not available" : "There is no screen here"}
        message={known ? "It is not part of this version of the app. Everything else in HQ works as usual." : "The link you followed does not match a screen in the app."}
        action={<Button label="Open the HQ menu" variant="secondary" onPress={() => router.replace("/(tabs)/explore")} />}
      />
    </PartnerScreen>
  );
}

export function HqScreenById({ id }: { id: string }) {
  const redirect = HQ_REDIRECTS[id];
  if (redirect) return <Redirect href={redirect as never} />;
  const Screen = HQ_SCREEN_REGISTRY[id];
  if (!Screen) return <NotAvailableScreen id={id} />;
  return <Screen />;
}
