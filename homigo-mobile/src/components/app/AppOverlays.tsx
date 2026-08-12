import React, { useEffect } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  Share,
} from "react-native";
import { X, ArrowRight, Bell } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { LocationSheet } from "@/components/booking/LocationSheet";
import { MembershipSheet } from "@/components/app/MembershipSheet";
import { PressableScale } from "@/components/ai/PressableScale";
import { useAppStore } from "@/lib/store";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "expo-router";
import { useWalletPayment } from "@/hooks/use-wallet-payment";
import {
  useNotificationsQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
  useAddressesQuery,
  useWalletTransactionsQuery,
} from "@/hooks/use-core-data";
import { formatAddressLine } from "@/lib/addresses";
import { CreditCard } from "lucide-react-native";
import { useServicesDiscovery } from "@/hooks/use-services-discovery";
import { useCustomerReviews } from "@/hooks/use-customer-reviews";
import { serviceType, fontFamily } from "@/components/services/theme/typography";
import { layout } from "@/components/services/theme/layout";
import { sheetHandle } from "@/lib/booking-ui";
import { CookieConsentBanner } from "@/components/legal/CookieConsentBanner";
import { useAfterInteractive } from "@/hooks/use-after-interactive";
import { coreApi } from "@/services/core/api";

function SheetShell({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { colors: c } = useTheme();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.cardBg }]}>
        <View style={sheetHandle} />
        <View style={styles.sheetHead}>
          <Text style={[styles.sheetTitle, { color: c.text }]}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
            <X size={22} color={c.textSecondary} />
          </Pressable>
        </View>
        {children}
      </View>
    </Modal>
  );
}

function ListRow({
  title,
  subtitle,
  trailing,
  onPress,
}: {
  title: string;
  subtitle?: string;
  trailing?: string;
  onPress: () => void;
}) {
  const { colors: c } = useTheme();

  return (
    <PressableScale
      haptic
      onPress={onPress}
      style={[styles.row, { borderColor: c.border, backgroundColor: c.bg }]}
    >
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: c.text }]} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.rowSub, { color: c.textSecondary }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? (
        <Text style={[styles.rowTrail, { color: c.primary }]}>{trailing}</Text>
      ) : (
        <ArrowRight size={18} color={c.primary} />
      )}
    </PressableScale>
  );
}

export function AppOverlays() {
  const overlay = useAppStore((s) => s.overlay);
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const showToast = useAppStore((s) => s.showToast);
  const {
    book,
    closeOverlay: close,
    goAi,
    openNotifications,
    openAddresses,
  } = useAppNavigation();
  const { colors: c } = useTheme();
  const router = useRouter();
  const { logout } = useAuth();
  const { topUp, isProcessing: walletPayProcessing } = useWalletPayment();
  const { data: notificationsData } = useNotificationsQuery({ enabled: overlay === "notifications" });
  const markRead = useMarkNotificationReadMutation();
  const markAllRead = useMarkAllNotificationsReadMutation();

  // Opening the sheet IS reading — clear the badge shortly after the list shows.
  const notifUnread = notificationsData?.unreadCount ?? 0;
  const markAllSilently = markAllRead.mutate;
  useEffect(() => {
    if (overlay !== "notifications" || notifUnread === 0) return;
    const t = setTimeout(() => markAllSilently(), 1200);
    return () => clearTimeout(t);
  }, [overlay, notifUnread, markAllSilently]);
  const { data: addressesData } = useAddressesQuery();
  const { data: walletTxData } = useWalletTransactionsQuery();
  const afterInteractive = useAfterInteractive();
  const { categories, trending, aiRecommendations } = useServicesDiscovery(afterInteractive);
  const { data: customerReviews = [] } = useCustomerReviews(8, afterInteractive);

  const handleBook = (serviceId: string, promo?: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    book({ service: serviceId, promo });
  };

  return (
    <>
      <LocationSheet visible={overlay === "location"} onClose={closeOverlay} />

      <SheetShell
        visible={overlay === "notifications"}
        title="Notifications"
        onClose={closeOverlay}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
        >
          {(notificationsData?.notifications ?? []).map((n) => (
              <PressableScale
                key={n.id}
                haptic
                onPress={() => {
                  if (!n.isRead) markRead.mutate(n.id);
                  if (n.referenceId) handleBook("cleaning");
                }}
                style={[styles.notifRow, { borderColor: c.border, backgroundColor: c.bg }]}
              >
                <View style={[styles.notifIcon, { backgroundColor: `${c.teal}22` }]}>
                  <Bell size={20} color={c.primary} />
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.rowTitle, { color: c.text }]}>{n.title}</Text>
                  <Text style={[styles.rowSub, { color: c.textSecondary }]}>{n.message}</Text>
                  <Text style={[styles.notifTime, { color: c.textSecondary }]}>
                    {new Date(n.createdAt).toLocaleString("en-IN")}
                  </Text>
                </View>
              </PressableScale>
            ))}
        </ScrollView>
      </SheetShell>

      <MembershipSheet visible={overlay === "premium"} onClose={closeOverlay} />

      <SheetShell
        visible={overlay === "categories"}
        title="All categories"
        onClose={closeOverlay}
      >
        <ScrollView contentContainerStyle={styles.list}>
          {categories.map((cat) => (
            <ListRow
              key={cat.id}
              title={`${cat.emoji} ${cat.name}`}
              subtitle={`${cat.count} services`}
              trailing="Book"
              onPress={() => handleBook(cat.serviceId)}
            />
          ))}
        </ScrollView>
      </SheetShell>

      <SheetShell
        visible={overlay === "trending"}
        title="Trending services"
        onClose={closeOverlay}
      >
        <ScrollView contentContainerStyle={styles.list}>
          {trending.map((item) => (
            <ListRow
              key={item.id}
              title={item.title}
              subtitle={`${item.rating != null ? `★ ${item.rating}` : "New"} · ₹${item.price} · ${item.duration}`}
              trailing="Book"
              onPress={() => handleBook(item.serviceId)}
            />
          ))}
        </ScrollView>
      </SheetShell>

      <SheetShell
        visible={overlay === "ai-recommendations"}
        title="AI recommendations"
        onClose={closeOverlay}
      >
        <ScrollView contentContainerStyle={styles.list}>
          {aiRecommendations.map((item) => (
            <ListRow
              key={item.id}
              title={`${item.emoji} ${item.title}`}
              subtitle={item.desc}
              trailing="Book"
              onPress={() => handleBook(item.serviceId)}
            />
          ))}
        </ScrollView>
      </SheetShell>

      <SheetShell
        visible={overlay === "reviews"}
        title="Customer reviews"
        onClose={closeOverlay}
      >
        <ScrollView contentContainerStyle={styles.list}>
          {customerReviews.map((r) => (
            <PressableScale
              key={r.id}
              haptic
              onPress={() => {
                close();
                book({ service: "cleaning" });
              }}
              style={[styles.reviewRow, { borderColor: c.border, backgroundColor: c.bg }]}
            >
              <View style={[styles.reviewAvatar, { backgroundColor: c.primary }]}>
                <Text style={styles.reviewInitial}>{r.initial}</Text>
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: c.text }]}>
                  {r.name} · {r.location}
                </Text>
                <Text style={[styles.reviewBody, { color: c.textSecondary }]}>
                  {r.review}
                </Text>
                <Text style={[styles.rowSub, { color: c.primary }]}>Book like {r.name} →</Text>
              </View>
            </PressableScale>
          ))}
        </ScrollView>
      </SheetShell>

      <SheetShell
        visible={overlay === "settings"}
        title="Settings"
        onClose={closeOverlay}
      >
        <ScrollView contentContainerStyle={styles.list}>
          {[
            { label: "Edit profile", action: () => { closeOverlay(); showToast("Edit profile"); } },
            {
              label: "Notifications",
              action: () => {
                closeOverlay();
                openNotifications();
              },
            },
            {
              label: "Saved addresses",
              action: () => {
                closeOverlay();
                openAddresses();
              },
            },
            {
              label: "Help & support",
              action: () => {
                closeOverlay();
                goAi();
              },
            },
            {
              label: "Change password",
              action: () => {
                closeOverlay();
                router.push("/change-password");
              },
            },
            {
              label: "Privacy Policy",
              action: () => {
                closeOverlay();
                router.push("/legal/privacy");
              },
            },
            {
              label: "Terms of Service",
              action: () => {
                closeOverlay();
                router.push("/legal/terms");
              },
            },
            {
              label: "Export my data (JSON)",
              action: () => {
                void (async () => {
                  try {
                    const data = await coreApi.users.exportData("json");
                    const text = JSON.stringify(data, null, 2);
                    await Share.share({ message: text.slice(0, 8000), title: "Homeeigo data export" });
                    showToast("Data export ready to share");
                  } catch {
                    showToast("Could not export data");
                  }
                })();
              },
            },
            {
              label: "Delete account",
              action: () => {
                Alert.alert(
                  "Delete account",
                  "Your account will be deactivated immediately. Data is permanently removed after 30 days unless you contact support to restore.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () => {
                        Alert.alert("Confirm deletion", "This cannot be undone from the app. Continue?", [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Yes, delete",
                            style: "destructive",
                            onPress: () => {
                              void (async () => {
                                try {
                                  await coreApi.users.deleteAccount("User requested via mobile app");
                                  closeOverlay();
                                  await logout();
                                  showToast("Account scheduled for deletion");
                                  router.replace("/login");
                                } catch {
                                  showToast("Could not delete account");
                                }
                              })();
                            },
                          },
                        ]);
                      },
                    },
                  ],
                );
              },
            },
            {
              label: "Sign out",
              action: () => {
                closeOverlay();
                void logout().then(() => {
                  showToast("Signed out");
                  router.replace("/login");
                });
              },
            },
          ].map((item) => (
            <ListRow
              key={item.label}
              title={item.label}
              onPress={item.action}
            />
          ))}
        </ScrollView>
      </SheetShell>

      <SheetShell
        visible={overlay === "addresses"}
        title="Saved addresses"
        onClose={closeOverlay}
      >
        <ScrollView contentContainerStyle={styles.list}>
          {(addressesData?.addresses ?? []).map((a) => (
            <ListRow
              key={a.id}
              title={a.label ?? "Address"}
              subtitle={formatAddressLine(a)}
              onPress={() => {
                closeOverlay();
                showToast(`Delivering to ${a.label ?? "address"}`);
              }}
            />
          ))}
          <ListRow
            title="Add new address"
            trailing="+"
            onPress={() => showToast("Add address from profile")}
          />
        </ScrollView>
      </SheetShell>

      <SheetShell
        visible={overlay === "transactions"}
        title="Transaction history"
        onClose={closeOverlay}
      >
        <ScrollView contentContainerStyle={styles.list}>
          {(walletTxData?.transactions ?? []).map((t) => (
            <View
              key={t.id}
              style={[styles.row, { borderColor: c.border, backgroundColor: c.bg }]}
            >
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: c.text }]}>
                  {t.description ?? t.reason ?? "Wallet transaction"}
                </Text>
                <Text style={[styles.rowSub, { color: c.textSecondary }]}>
                  {new Date(t.createdAt).toLocaleDateString("en-IN")}
                </Text>
              </View>
              <Text
                style={[
                  styles.rowTrail,
                  { color: t.type === "credit" ? c.success : c.text },
                ]}
              >
                {t.type === "credit" ? "+" : "-"}₹{Math.abs(t.amount)}
              </Text>
            </View>
          ))}
        </ScrollView>
      </SheetShell>

      <SheetShell
        visible={overlay === "referral"}
        title="Invite & earn"
        onClose={closeOverlay}
      >
        <View style={[styles.referralBox, { backgroundColor: `${c.teal}18`, borderColor: c.border }]}>
          <Text style={[styles.referralTitle, { color: c.text }]}>Earn ₹200 per friend</Text>
          <Text style={[styles.referralSub, { color: c.textSecondary }]}>
            Share Homeeigo with friends. They get ₹150 off, you earn wallet cash.
          </Text>
          <PressableScale
            haptic
            onPress={() => showToast("Referral link copied!")}
            style={[styles.referralBtn, { backgroundColor: c.primary }]}
          >
            <Text style={styles.referralBtnText}>Copy invite link</Text>
          </PressableScale>
        </View>
      </SheetShell>

      <SheetShell
        visible={overlay === "add-money"}
        title="Add money"
        onClose={closeOverlay}
      >
        <Text style={[styles.rowSub, { color: c.textSecondary, marginBottom: 12 }]}>
          Funds reflect instantly in your Homeeigo wallet.
        </Text>
        {[500, 1000, 2000].map((amount) => (
          <PressableScale
            key={amount}
            haptic
            disabled={walletPayProcessing}
            onPress={() => {
              void topUp(amount)
                .then(() => closeOverlay())
                .catch(() => showToast("Could not start payment"));
            }}
            style={[styles.row, { borderColor: c.border, backgroundColor: c.bg }]}
          >
            <CreditCard size={22} color={c.primary} />
            <Text style={[styles.rowTitle, { color: c.text, flex: 1 }]}>
              Add ₹{amount.toLocaleString("en-IN")}
            </Text>
            <ArrowRight size={18} color={c.primary} />
          </PressableScale>
        ))}
      </SheetShell>

      <CookieConsentBanner />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 10, 30, 0.52)",
  },
  sheet: {
    borderTopLeftRadius: layout.cardRadiusXl,
    borderTopRightRadius: layout.cardRadiusXl,
    paddingHorizontal: layout.screenPadding,
    paddingBottom: 32,
    maxHeight: "82%",
  },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  sheetTitle: {
    ...serviceType.sectionTitle,
    fontSize: 18,
  },
  list: {
    gap: 10,
    paddingBottom: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: layout.cardRadiusSm,
    borderWidth: 1,
    gap: 12,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: 14,
    lineHeight: 19,
  },
  rowSub: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  rowTrail: {
    fontFamily: fontFamily.semiBold,
    fontSize: 12,
  },
  notifRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 14,
    borderRadius: layout.cardRadiusSm,
    borderWidth: 1,
    gap: 12,
  },
  notifIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  notifTime: {
    fontFamily: fontFamily.regular,
    fontSize: 10,
    marginTop: 6,
  },
  premiumHero: {
    borderRadius: layout.cardRadius,
    padding: 22,
    alignItems: "center",
    marginBottom: 16,
  },
  premiumPrice: {
    fontFamily: fontFamily.bold,
    fontSize: 22,
    color: "#fff",
    marginTop: 10,
  },
  premiumTrial: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: "rgba(255,255,255,0.82)",
    marginTop: 4,
  },
  premiumStars: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  premiumStarsText: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    color: "rgba(255,255,255,0.9)",
  },
  premiumBenefits: {
    gap: 12,
    paddingBottom: 8,
  },
  benefitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  benefitText: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    flex: 1,
    lineHeight: 19,
  },
  premiumBtnWrap: { marginTop: 8 },
  premiumBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    borderRadius: layout.cardRadiusSm,
  },
  premiumBtnText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    color: "#fff",
  },
  reviewRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 14,
    borderRadius: layout.cardRadiusSm,
    borderWidth: 1,
    gap: 12,
  },
  reviewAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  reviewInitial: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    color: "#fff",
  },
  reviewBody: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 6,
  },
  referralBox: {
    padding: 18,
    borderRadius: layout.cardRadius,
    borderWidth: 1,
  },
  referralTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
  },
  referralSub: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
    marginBottom: 16,
  },
  referralBtn: {
    paddingVertical: 14,
    borderRadius: layout.cardRadiusSm,
    alignItems: "center",
  },
  referralBtnText: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    color: "#fff",
  },
});
