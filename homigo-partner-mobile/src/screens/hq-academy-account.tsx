/**
 * The account-side HQ screens. This file used to hold all of them (760 lines); each group now lives
 * in its own file under `src/screens/account/`, and this is the one place `hq-registry.tsx` imports
 * them from.
 */
export { AcademyCertificationsScreen, AcademyTrainingScreen } from "@/screens/account/academy";
export { AccountNotificationsScreen } from "@/screens/account/notifications";
export { AccountProfileScreen, ProfileBody } from "@/screens/account/profile";
export { AccountInvoicesScreen, AccountMembershipScreen, ServiceHistoryScreen } from "@/screens/account/records";
export { RewardsBadgesScreen, RewardsHubScreen, RewardsReferralsScreen } from "@/screens/account/rewards";
export { AccountSettingsScreen } from "@/screens/account/settings";
export { AccountSupportScreen } from "@/screens/account/support";
export { TrustComplianceScreen, TrustDocumentsScreen, TrustVerificationScreen } from "@/screens/account/trust";
export { WellbeingCommunityScreen, WellbeingInsuranceScreen, WellbeingSosScreen } from "@/screens/account/wellbeing";
export { AvailabilityWorkspaceScreen as AccountAvailabilityScreen } from "@/screens/availability-workspace";
