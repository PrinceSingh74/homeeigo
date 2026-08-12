export const LEGAL_VERSION = "2026-06-08";

export type LegalPolicyKey = "privacy" | "terms" | "refund" | "cookies";

export const legalSections: Record<
  LegalPolicyKey,
  { title: string; sections: { heading: string; body: string }[] }
> = {
  privacy: {
    title: "Privacy Policy",
    sections: [
      {
        heading: "Information we collect",
        body: "We collect account details (name, email, phone), booking and payment history, device identifiers for fraud prevention, and location when you book a service.",
      },
      {
        heading: "How we use data",
        body: "Data is used to deliver bookings, process payments, prevent fraud, send service notifications, and improve Homeeigo. We do not sell personal data.",
      },
      {
        heading: "Retention",
        body: "We retain data while your account is active and for a limited period after deletion to meet legal obligations and resolve disputes.",
      },
      {
        heading: "Your rights",
        body: "You may request a copy of your data or account deletion from Settings. Contact privacy@homigo.in for data subject requests.",
      },
    ],
  },
  terms: {
    title: "Terms of Service",
    sections: [
      {
        heading: "Acceptance",
        body: "By creating an account or using Homeeigo you agree to these terms and our Privacy Policy.",
      },
      {
        heading: "Services",
        body: "Homeeigo connects customers with independent service providers. We facilitate booking and payment but providers perform the actual work.",
      },
      {
        heading: "Accounts",
        body: "You must provide accurate information, keep credentials secure, and comply with applicable laws. We may suspend accounts for fraud or abuse.",
      },
      {
        heading: "Liability",
        body: "Homeeigo is provided as-is within limits permitted by law. See our Refund Policy for cancellation and refund rules.",
      },
    ],
  },
  refund: {
    title: "Refund & Cancellation Policy",
    sections: [
      {
        heading: "Customer cancellations",
        body: "Cancellation fees depend on how close to the scheduled time you cancel. Free cancellation windows are shown at booking checkout.",
      },
      {
        heading: "Provider cancellations",
        body: "If a provider cancels, you receive a full refund to your original payment method or wallet.",
      },
      {
        heading: "Refund timing",
        body: "Approved refunds are initiated within 5–7 business days. Bank processing times may vary.",
      },
      {
        heading: "Disputes",
        body: "Contact support within 48 hours of service completion to raise a quality dispute.",
      },
    ],
  },
  cookies: {
    title: "Cookie Policy",
    sections: [
      {
        heading: "What we use",
        body: "Essential cookies keep you signed in. Analytics cookies help us understand usage. Marketing cookies are optional.",
      },
      {
        heading: "Your choice",
        body: "You can accept or decline non-essential cookies via the banner. Essential cookies are required for the app to function.",
      },
      {
        heading: "Managing cookies",
        body: "You can clear cookies in your browser settings. Declining optional cookies does not block core booking features.",
      },
    ],
  },
};
