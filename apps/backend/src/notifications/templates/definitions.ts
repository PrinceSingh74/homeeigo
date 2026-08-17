import { registerTemplate, syncTemplates, activateTemplate } from "./registry";

/**
 * Shipped templates.
 *
 * Only what the existing automation needs. The review request is the one message HOMEEIGO already
 * sends from a workflow, and it is moved here so its wording lives in a reviewed, versioned place
 * rather than inline in the job handler.
 */

export function registerAllTemplates(): void {
  registerTemplate({
    templateId: "booking.review_request.push.en",
    version: 1,
    notificationType: "booking.review_request",
    category: "OPTIONAL",
    channel: "PUSH",
    language: "en",
    title: "How was your service?",
    body: "Tell us about booking {{bookingNumber}}. Your feedback helps other customers.",
    variables: { bookingNumber: "string" },
  });

  registerTemplate({
    templateId: "booking.review_request.push.hi",
    version: 1,
    notificationType: "booking.review_request",
    category: "OPTIONAL",
    channel: "PUSH",
    language: "hi",
    title: "Service kaisi rahi?",
    body: "Booking {{bookingNumber}} ke baare mein bataiye. Aapka feedback dusre customers ki madad karta hai.",
    variables: { bookingNumber: "string" },
  });
}

export async function bootstrapTemplates(): Promise<void> {
  registerAllTemplates();
  await syncTemplates();
  // Activated deliberately: these are the only messages this phase is cleared to send.
  await activateTemplate("booking.review_request.push.en", 1);
  await activateTemplate("booking.review_request.push.hi", 1);
}
