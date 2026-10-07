import type { LucideIcon } from "lucide-react-native";
import {
  Activity,
  Award,
  BadgeCheck,
  Banknote,
  BarChart3,
  Bell,
  Brain,
  Briefcase,
  Calendar,
  ClipboardCheck,
  Clock,
  Compass,
  Crown,
  FileText,
  Gauge,
  Gift,
  GraduationCap,
  HeartPulse,
  HelpCircle,
  History,
  IdCard,
  Landmark,
  Lightbulb,
  Map,
  MapPinned,
  MessageSquare,
  Navigation2,
  Receipt,
  Route,
  ScrollText,
  Settings,
  ShieldCheck,
  Siren,
  Sparkles,
  Star,
  ToggleRight,
  TrendingUp,
  Trophy,
  User,
  Users,
  Wallet,
} from "lucide-react-native";
import { HQ_MENU, HQ_MENU_IDS, findMenuItem, type HqIconName } from "@/lib/hq-menu";

/**
 * The HQ menu with its icons. The menu itself — sections, ids, labels, subtitles and the rules it
 * must keep — is data in `lib/hq-menu.ts` (unit-tested); this file only draws it.
 */
export type PartnerNavItem = { id: string; label: string; subtitle: string; icon: LucideIcon; badgeLabel?: string };
export type PartnerNavSection = { id: string; label: string; icon: LucideIcon; items: PartnerNavItem[] };

const ICONS: Record<HqIconName, LucideIcon> = {
  activity: Activity,
  route: Route,
  clock: Clock,
  toggle: ToggleRight,
  calendar: Calendar,
  history: History,
  map: Map,
  wallet: Wallet,
  chart: BarChart3,
  banknote: Banknote,
  receipt: Receipt,
  gift: Gift,
  tax: Landmark,
  trend: TrendingUp,
  invoice: ScrollText,
  star: Star,
  gauge: Gauge,
  ladder: Award,
  trophy: Trophy,
  lightbulb: Lightbulb,
  sparkles: Sparkles,
  brain: Brain,
  navigation: Navigation2,
  compass: Compass,
  pin: MapPinned,
  graduation: GraduationCap,
  award: Award,
  "badge-check": BadgeCheck,
  briefcase: Briefcase,
  file: FileText,
  shield: ShieldCheck,
  "clipboard-check": ClipboardCheck,
  crown: Crown,
  users: Users,
  siren: Siren,
  heart: HeartPulse,
  message: MessageSquare,
  user: User,
  bell: Bell,
  settings: Settings,
  help: HelpCircle,
  "id-card": IdCard,
};

export function hqIcon(name: HqIconName): LucideIcon {
  return ICONS[name] ?? FileText;
}

export const PARTNER_HQ_NAV: PartnerNavSection[] = HQ_MENU.map((s) => ({
  id: s.id,
  label: s.label,
  icon: hqIcon(s.icon),
  items: s.items.map((i) => ({ id: i.id, label: i.label, subtitle: i.subtitle, icon: hqIcon(i.icon), ...(i.badge ? { badgeLabel: i.badge } : {}) })),
}));

export const HQ_SCREEN_IDS = new Set(HQ_MENU_IDS);

export function findNavItem(id: string): { section: PartnerNavSection; item: PartnerNavItem } | null {
  const hit = findMenuItem(id);
  if (!hit) return null;
  const section = PARTNER_HQ_NAV.find((s) => s.id === hit.section.id);
  const item = section?.items.find((i) => i.id === id);
  return section && item ? { section, item } : null;
}
