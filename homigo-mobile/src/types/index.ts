export interface Service {
  id: number;
  name: string;
  price: string;
  color: string;
  featured?: boolean;
}

export interface Offer {
  discount: string;
  desc: string;
  code: string;
}

export interface Booking {
  id: string;
  serviceId: number;
  status: "pending" | "confirmed" | "in-progress" | "completed" | "cancelled";
  scheduledAt: string;
  amount: number;
}

export interface ThemeColors {
  bg: string;
  cardBg: string;
  text: string;
  textSecondary: string;
  border: string;
  primary: string;
  violet: string;
  cyan: string;
  pink: string;
  gold: string;
  success: string;
  warning: string;
  error: string;
}
