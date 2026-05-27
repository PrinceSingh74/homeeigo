import React from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
} from "react-native";
import { X, Check, Crown, Star, ArrowRight } from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { LocationSheet } from "@/components/booking/LocationSheet";
import { PressableScale } from "@/components/ai/PressableScale";
import { useAppStore } from "@/lib/store";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import { useTheme } from "@/hooks/useTheme";
import { PROFILE_ADDRESSES } from "@/lib/profile-mobile-data";
import { WALLET_TXNS } from "@/lib/wallet-mobile-data";
import { Smartphone, CreditCard } from "lucide-react-native";
import { SERVICES_NOTIFICATIONS } from "@/lib/services-notifications";
import {
  CATEGORIES,
  AI_RECOMMENDATIONS,
  TRENDING_SERVICES,
  CUSTOMER_REVIEWS,
} from "@/constants/servicesData";
import { serviceType, fontFamily } from "@/theme/typography";
import { layout } from "@/theme/layout";
import { sheetHandle } from "@/lib/booking-ui";

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
  const setPremium = useAppStore((s) => s.setPremium);
  const isPremium = useAppStore((s) => s.isPremium);
  const showToast = useAppStore((s) => s.showToast);
  const {
    book,
    closeOverlay: close,
    goAi,
    openNotifications,
    openAddresses,
  } = useAppNavigation();
  const { colors: c } = useTheme();

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
          {SERVICES_NOTIFICATIONS.map((n) => {
            const Icon = n.icon;
            return (
              <PressableScale
                key={n.id}
                haptic
                onPress={() => handleBook(n.serviceId, n.promo)}
                style={[styles.notifRow, { borderColor: c.border, backgroundColor: c.bg }]}
              >
                <View style={[styles.notifIcon, { backgroundColor: `${c.violet}22` }]}>
                  <Icon size={20} color={c.primary} />
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.rowTitle, { color: c.text }]}>{n.title}</Text>
                  <Text style={[styles.rowSub, { color: c.textSecondary }]}>{n.body}</Text>
                  <Text style={[styles.notifTime, { color: c.textSecondary }]}>{n.time}</Text>
                </View>
              </PressableScale>
            );
          })}
        </ScrollView>
      </SheetShell>

      <Modal
        visible={overlay === "premium"}
        animationType="slide"
        transparent
        onRequestClose={closeOverlay}
      >
        <Pressable style={styles.backdrop} onPress={closeOverlay} />
        <View style={[styles.sheet, { backgroundColor: c.cardBg }]}>
          <View style={sheetHandle} />
          <View style={styles.sheetHead}>
            <Text style={[styles.sheetTitle, { color: c.text }]}>
              HOMIGO Premium
            </Text>
            <Pressable onPress={closeOverlay} hitSlop={12}>
              <X size={22} color={c.textSecondary} />
            </Pressable>
          </View>
          <LinearGradient
            colors={[c.primary, "#8B3DFF", "#9C4AFF"]}
            style={styles.premiumHero}
          >
            <Crown size={36} color={c.gold} fill={c.gold} />
            <Text style={styles.premiumPrice}>₹499 / month</Text>
            <Text style={styles.premiumTrial}>7-day free trial · Cancel anytime</Text>
            <View style={styles.premiumStars}>
              <Star size={14} color={c.gold} fill={c.gold} />
              <Text style={styles.premiumStarsText}>Loved by 12,000+ members</Text>
            </View>
          </LinearGradient>
          <ScrollView contentContainerStyle={styles.premiumBenefits}>
            {[
              "Priority booking & elite professionals",
              "24/7 premium support",
              "Free revisits on eligible services",
              "AI-optimized scheduling & pricing",
            ].map((b) => (
              <View key={b} style={styles.benefitRow}>
                <Check size={16} color={c.success} strokeWidth={3} />
                <Text style={[styles.benefitText, { color: c.textSecondary }]}>{b}</Text>
              </View>
            ))}
          </ScrollView>
          <PressableScale
            haptic
            onPress={() => {
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              ).catch(() => {});
              setPremium(true);
              closeOverlay();
            }}
            style={styles.premiumBtnWrap}
          >
            <LinearGradient
              colors={[c.primary, c.violet]}
              style={styles.premiumBtn}
            >
              <Text style={styles.premiumBtnText}>
                {isPremium ? "You're a Premium member" : "Start free trial"}
              </Text>
              {!isPremium && <ArrowRight size={18} color="#fff" />}
            </LinearGradient>
          </PressableScale>
        </View>
      </Modal>

      <SheetShell
        visible={overlay === "categories"}
        title="All categories"
        onClose={closeOverlay}
      >
        <ScrollView contentContainerStyle={styles.list}>
          {CATEGORIES.map((cat) => (
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
          {TRENDING_SERVICES.map((item) => (
            <ListRow
              key={item.id}
              title={item.title}
              subtitle={`★ ${item.rating} · ₹${item.price} · ${item.duration}`}
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
          {AI_RECOMMENDATIONS.map((item) => (
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
          {CUSTOMER_REVIEWS.map((r) => (
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
          {PROFILE_ADDRESSES.filter((a) => a.type !== "add").map((a) => (
            <ListRow
              key={a.id}
              title={`${a.type} · ${a.tag}`}
              subtitle={`${a.line1}\n${a.line2}`}
              onPress={() => {
                closeOverlay();
                showToast(`Delivering to ${a.type}`);
              }}
            />
          ))}
          <ListRow
            title="Add new address"
            trailing="+"
            onPress={() => showToast("Add address — demo")}
          />
        </ScrollView>
      </SheetShell>

      <SheetShell
        visible={overlay === "transactions"}
        title="Transaction history"
        onClose={closeOverlay}
      >
        <ScrollView contentContainerStyle={styles.list}>
          {WALLET_TXNS.map((t) => (
            <View
              key={t.id}
              style={[styles.row, { borderColor: c.border, backgroundColor: c.bg }]}
            >
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: c.text }]}>{t.title}</Text>
                <Text style={[styles.rowSub, { color: c.textSecondary }]}>{t.subtitle}</Text>
              </View>
              <Text
                style={[
                  styles.rowTrail,
                  { color: t.type === "credit" ? c.success : c.text },
                ]}
              >
                {t.type === "credit" ? "+" : ""}₹{Math.abs(t.amount)}
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
        <View style={[styles.referralBox, { backgroundColor: `${c.violet}18`, borderColor: c.border }]}>
          <Text style={[styles.referralTitle, { color: c.text }]}>Earn ₹200 per friend</Text>
          <Text style={[styles.referralSub, { color: c.textSecondary }]}>
            Share HOMIGO with friends. They get ₹150 off, you earn wallet cash.
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
          Funds reflect instantly in your HOMIGO wallet.
        </Text>
        {[
          { label: "UPI", icon: Smartphone, color: c.cyan },
          { label: "Debit / Credit Card", icon: CreditCard, color: c.primary },
        ].map((o) => {
          const Icon = o.icon;
          return (
            <PressableScale
              key={o.label}
              haptic
              onPress={() => {
                showToast(`${o.label} payment — demo`);
                closeOverlay();
              }}
              style={[styles.row, { borderColor: c.border, backgroundColor: c.bg }]}
            >
              <Icon size={22} color={o.color} />
              <Text style={[styles.rowTitle, { color: c.text, flex: 1 }]}>{o.label}</Text>
              <ArrowRight size={18} color={c.primary} />
            </PressableScale>
          );
        })}
      </SheetShell>
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
