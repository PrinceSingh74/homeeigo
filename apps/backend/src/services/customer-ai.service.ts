export type AiChatMessageInput = {
  role: "user" | "assistant";
  content: string;
};

export type AiChatResponse = {
  message: string;
  quickActions: string[];
  suggestedServiceId?: string;
};

function buildReply(userText: string, firstName?: string): AiChatResponse {
  const lower = userText.toLowerCase();
  const name = firstName?.trim() || "there";

  if (lower.includes("ac") || lower.includes("cooling") || lower.includes("air")) {
    return {
      message:
        "I've analyzed your AC performance and found possible airflow blockage. Would you like me to book an expert for inspection?",
      quickActions: ["Book AC Service", "Upload Photo", "Check Slots"],
      suggestedServiceId: "ac-service",
    };
  }
  if (lower.includes("leak") || lower.includes("water") || lower.includes("plumb")) {
    return {
      message:
        "Water flow patterns look unusual. I recommend a quick inspection — shall I book a verified plumber?",
      quickActions: ["Book Plumber", "Upload Photo", "Emergency Help"],
      suggestedServiceId: "plumbing",
    };
  }
  if (lower.includes("clean")) {
    return {
      message:
        "I can schedule deep cleaning with a top-rated crew. Standard slots start at ₹199. Shall I book for you?",
      quickActions: ["Book Cleaning", "See Offers", "Compare Packages"],
      suggestedServiceId: "cleaning",
    };
  }
  if (lower.includes("pest")) {
    return {
      message:
        "Preventive pest control is recommended this season. I can book a verified expert this week.",
      quickActions: ["Book Pest Control", "Upload Photo", "Ask Expert"],
      suggestedServiceId: "pest-control",
    };
  }
  if (lower.includes("schedule") || lower.includes("book")) {
    return {
      message:
        "I found open slots tomorrow morning and evening. Pick a service and I'll confirm instantly.",
      quickActions: ["Browse Services", "View Bookings", "Set Reminder"],
    };
  }
  if (lower.includes("wallet") || lower.includes("pay") || lower.includes("bill")) {
    return {
      message:
        "You can pay securely via HOMIGO wallet or Razorpay at checkout. Want me to open your wallet?",
      quickActions: ["Open Wallet", "Add Money", "View Transactions"],
    };
  }
  if (lower.includes("hello") || lower.includes("hi") || lower.includes("help")) {
    return {
      message: `Hello ${name}! I can help with bookings, diagnostics, wallet, and service recommendations. What do you need today?`,
      quickActions: ["Book Expert", "Instant Diagnosis", "Track Booking"],
    };
  }

  return {
    message:
      "I can help with that. Would you like me to book a verified expert or run an instant AI diagnosis?",
    quickActions: ["Instant AI Diagnosis", "Book Expert", "Upload Photo"],
  };
}

export class CustomerAiService {
  chat(input: { message: string; history?: AiChatMessageInput[]; firstName?: string }) {
    const trimmed = input.message.trim();
    if (!trimmed) {
      return {
        message: "Please tell me what you need help with.",
        quickActions: ["Book Expert", "Browse Services", "Track Booking"],
      } satisfies AiChatResponse;
    }
    return buildReply(trimmed, input.firstName);
  }
}

export const customerAiService = new CustomerAiService();
