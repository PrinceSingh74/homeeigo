/**
 * Structured, production-grade legal content for the HOMEEIGO trust pages
 * (Privacy Policy, Terms of Service, Cookie Consent Center). Kept separate from
 * the legacy `content.ts` (still used by the Refund page) so nothing breaks.
 *
 * Copy is real, enterprise-grade legal language — not placeholder. Company /
 * contact identifiers intentionally use the live `homigo.in` domain (the brand
 * shows as "HOMEEIGO"; the mailbox/domain is the real deliverable address).
 */

export const LEGAL_EFFECTIVE = "2026-07-06";
export const LEGAL_ENTITY = "HOMEEIGO Technologies Pvt. Ltd.";
export const PRIVACY_EMAIL = "privacy@homigo.in";
export const LEGAL_EMAIL = "legal@homigo.in";
export const GRIEVANCE_OFFICER = "Grievance Officer, HOMEEIGO";
export const GOVERNING_JURISDICTION = "the courts of Bengaluru, Karnataka, India";

export type TrustBadge = { label: string; icon: "lock" | "card" | "shield" | "globe" | "trash" };

export const PRIVACY_TRUST_BADGES: TrustBadge[] = [
  { label: "Data Encrypted", icon: "lock" },
  { label: "Secure Payments", icon: "card" },
  { label: "Privacy Protected", icon: "shield" },
  { label: "GDPR Ready", icon: "globe" },
  { label: "Account Deletion Available", icon: "trash" },
];

/* ============================ PRIVACY POLICY ============================ */

export type LegalListItem = { label: string; detail: string };
export type PrivacySection = {
  id: string;
  title: string;
  intro?: string;
  items?: LegalListItem[];
  body?: string;
};

export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    id: "information-we-collect",
    title: "Information We Collect",
    intro:
      "We collect only what we need to deliver a safe, reliable home-services experience. Categories of information include:",
    items: [
      { label: "Personal Information", detail: "Name, date of birth (where legally required) and profile photo you choose to add." },
      { label: "Contact Information", detail: "Email address and mobile number used for account access, booking updates and OTP verification." },
      { label: "Address Information", detail: "Service addresses you save so professionals can reach the correct location." },
      { label: "Location Information", detail: "Precise or approximate device location, used only during an active booking for partner assignment, ETA and live tracking." },
      { label: "Device Information", detail: "Device model, OS, app version and hashed identifiers used for security and fraud prevention." },
      { label: "Usage Analytics", detail: "Pages viewed, features used and diagnostic events that help us improve reliability and performance." },
      { label: "Payment Information", detail: "Tokenized card / UPI references handled by our PCI-DSS certified payment partners. We never store full card numbers." },
    ],
  },
  {
    id: "how-we-use-data",
    title: "How We Use Data",
    intro: "Your information is processed for the following clearly-defined purposes:",
    items: [
      { label: "Booking Management", detail: "Creating, scheduling, modifying and confirming your service bookings." },
      { label: "Partner Assignment", detail: "Matching you with a verified, appropriately-skilled professional near you." },
      { label: "Service Delivery", detail: "Enabling navigation, live tracking, arrival updates and job completion proof." },
      { label: "Fraud Prevention", detail: "Detecting suspicious activity, protecting accounts and keeping the marketplace safe." },
      { label: "Customer Support", detail: "Resolving queries, disputes and quality issues quickly and fairly." },
      { label: "Analytics", detail: "Understanding aggregate usage to improve the product — never to sell your data." },
      { label: "AI Optimization", detail: "Smart matching, ETA prediction and dynamic scheduling using de-identified signals." },
    ],
  },
  {
    id: "data-sharing",
    title: "Data Sharing",
    intro:
      "We do not sell your personal data. We share the minimum necessary information with the following categories of recipients:",
    items: [
      { label: "Service Partners", detail: "The assigned professional receives your name, service address and booking details for the duration of the job only." },
      { label: "Payment Providers", detail: "Regulated payment processors (e.g. Razorpay) handle transactions under PCI-DSS and RBI guidelines." },
      { label: "Legal Authorities", detail: "Disclosed only where required by valid legal process, or to protect rights, safety and prevent fraud." },
      { label: "Cloud Providers", detail: "Vetted infrastructure providers hosting our systems under strict data-processing agreements." },
    ],
  },
  {
    id: "data-security",
    title: "Data Security",
    intro: "Security is engineered into every layer of the HOMEEIGO platform:",
    items: [
      { label: "Encryption", detail: "Data is encrypted in transit (TLS 1.2+) and sensitive fields are encrypted at rest." },
      { label: "Access Control", detail: "Role-based access with least-privilege principles across all internal systems." },
      { label: "Audit Logs", detail: "Access to sensitive data is logged and monitored for anomalies." },
      { label: "Fraud Detection", detail: "Real-time risk scoring protects both customers and partners." },
      { label: "Secure Storage", detail: "Backups are encrypted and stored with strict retention and recovery controls." },
    ],
  },
  {
    id: "user-rights",
    title: "Your Rights",
    intro:
      "Subject to applicable law (including the DPDP Act 2023 and GDPR where relevant), you can exercise the following rights at any time:",
    items: [
      { label: "Access Data", detail: "Request a summary of the personal data we hold about you." },
      { label: "Download Data", detail: "Export your booking history and profile in a portable format." },
      { label: "Correct Data", detail: "Update inaccurate or incomplete information from your profile settings." },
      { label: "Delete Account", detail: "Permanently delete your account and associated personal data from Settings → Account." },
      { label: "Withdraw Consent", detail: "Opt out of optional cookies, marketing and non-essential processing at any time." },
    ],
  },
  {
    id: "data-retention",
    title: "Data Retention Policy",
    body:
      "We retain personal data only for as long as your account is active or as needed to provide services. After account deletion, most personal data is erased within 90 days, except records we are legally required to keep — such as invoices and transaction records retained for statutory tax and audit periods (typically up to 8 years under Indian law). De-identified analytics may be retained longer as they no longer identify you.",
  },
  {
    id: "childrens-privacy",
    title: "Children's Privacy",
    body:
      "HOMEEIGO is intended for users aged 18 and above and is not directed at children. We do not knowingly collect personal data from anyone under 18. If we learn that a minor's data has been collected without verifiable parental consent, we will delete it promptly. Parents or guardians who believe a minor has provided us data may contact our Privacy Team.",
  },
  {
    id: "international-transfers",
    title: "International Transfers",
    body:
      "Your data is primarily processed on servers located in India. Where data is transferred across borders (for example, to a cloud region or a sub-processor), we ensure an equivalent level of protection through Standard Contractual Clauses, adequacy mechanisms and contractual safeguards, in line with the DPDP Act and GDPR.",
  },
  {
    id: "contact-privacy",
    title: "Contact Our Privacy Team",
    body:
      `Questions, requests or complaints about your privacy can be sent to our Privacy Team at ${PRIVACY_EMAIL}. Indian users may also contact our ${GRIEVANCE_OFFICER} for grievances under the DPDP Act and IT Rules. We aim to acknowledge every request within 72 hours and resolve it within 30 days.`,
  },
];

/* --------- Google Play Data Disclosure (Data safety) table --------- */

export type DisclosureRow = {
  data: string;
  purpose: string;
  shared: "Yes" | "No" | "Limited";
  retention: string;
};

export const DATA_DISCLOSURE: DisclosureRow[] = [
  { data: "Name, email & phone", purpose: "Account, bookings & notifications", shared: "Limited", retention: "Until account deletion + 90 days" },
  { data: "Precise location", purpose: "Partner assignment, ETA & live tracking", shared: "Limited", retention: "30 days" },
  { data: "Service address", purpose: "Service delivery", shared: "Limited", retention: "Until account deletion" },
  { data: "Payment info (tokenized)", purpose: "Process payments & refunds", shared: "Yes", retention: "Held by regulated payment provider" },
  { data: "Device identifiers", purpose: "Security & fraud prevention", shared: "Limited", retention: "180 days" },
  { data: "Usage & analytics", purpose: "Improve service & AI optimization", shared: "No", retention: "24 months (aggregated)" },
  { data: "Support messages", purpose: "Customer support & disputes", shared: "No", retention: "24 months" },
  { data: "Job photos", purpose: "Service verification & proof of work", shared: "Limited", retention: "12 months" },
];

/* ============================ TERMS OF SERVICE ============================ */

export type TermsSection = { id: string; title: string; body: string };

export const TERMS_SECTIONS: TermsSection[] = [
  { id: "acceptance", title: "Acceptance of Terms", body: "By creating an account, booking a service, or otherwise using the HOMEEIGO platform, you agree to be bound by these Terms of Service and our Privacy Policy. If you do not agree, you must not use the platform. These Terms form a legally binding agreement between you and " + LEGAL_ENTITY + "." },
  { id: "eligibility", title: "Eligibility", body: "You must be at least 18 years of age and legally capable of entering into a binding contract to use HOMEEIGO. By using the platform you represent that you meet these requirements and that the information you provide is accurate and complete." },
  { id: "user-accounts", title: "User Accounts", body: "You are responsible for maintaining the confidentiality of your account credentials and for all activity under your account. Notify us immediately of any unauthorised use. We may refuse, suspend or terminate accounts that contain false information or are used in breach of these Terms." },
  { id: "services-offered", title: "Services Offered", body: "HOMEEIGO is a technology platform that connects customers with independent, verified service professionals for home services including cleaning, kitchen, bathroom, laundry, ironing, wardrobe, balcony, car care, deep cleaning, senior care, pet care and other listed or future marketplace services. HOMEEIGO facilitates discovery, booking and payment; the professional performs the actual work." },
  { id: "booking-rules", title: "Booking Rules", body: "Bookings are subject to professional availability, service area coverage and the details you provide. You must ensure safe, lawful access to the premises and an accurate scope of work. Providing incorrect information or unsafe conditions may result in rescheduling, additional charges or cancellation." },
  { id: "pricing-payments", title: "Pricing & Payments", body: "Prices are shown before you confirm a booking and may vary with scope, add-ons, location and demand-based dynamic pricing. Applicable taxes are displayed at checkout. Payments are processed by regulated third-party providers; by paying you authorise the charge for the selected service and any agreed add-ons." },
  { id: "membership", title: "Membership Programs", body: "HOMEEIGO may offer paid membership tiers with benefits such as priority booking, discounts and dedicated support. Membership fees, benefits, renewal and cancellation terms are disclosed at purchase. Benefits are non-transferable and may be revised with reasonable notice." },
  { id: "referral", title: "Referral Programs", body: "Referral rewards are issued when a referred user completes the qualifying action defined in the program. Rewards have no cash value unless stated, may expire, and may be withheld or reversed in cases of fraud, self-referral or abuse of the program." },
  { id: "partner-responsibilities", title: "Partner Responsibilities", body: "Service professionals are independent contractors who agree to perform services professionally, punctually and in line with HOMEEIGO quality and safety standards. Partners must hold any required credentials, respect customer property and privacy, and comply with all applicable laws." },
  { id: "customer-responsibilities", title: "Customer Responsibilities", body: "You agree to provide accurate booking details, safe site access, and respectful treatment of professionals. You must not request unlawful work, solicit professionals off-platform, or hold HOMEEIGO responsible for private arrangements made outside the platform." },
  { id: "cancellation", title: "Cancellation Policy", body: "You may cancel a booking through the app. Cancellation fees depend on how close to the scheduled start time you cancel; the free-cancellation window is shown at checkout. If a professional cancels, you will not be charged and any prepayment is refunded." },
  { id: "refund", title: "Refund Policy", body: "Approved refunds are initiated to your original payment method or HOMEEIGO wallet, typically within 5–7 business days (bank timelines may vary). Quality disputes must be raised within 48 hours of service completion. Full details are in our Refund & Cancellation Policy." },
  { id: "safety", title: "Safety Standards", body: "HOMEEIGO verifies partner identity and enforces safety and hygiene protocols. For your safety, keep valuables secured, supervise access where appropriate, and report any safety concern immediately through in-app support. Emergencies should always be reported to local authorities first." },
  { id: "intellectual-property", title: "Intellectual Property", body: "The HOMEEIGO name, logo, software, designs and content are owned by " + LEGAL_ENTITY + " and protected by law. You are granted a limited, non-exclusive, non-transferable licence to use the platform for its intended purpose. You may not copy, reverse-engineer, scrape or create derivative works without written permission." },
  { id: "fraud-prevention", title: "Fraud Prevention", body: "We employ automated and manual controls to detect fraud and abuse. Attempting to manipulate pricing, payments, ratings, referrals or promotions, or using stolen payment instruments, is strictly prohibited and may result in immediate suspension and legal action." },
  { id: "platform-abuse", title: "Platform Abuse", body: "You must not misuse the platform — including harassment, hate speech, unlawful content, tampering with security features, automated access without permission, or any activity that harms other users, partners or HOMEEIGO systems." },
  { id: "account-suspension", title: "Account Suspension", body: "We may suspend or terminate access, with or without notice, for breach of these Terms, suspected fraud, legal requirements or risk to the platform or its users. Where lawful and practical, we will provide the reason and an opportunity to appeal." },
  { id: "limitation-of-liability", title: "Limitation of Liability", body: "To the maximum extent permitted by law, HOMEEIGO acts as an intermediary and is not liable for indirect, incidental or consequential damages. Our aggregate liability for any claim is limited to the amount you paid for the specific service giving rise to the claim. Nothing limits liability that cannot be excluded by law." },
  { id: "dispute-resolution", title: "Dispute Resolution", body: "Most issues are resolved quickly through in-app support. Disputes that cannot be resolved amicably shall be referred to arbitration by a sole arbitrator under the Arbitration and Conciliation Act, 1996, seated in Bengaluru, conducted in English." },
  { id: "governing-law", title: "Governing Law", body: "These Terms are governed by the laws of India. Subject to the dispute-resolution clause above, " + GOVERNING_JURISDICTION + " shall have exclusive jurisdiction." },
  { id: "changes", title: "Changes to Terms", body: "We may update these Terms to reflect changes in law, technology or our services. Material changes will be notified in-app or by email. Continued use after changes take effect constitutes acceptance of the revised Terms." },
];

/* ============================ COOKIE CONSENT ============================ */

export type CookieCategory = {
  id: "necessary" | "functional" | "performance" | "analytics" | "advertising" | "personalization";
  name: string;
  always?: boolean;
  description: string;
  purpose: string;
  examples: string[];
  expiry: string;
};

export const COOKIE_CATEGORIES: CookieCategory[] = [
  {
    id: "necessary",
    name: "Strictly Necessary",
    always: true,
    description: "Essential for the platform to function — you can't switch these off.",
    purpose: "Keep you signed in, secure your session, remember your basket and enable core booking flows.",
    examples: ["homigo_session", "csrf_token", "homigo_cookie_consent"],
    expiry: "Session – 12 months",
  },
  {
    id: "functional",
    name: "Functional Cookies",
    description: "Remember your choices to give you a more personal, convenient experience.",
    purpose: "Store preferences like language, saved city, theme and recently viewed services.",
    examples: ["homigo-theme", "homigo_city", "recent_services"],
    expiry: "Up to 12 months",
  },
  {
    id: "performance",
    name: "Performance Cookies",
    description: "Help us understand and improve how the platform performs.",
    purpose: "Measure load times, errors and reliability so we can make HOMEEIGO faster and more stable.",
    examples: ["perf_session", "rum_id"],
    expiry: "Up to 12 months",
  },
  {
    id: "analytics",
    name: "Analytics Cookies",
    description: "Show us how the platform is used, in aggregate, so we can improve it.",
    purpose: "Understand which features are useful and where users experience friction.",
    examples: ["_ga", "analytics_id"],
    expiry: "Up to 24 months",
  },
  {
    id: "advertising",
    name: "Advertising Cookies",
    description: "Used to measure and improve the relevance of marketing.",
    purpose: "Limit repetitive ads and measure the effectiveness of campaigns. Never used to sell your data.",
    examples: ["_fbp", "ad_measure"],
    expiry: "Up to 13 months",
  },
  {
    id: "personalization",
    name: "Personalization Cookies",
    description: "Tailor recommendations and content to your interests.",
    purpose: "Suggest services and offers relevant to your history and preferences.",
    examples: ["reco_profile", "offer_segment"],
    expiry: "Up to 12 months",
  },
];

/* ============================ REFUND POLICY ============================ */

export type RefundTier = { window: string; fee: string; note: string };

/** Customer cancellation fee tiers — the exact window is confirmed at checkout. */
export const REFUND_TIERS: RefundTier[] = [
  { window: "More than 12 hours before slot", fee: "Free", note: "100% refund — no charge" },
  { window: "4 – 12 hours before slot", fee: "25%", note: "Partial fee to compensate the reserved professional" },
  { window: "1 – 4 hours before slot", fee: "50%", note: "Professional is likely already scheduled / en route" },
  { window: "Less than 1 hour / after arrival", fee: "Up to 100%", note: "Covers travel and committed time" },
];

export const REFUND_SECTIONS: PrivacySection[] = [
  {
    id: "overview",
    title: "Overview",
    body:
      "We want every HOMEEIGO booking to be worth it. This policy explains when cancellations are free, how cancellation fees work, when you're entitled to a refund, and how quickly refunds reach you. It applies to all services booked through the HOMEEIGO customer web and mobile apps.",
  },
  {
    id: "customer-cancellations",
    title: "Customer Cancellations",
    intro:
      "You can cancel any booking from the app. Fees depend on how close to the scheduled start time you cancel — the exact free-cancellation window is always shown before you confirm and pay:",
  },
  {
    id: "partner-cancellations",
    title: "Partner Cancellations",
    body:
      "If a professional cancels or is unable to attend, you are never charged. Any amount already paid is refunded in full to your original payment method or HOMEEIGO wallet, and we'll help you rebook — often with priority matching.",
  },
  {
    id: "refund-methods",
    title: "Refund Methods",
    intro: "Approved refunds are issued to whichever of these you prefer:",
    items: [
      { label: "Original Payment Method", detail: "Card, UPI or netbanking refunds go back to the source account you paid from." },
      { label: "HOMEEIGO Wallet", detail: "Choose instant wallet credit for the fastest refund, usable on your next booking." },
    ],
  },
  {
    id: "refund-timeline",
    title: "Refund Timeline",
    body:
      "Wallet refunds are typically instant. Refunds to the original payment method are initiated within 5–7 business days of approval; the time to reflect in your account depends on your bank or card issuer and may take a few additional days.",
  },
  {
    id: "non-refundable",
    title: "Non-Refundable Charges",
    intro: "The following are generally non-refundable, except where required by law:",
    items: [
      { label: "Completed Services", detail: "Services delivered as described and accepted at completion." },
      { label: "Applicable Cancellation Fees", detail: "Fees incurred under the cancellation tiers above." },
      { label: "Consumed Membership Benefits", detail: "Discounts or perks already redeemed within a billing cycle." },
    ],
  },
  {
    id: "quality-disputes",
    title: "Quality Disputes & Rework",
    body:
      "If the service didn't meet HOMEEIGO's standards, raise a dispute within 48 hours of completion through in-app support with photos where possible. We'll first offer a free rework by a professional; if that isn't feasible or acceptable, we may issue a partial or full refund based on a fair review.",
  },
  {
    id: "membership-refunds",
    title: "Membership & Subscription Refunds",
    body:
      "Paid memberships can be cancelled any time and will not renew. Refunds for the current billing period are pro-rated only where required by law or as expressly stated at purchase; benefits already consumed during the period are not refundable.",
  },
  {
    id: "failed-duplicate",
    title: "Failed & Duplicate Payments",
    body:
      "If you were charged but the booking failed, or you were charged twice for the same booking, the extra amount is automatically identified and reversed — usually within 5–7 business days. If you don't see it, contact support with your transaction reference and we'll resolve it quickly.",
  },
  {
    id: "request-refund",
    title: "How to Request a Refund",
    body:
      `Most refunds are automatic. For anything else, go to Bookings → select the booking → Help, or contact our support team through the app. For unresolved issues you can escalate to ${LEGAL_EMAIL}. We aim to acknowledge refund requests within 24 hours.`,
  },
];
