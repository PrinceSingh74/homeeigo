import { quantityPriceTable, parseCatalogConfig, publicCatalogConfig } from "./service-catalog-config";
import { pricingReadiness } from "./service-domain";
import type { KycStatus, User } from "@prisma/client";

const KYC_MAP: Record<KycStatus, string> = {
  NOT_STARTED: "not_started",
  PENDING: "pending",
  IN_REVIEW: "in_review",
  APPROVED: "verified",
  REJECTED: "rejected",
};

export function formatKycStatus(status: KycStatus): string {
  return KYC_MAP[status] ?? status.toLowerCase();
}

export function bookingStatusApi(status: string): string {
  return status.toLowerCase();
}

export function paymentStatusApi(status: string): string {
  return status.toLowerCase();
}

export function publicUser(user: Pick<
  User,
  | "id"
  | "email"
  | "phoneNumber"
  | "firstName"
  | "lastName"
  | "profileImage"
  | "bio"
  | "walletBalance"
  | "totalSpent"
  | "kycStatus"
  | "isEmailVerified"
  | "isPhoneVerified"
  | "darkMode"
  | "notificationsEnabled"
  | "emailNotifications"
  | "pushNotifications"
  | "smsNotifications"
  | "defaultLanguage"
  | "createdAt"
  | "referralCode"
  | "referralCount"
>) {
  return {
    id: user.id,
    email: user.email,
    phoneNumber: user.phoneNumber,
    firstName: user.firstName,
    lastName: user.lastName,
    profileImage: user.profileImage,
    bio: user.bio,
    walletBalance: user.walletBalance,
    totalSpent: user.totalSpent,
    kycStatus: formatKycStatus(user.kycStatus),
    isEmailVerified: user.isEmailVerified,
    isPhoneVerified: user.isPhoneVerified,
    darkMode: user.darkMode,
    notificationsEnabled: user.notificationsEnabled,
    emailNotifications: user.emailNotifications,
    pushNotifications: user.pushNotifications,
    smsNotifications: user.smsNotifications,
    preferredLanguage: user.defaultLanguage,
    createdAt: user.createdAt,
    referralCode: user.referralCode,
    referralCount: user.referralCount,
  };
}

export function formatAddress(a: {
  id: string;
  label: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  zipCode: string;
  latitude: number;
  longitude: number;
  isDefault: boolean;
  isBillingAddress: boolean;
  landmark: string | null;
  specialInstructions: string | null;
  fullAddress: string;
}) {
  return {
    id: a.id,
    label: a.label,
    addressLine1: a.addressLine1,
    addressLine2: a.addressLine2,
    city: a.city,
    state: a.state,
    zipCode: a.zipCode,
    latitude: a.latitude,
    longitude: a.longitude,
    isDefault: a.isDefault,
    isBillingAddress: a.isBillingAddress,
    landmark: a.landmark,
    specialInstructions: a.specialInstructions,
    fullAddress: a.fullAddress,
  };
}

export function formatServiceList(s: {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  subcategory: string | null;
  basePrice: number;
  minPrice: number | null;
  maxPrice: number | null;
  estimatedDuration: number;
  durationRange: string | null;
  icon: string | null;
  thumbnail: string | null;
  isFeatured: boolean;
  isPopular: boolean;
  isPromoted: boolean;
  premiumOnly: boolean;
  bookingCount: number;
  pricingModel?: string;
  tags?: string[];
  catalogConfig?: unknown;
  displayName?: string | null;
  isActive?: boolean;
  isBookable?: boolean;
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoKeywords?: string | null;
}, rating?: { rating: number | null; reviewCount: number }) {
  const cfg = parseCatalogConfig(s.catalogConfig);
  return {
    id: s.id,
    name: s.displayName || s.name,
    slug: s.slug,
    description: s.description,
    category: s.category,
    subcategory: s.subcategory,
    basePrice: s.basePrice,
    minPrice: s.minPrice ?? s.basePrice,
    maxPrice: s.maxPrice ?? s.basePrice,
    estimatedDuration: s.estimatedDuration,
    durationRange: s.durationRange,
    icon: s.icon,
    thumbnail: s.thumbnail,
    // Real aggregate from the ratings table, or null — never a placeholder.
    rating: rating?.rating ?? null,
    reviewCount: rating?.reviewCount ?? 0,
    bookingCount: s.bookingCount,
    isFeatured: s.isFeatured,
    isPopular: s.isPopular,
    isPromoted: s.isPromoted,
    premiumOnly: s.premiumOnly,
    pricingModel: s.pricingModel,
    tags: s.tags,
    catalogConfig: publicCatalogConfig(cfg),
    /** Server-resolved service-line price per selectable quantity (null when not quantity-priced). */
    quantityPrices: quantityPriceTable({ ...s, pricingModel: s.pricingModel ?? "fixed" }, cfg),
    // Same fail-closed rule as quote/booking: an unpriced service is never advertised as bookable.
    bookable: s.isBookable !== false && cfg?.comingSoon !== true && pricingReadiness({ ...s, pricingModel: s.pricingModel ?? "fixed" }, cfg).ok,
    comingSoon: cfg?.comingSoon === true,
    /** Bookable and not marked noindex. Drafts never reach this list (CUSTOMER_VISIBLE). */
    indexable:
      s.isBookable !== false &&
      cfg?.comingSoon !== true &&
      cfg?.seo?.noindex !== true &&
      pricingReadiness({ ...s, pricingModel: s.pricingModel ?? "fixed" }, cfg).ok,
    seoTitle: s.seoTitle?.trim() || null,
    seoDescription: s.seoDescription?.trim() || null,
    seoKeywords: s.seoKeywords?.trim() || null,
  };
}
