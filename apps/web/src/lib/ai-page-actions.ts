import { bookUrl } from "@/lib/booking-url";

/** Scroll targets on the AI page */
export const AI_SECTION_IDS = {
  chat: "ai-chat",
  diagnosis: "ai-image-diagnosis",
  homeStatus: "ai-home-status",
  smartActions: "ai-smart-actions",
  liveTracking: "ai-live-tracking",
} as const;

export type AiSectionId = (typeof AI_SECTION_IDS)[keyof typeof AI_SECTION_IDS];

export function scrollToAiSection(sectionId: AiSectionId) {
  if (typeof document === "undefined") return;
  document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export const AI_INSIGHT_ACTIONS: Record<
  string,
  | { type: "book"; serviceId: string; toast?: string }
  | { type: "navigate"; href: string; toast?: string }
  | { type: "chat"; message: string; toast?: string }
  | { type: "scroll"; section: AiSectionId; toast?: string }
  | { type: "overlay"; overlay: "wallet" | "premium" | "support" }
> = {
  "ac-maint": {
    type: "book",
    serviceId: "ac-service",
    toast: "Opening AC service booking…",
  },
  bills: {
    type: "navigate",
    href: "/wallet",
    toast: "AI bill optimization tips added to Wallet",
  },
  water: {
    type: "scroll",
    section: AI_SECTION_IDS.diagnosis,
    toast: "Review water sensors or upload a photo",
  },
  cleaning: {
    type: "book",
    serviceId: "cleaning",
    toast: "Opening deep cleaning booking…",
  },
};

export const AI_PREDICTION_ACTIONS: Record<
  string,
  { serviceId: string; toast: string }
> = {
  deep: { serviceId: "cleaning", toast: "Deep cleaning slot suggested for you" },
  filter: { serviceId: "plumbing", toast: "Water filter service recommended" },
  ac: { serviceId: "ac-service", toast: "AC service due — book now" },
  pest: { serviceId: "pest-control", toast: "Pest control inspection suggested" },
};

export const AI_STATUS_ACTIONS: Record<
  string,
  | { type: "book"; serviceId?: string }
  | { type: "navigate"; href: string }
  | { type: "scroll"; section: AiSectionId }
  | { type: "chat"; message: string }
> = {
  cleaning: { type: "navigate", href: "/bookings" },
  ac: { type: "book", serviceId: "ac-service" },
  energy: { type: "navigate", href: "/wallet" },
  water: { type: "scroll", section: AI_SECTION_IDS.diagnosis },
  safety: { type: "chat", message: "Show my home safety status" },
  optimization: {
    type: "chat",
    message: "What AI optimizations do you recommend for my home?",
  },
};

export const AI_HERO_STAT_ACTIONS: Record<
  string,
  { section?: AiSectionId; href?: string; toast: string }
> = {
  services: { href: "/bookings", toast: "Viewing your active services" },
  health: { section: AI_SECTION_IDS.homeStatus, toast: "Home health breakdown" },
  optimizations: { section: AI_SECTION_IDS.chat, toast: "AI optimization insights in chat" },
};

export type ChatQuickActionKey =
  | "Instant AI Diagnosis"
  | "Book Expert"
  | "Upload Photo";

export const CHAT_QUICK_ACTION_MAP: Record<
  ChatQuickActionKey,
  | { type: "scroll"; section: AiSectionId; toast?: string; chat?: string }
  | { type: "book"; serviceId: string; toast?: string }
> = {
  "Instant AI Diagnosis": {
    type: "scroll",
    section: AI_SECTION_IDS.diagnosis,
    toast: "Upload a photo for instant AI diagnosis",
    chat: "I want an instant AI diagnosis",
  },
  "Book Expert": {
    type: "book",
    serviceId: "ac-service",
    toast: "Matching you with a verified expert…",
  },
  "Upload Photo": {
    type: "scroll",
    section: AI_SECTION_IDS.diagnosis,
    toast: "Select an image to upload",
  },
};

export function bookServiceUrl(serviceId: string, query?: string) {
  return bookUrl({ service: serviceId, q: query });
}
