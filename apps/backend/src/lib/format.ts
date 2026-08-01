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
}) {
  return {
    id: s.id,
    name: s.name,
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
    rating: 4.8,
    reviewCount: 0,
    bookingCount: s.bookingCount,
    isFeatured: s.isFeatured,
    isPopular: s.isPopular,
    isPromoted: s.isPromoted,
    premiumOnly: s.premiumOnly,
  };
}
