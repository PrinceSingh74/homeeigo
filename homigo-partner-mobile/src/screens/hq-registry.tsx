import type { ComponentType } from "react";
import { Text, View } from "react-native";
import { PartnerScreen } from "@/components/PartnerScreen";
import { findNavItem } from "@/lib/partner-navigation";
import { PartnerLiveMapScreen } from "@/screens/partner-live-map";
import {
  AcademyCertificationsScreen,
  AcademyTrainingScreen,
  AccountInvoicesScreen,
  AccountMembershipScreen,
  AccountNotificationsScreen,
  AccountProfileScreen,
  AccountSettingsScreen,
  AccountSupportScreen,
  RewardsBadgesScreen,
  RewardsHubScreen,
  RewardsReferralsScreen,
  TrustComplianceScreen,
  TrustDocumentsScreen,
  TrustVerificationScreen,
  WellbeingCommunityScreen,
  WellbeingInsuranceScreen,
  WellbeingSosScreen,
} from "@/screens/hq-academy-account";
import {
  AiAssistantScreen,
  AiDemandForecastScreen,
  AiIntelligenceScreen,
  AiRouteScreen,
  PerformanceAnalyticsScreen,
  PerformanceCareerScreen,
  PerformanceQualityScreen,
  PerformanceRankingsScreen,
  PerformanceReviewsScreen,
  PerformanceScorecardScreen,
  TerritoryAnalyticsScreen,
  TerritoryCoverageScreen,
  TerritoryHeatmapScreen,
  TerritoryNavigationScreen,
} from "@/screens/hq-performance-ai-territory";
import {
  EarningsDetailScreen,
  EarningsForecastScreen,
  EarningsHqScreen,
  EarningsIncentivesScreen,
  EarningsPayoutsScreen,
  EarningsTaxScreen,
  RouteCenterScreen,
  WalletLedgerScreen,
  WalletScreen,
  WorkAttendanceScreen,
  WorkHqScreen,
  WorkScheduleScreen,
  WorkServiceHistoryScreen,
} from "@/screens/hq-work-earnings";
import { AvailabilityWorkspaceScreen } from "@/screens/availability-workspace";
import { MyCredentialsScreen } from "@/screens/hq-credentials";
import { MyServicesScreen } from "@/screens/hq-services";
import { RequestsScreen } from "@/screens/RequestsScreen";

type ScreenComponent = ComponentType;

export const HQ_SCREEN_REGISTRY: Record<string, ScreenComponent> = {
  dashboard: DashboardRedirectScreen,
  "work-hq": WorkHqScreen,
  requests: () => <RequestsScreen embedded />,
  "route-center": RouteCenterScreen,
  "work-attendance": WorkAttendanceScreen,
  "work-schedule": WorkScheduleScreen,
  "account-availability": AvailabilityWorkspaceScreen,
  "work-service-history": WorkServiceHistoryScreen,
  "earnings-hq": EarningsHqScreen,
  "earnings-detail": EarningsDetailScreen,
  wallet: () => <WalletScreen />,
  "wallet-ledger": WalletLedgerScreen,
  "earnings-payouts": EarningsPayoutsScreen,
  "earnings-incentives": EarningsIncentivesScreen,
  "earnings-tax": EarningsTaxScreen,
  "earnings-forecast": EarningsForecastScreen,
  "performance-reviews": PerformanceReviewsScreen,
  "performance-scorecard": PerformanceScorecardScreen,
  "performance-career": PerformanceCareerScreen,
  "performance-rankings": PerformanceRankingsScreen,
  "performance-quality": PerformanceQualityScreen,
  "performance-analytics": PerformanceAnalyticsScreen,
  "ai-assistant": AiAssistantScreen,
  "ai-demand-forecast": AiDemandForecastScreen,
  "ai-route": AiRouteScreen,
  "ai-intelligence": AiIntelligenceScreen,
  "territory-navigation": TerritoryNavigationScreen,
  "territory-heatmap": TerritoryHeatmapScreen,
  "territory-coverage": TerritoryCoverageScreen,
  "territory-analytics": TerritoryAnalyticsScreen,
  "academy-training": AcademyTrainingScreen,
  "academy-certifications": AcademyCertificationsScreen,
  // Phase 11 capability self-service: declare skills, certifications, equipment, insurance, languages.
  "academy-credentials": MyCredentialsScreen,
  // The services the professional performs or has asked for, with readiness for each performing one.
  "academy-services": MyServicesScreen,
  "trust-documents": TrustDocumentsScreen,
  "trust-verification": TrustVerificationScreen,
  "trust-compliance": TrustComplianceScreen,
  "rewards-hub": RewardsHubScreen,
  "rewards-badges": RewardsBadgesScreen,
  "rewards-referrals": RewardsReferralsScreen,
  "wellbeing-insurance": WellbeingInsuranceScreen,
  "wellbeing-sos": WellbeingSosScreen,
  "wellbeing-community": WellbeingCommunityScreen,
  "account-profile": AccountProfileScreen,
  "account-notifications": AccountNotificationsScreen,
  "account-settings": AccountSettingsScreen,
  "account-support": AccountSupportScreen,
  "account-membership": AccountMembershipScreen,
  "account-invoices": AccountInvoicesScreen,
  // Replaces the previous link-out list (which only deep-linked to Google Maps in a browser)
  // with a real in-app map. See src/screens/partner-live-map.tsx.
  "account-map": PartnerLiveMapScreen,
};

function DashboardRedirectScreen() {
  const meta = findNavItem("dashboard");
  return (
    <PartnerScreen title={meta?.item.label ?? "Dashboard"} subtitle={meta?.item.subtitle} showBack>
      <View>
        <Text>Use the Home tab for your live dashboard.</Text>
      </View>
    </PartnerScreen>
  );
}

export function HqScreenById({ id }: { id: string }) {
  const Screen = HQ_SCREEN_REGISTRY[id];
  if (!Screen) {
    return (
      <PartnerScreen title="Not found" subtitle="This HQ screen is not available." showBack>
        <View />
      </PartnerScreen>
    );
  }
  return <Screen />;
}
