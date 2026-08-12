export type BackendService = {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  category?: string;
  basePrice?: number;
  minPrice?: number;
  maxPrice?: number;
  rating?: number;
  reviewCount?: number;
  bookingCount?: number;
  icon?: string | null;
  thumbnail?: string | null;
  isFeatured?: boolean;
};

export type BackendProvider = {
  id: string;
  name: string;
  profileImage?: string | null;
  rating?: number;
  reviewCount?: number;
  isOnline?: boolean;
  distance?: number;
  eta?: number;
  basePrice?: number;
};

export type BackendMatchedProvider = {
  providerId: string;
  name: string;
  rating: number;
  totalReviews: number;
  distance: number;
  eta: number;
  totalScore: number;
  isOnline: boolean;
  availability: boolean;
  profileImage?: string | null;
};

export type BackendBooking = {
  id: string;
  bookingNumber?: string;
  serviceId?: string;
  serviceName?: string;
  serviceIcon?: string | null;
  providerId?: string;
  providerName?: string;
  providerImage?: string | null;
  // Full backend BookingStatus enum (lowercased) — was missing assigned/en_route/rejected.
  status:
    | "pending"
    | "accepted"
    | "assigned"
    | "en_route"
    | "in_progress"
    | "completed"
    | "rejected"
    | "cancelled"
    | "cancelled_by_user"
    | "cancelled_by_provider";
  scheduledDate?: string;
  completedAt?: string | null;
  amount?: number;
  finalAmount?: number;
  addons?: BookingAddon[];
  paymentStatus?: string;
  description?: string | null;
};

/** Catalog snapshot of a purchased add-on, stored on the booking at create time. */
export type BookingAddon = {
  id: string;
  name: string;
  price: number;
};

export type BackendWalletTransaction = {
  id: string;
  transactionNumber?: string;
  type: "credit" | "debit";
  amount: number;
  description?: string;
  reason?: string;
  createdAt: string;
  status?: string;
};

export type BackendNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  referenceId?: string | null;
  isRead: boolean;
  imageUrl?: string | null;
  createdAt: string;
};

export type BackendTracking = {
  id: string;
  bookingId: string;
  status: string;
  providerLatitude?: number;
  providerLongitude?: number;
  distance?: number;
  eta?: number;
  /** Travel heading in compass degrees (Uber-style marker rotation). */
  bearing?: number;
  /** Ground speed in m/s. */
  speed?: number;
  estimatedArrivalTime?: string;
  locationUpdatedAt?: string;
};

export type BackendAddress = {
  id: string;
  label?: string | null;
  type?: string | null;
  line1: string;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  isDefault?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type BackendRating = {
  id: string;
  bookingId: string;
  rating: number;
  reviewText?: string | null;
  photos?: string[];
  tipAmount?: number | null;
  liked?: string[];
  couldImprove?: string[];
  providerResponse?: string | null;
  respondedAt?: string | null;
  createdAt: string;
};

export type BackendProviderReview = {
  id: string;
  userName?: string | null;
  userImage?: string | null;
  rating: number;
  reviewText?: string | null;
  photos?: string[];
  providerResponse?: string | null;
  respondedAt?: string | null;
  serviceName?: string | null;
  createdAt: string;
};

export type BackendProviderDetail = {
  id: string;
  name: string;
  bio?: string | null;
  profileImage?: string | null;
  rating?: number;
  reviewCount?: number;
  isOnline?: boolean;
  yearsOfExperience?: number;
  badges?: string[];
  services?: Array<{ id: string; name: string; basePrice?: number }>;
  gallery?: string[];
  completedJobs?: number;
  responseTime?: number;
  acceptanceRate?: number;
  isVerified?: boolean;
  city?: string | null;
};

export type BackendAvailabilitySlot = {
  start: string;
  end: string;
  available: boolean;
};

export type BackendProviderAvailability = {
  date: string;
  slots: BackendAvailabilitySlot[];
  timezone?: string;
};

export type BackendRefund = {
  id: string;
  paymentId: string;
  bookingId?: string;
  amount: number;
  reason?: string;
  status: string;
  createdAt: string;
  refundedAt?: string | null;
};

export type BackendWithdrawal = {
  id: string;
  withdrawalNumber?: string;
  amount: number;
  status: string;
  createdAt: string;
};
