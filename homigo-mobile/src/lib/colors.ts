export const colors = {
  light: {
    bg: "#F8FAFC",
    cardBg: "#FFFFFF",
    text: "#0F172A",
    textSecondary: "#64748B",
    border: "#E5E7EB",

    primary: "#2563EB",
    violet: "#7C3AED",
    cyan: "#06B6D4",
    pink: "#EC4899",
    gold: "#D4AF37",
    success: "#10B981",
    warning: "#F59E0B",
    error: "#EF4444",
  },
  dark: {
    bg: "#0F172A",
    cardBg: "#111827",
    text: "#F8FAFC",
    textSecondary: "#D1D5DB",
    border: "#374151",

    primary: "#3B82F6",
    violet: "#8B5CF6",
    cyan: "#06B6D4",
    pink: "#EC4899",
    gold: "#D4AF37",
    success: "#10B981",
    warning: "#F59E0B",
    error: "#EF4444",
  },
};

export const shadowStyles = {
  sm: {
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  md: {
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  lg: {
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
  },
  xl: {
    elevation: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
  },
  glowBlue: {
    elevation: 10,
    shadowColor: "#2563EB",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
  },
  glowViolet: {
    elevation: 10,
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
  },
};

// Premium gradient stops (Luxury Aurora AI)
export const gradients = {
  hero: ["#2563EB", "#7C3AED", "#06B6D4"] as const,
  premium: ["#7C3AED", "#EC4899"] as const,
  gold: ["#D4AF37", "#FDB022"] as const,
  aiCard: ["#2563EB", "#7C3AED"] as const,
};
