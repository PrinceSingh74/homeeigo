export type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  message?: string;
  details?: string[];
};

export type Paginated<T> = T & {
  total: number;
  page: number;
  limit?: number;
};

export type AdminUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string | null;
  profileImage: string | null;
  role: "CUSTOMER" | "PROVIDER" | "ADMIN";
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  isActive: boolean;
  isBanned: boolean;
  createdAt: string;
};

export type AdminCustomer = {
  id: string;
  email: string;
  firstName: string | null;
  lastName?: string | null;
  totalBookings: number;
  totalSpent: number;
  walletBalance?: number;
  referralCount?: number;
  preferredCity?: string | null;
  lastActivityAt?: string | null;
  kycStatus: string;
  isActive: boolean;
  createdAt: string;
};

export type AdminProvider = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  rating: number;
  totalBookings: number;
  completedBookings: number;
  isVerified: boolean;
  isApproved: boolean;
  isOnline?: boolean;
  lastSeenAt?: string | null;
  completionRate?: number;
  acceptanceRate?: number;
  totalReviews?: number;
  currentStatus?: string | null;
  businessName?: string | null;
  registrationStatus?: "PENDING" | "APPROVED" | "REJECTED";
  serviceCategories?: string[];
  city?: string | null;
  experienceYears?: number;
  registeredAt?: string;
  rejectionReason?: string | null;
  totalEarnings: number;
  createdAt: string;
};

export type AdminBooking = {
  id: string;
  bookingNumber: string | null;
  user: string;
  provider: string;
  service: string;
  amount: number;
  status: string;
  rating?: number | null;
  completedAt?: string | null;
};

export type DashboardStats = {
  totalUsers: number;
  totalProviders: number;
  totalBookings: number;
  completedBookings: number;
  totalRevenue: number;
  thisMonthRevenue: number;
  averageRating: number;
  activeNow: number;
};

export type DashboardCharts = {
  bookingsByDay: Array<{ date: string; count: number }>;
  revenueByDay: Array<{ date: string; revenue: number }>;
};

export type DashboardData = {
  stats: DashboardStats;
  charts: DashboardCharts;
};

export type AnalyticsData = {
  period: { startDate: string; endDate: string };
  overview: {
    totalBookings: number;
    completedBookings: number;
    cancelledBookings: number;
    totalRevenue: number;
    platformCommission: number;
    providerPayouts: number;
    /** Platform take rate as a percentage (server-computed). */
    commissionPercentage: number;
  };
  topServices: Array<{
    name: string;
    bookings: number;
    revenue: number;
    /** Actual recorded commission for this service (from Earning rows). */
    commission: number;
    netEarning: number;
  }>;
  topProviders: Array<{
    id?: string;
    name?: string;
    bookings?: number;
    earnings?: number;
  }>;
  userMetrics: {
    newUsers: number;
    activeUsers: number;
    repeatBookingRate: number;
  };
};

export type AdminListCustomersResponse = Paginated<{ users: AdminCustomer[] }>;
export type AdminListProvidersResponse = Paginated<{ providers: AdminProvider[] }>;
export type AdminListBookingsResponse = Paginated<{ bookings: AdminBooking[] }>;

export type VerifyAction = "approve" | "reject";
export type BanAction = "ban" | "unban";

export type LoginPayload = {
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    profileImage: string | null;
    role?: string;
  };
  accessToken: string;
  refreshToken: string;
  userId: string;
  expiresIn: number;
};

export type CurrentUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profileImage: string | null;
  phoneNumber: string | null;
  role: string;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  isActive?: boolean;
  isBanned?: boolean;
  createdAt?: string;
};
