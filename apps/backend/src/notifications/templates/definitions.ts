import { registerTemplate, syncTemplates, activateTemplate, type VariableType } from "./registry";

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

  /**
   * The review request in the app's own inbox.
   *
   * The surface the legacy job actually used: `sendNotification` wrote a Notification row for every
   * recipient, device or not. Same wording as the push template, because it is the same message
   * appearing in the same app — only now the router can name which surface it meant.
   */
  registerTemplate({
    templateId: "booking.review_request.in_app.en",
    version: 1,
    notificationType: "booking.review_request",
    category: "OPTIONAL",
    channel: "IN_APP",
    language: "en",
    title: "How was your service?",
    body: "Tell us about booking {{bookingNumber}}. Your feedback helps other customers.",
    variables: { bookingNumber: "string" },
  });

  registerTemplate({
    templateId: "booking.review_request.in_app.hi",
    version: 1,
    notificationType: "booking.review_request",
    category: "OPTIONAL",
    channel: "IN_APP",
    language: "hi",
    title: "Service kaisi rahi?",
    body: "Booking {{bookingNumber}} ke baare mein bataiye. Aapka feedback dusre customers ki madad karta hai.",
    variables: { bookingNumber: "string" },
  });

  /**
   * The review request by email, for customers with no registered device.
   *
   * Wording is carried over from the push template rather than rewritten — this is a migration, and
   * changing what the message says while moving it would make any later comparison meaningless. The
   * only addition is the closing line, because an email is read out of context where a push
   * notification is read inside the app that explains it.
   *
   * Same single variable. A review request quotes a booking number and asks a question; it has no
   * business carrying an amount, a name or a link to anything.
   */
  registerTemplate({
    templateId: "booking.review_request.email.en",
    version: 1,
    notificationType: "booking.review_request",
    category: "OPTIONAL",
    channel: "EMAIL",
    language: "en",
    title: "How was your service?",
    body: "Tell us about booking {{bookingNumber}}. Your feedback helps other customers.\n\nYou can leave a review any time in the HOMEEIGO app.",
    variables: { bookingNumber: "string" },
  });

  registerTemplate({
    templateId: "booking.review_request.email.hi",
    version: 1,
    notificationType: "booking.review_request",
    category: "OPTIONAL",
    channel: "EMAIL",
    language: "hi",
    title: "Service kaisi rahi?",
    body: "Booking {{bookingNumber}} ke baare mein bataiye. Aapka feedback dusre customers ki madad karta hai.\n\nAap HOMEEIGO app mein kabhi bhi review de sakte hain.",
    variables: { bookingNumber: "string" },
  });

  /**
   * Post-service follow-up.
   *
   * Distinct from the review request above: this asks a general "did everything work out" question
   * rather than for a star rating, so it is sent regardless of whether the booking was already
   * rated (see `booking.still_completed` in the condition registry). OPTIONAL, matching the review
   * request's own classification — a check-in the customer may decline, not something they need to
   * use the product.
   */
  registerTemplate({
    templateId: "booking.follow_up_checkin.push.en",
    version: 1,
    notificationType: "booking.follow_up_checkin",
    category: "OPTIONAL",
    channel: "PUSH",
    language: "en",
    title: "Everything go okay?",
    body: "Following up on booking {{bookingNumber}}. Let us know if you need anything else.",
    variables: { bookingNumber: "string" },
  });

  registerTemplate({
    templateId: "booking.follow_up_checkin.push.hi",
    version: 1,
    notificationType: "booking.follow_up_checkin",
    category: "OPTIONAL",
    channel: "PUSH",
    language: "hi",
    title: "Sab theek raha?",
    body: "Booking {{bookingNumber}} ke baare mein follow-up. Agar kuch aur chahiye to bataiye.",
    variables: { bookingNumber: "string" },
  });

  registerTemplate({
    templateId: "booking.follow_up_checkin.in_app.en",
    version: 1,
    notificationType: "booking.follow_up_checkin",
    category: "OPTIONAL",
    channel: "IN_APP",
    language: "en",
    title: "Everything go okay?",
    body: "Following up on booking {{bookingNumber}}. Let us know if you need anything else.",
    variables: { bookingNumber: "string" },
  });

  registerTemplate({
    templateId: "booking.follow_up_checkin.in_app.hi",
    version: 1,
    notificationType: "booking.follow_up_checkin",
    category: "OPTIONAL",
    channel: "IN_APP",
    language: "hi",
    title: "Sab theek raha?",
    body: "Booking {{bookingNumber}} ke baare mein follow-up. Agar kuch aur chahiye to bataiye.",
    variables: { bookingNumber: "string" },
  });

  registerTemplate({
    templateId: "booking.follow_up_checkin.email.en",
    version: 1,
    notificationType: "booking.follow_up_checkin",
    category: "OPTIONAL",
    channel: "EMAIL",
    language: "en",
    title: "Everything go okay?",
    body: "Following up on booking {{bookingNumber}}. Let us know if you need anything else.\n\nYou can reach us any time in the HOMEEIGO app.",
    variables: { bookingNumber: "string" },
  });

  registerTemplate({
    templateId: "booking.follow_up_checkin.email.hi",
    version: 1,
    notificationType: "booking.follow_up_checkin",
    category: "OPTIONAL",
    channel: "EMAIL",
    language: "hi",
    title: "Sab theek raha?",
    body: "Booking {{bookingNumber}} ke baare mein follow-up. Agar kuch aur chahiye to bataiye.\n\nAap HOMEEIGO app mein kabhi bhi hamse sampark kar sakte hain.",
    variables: { bookingNumber: "string" },
  });

  /**
   * Payment recovery.
   *
   * ── No link, on purpose ────────────────────────────────────────────────────
   *
   * Discovery found no payment-link or deep-link capability anywhere: the only customer payment
   * routes are `/api/payments/create-order` and `/verify`, both of which start a real gateway order.
   * Rather than invent a `paymentLink` variable — which would mean inventing an endpoint to fill it —
   * the message names the booking and lets the customer finish payment where they started it. A
   * template promising a link that does not exist would be worse than no message at all.
   *
   * ── Why OPTIONAL and not TRANSACTIONAL ─────────────────────────────────────
   *
   * A failed payment is arguably something the customer needs to know, which would argue for
   * TRANSACTIONAL. But under the shipped Phase-6C policy TRANSACTIONAL is exempt from cadence and
   * from quiet hours, and a recovery nudge is exactly the kind of message that should not arrive at
   * 23:00 or three times in a day. This is a nudge the customer may decline, so OPTIONAL is the
   * honest classification — and it is a product decision worth revisiting rather than a technical
   * detail.
   */
  registerTemplate({
    templateId: "payment.recovery_nudge.push.en",
    version: 1,
    notificationType: "payment.recovery_nudge",
    category: "OPTIONAL",
    channel: "PUSH",
    language: "en",
    title: "Your payment didn't go through",
    body: "Payment for booking {{bookingNumber}} wasn't completed. You can finish it in the app when you're ready.",
    variables: { bookingNumber: "string" },
  });

  registerTemplate({
    templateId: "payment.recovery_nudge.push.hi",
    version: 1,
    notificationType: "payment.recovery_nudge",
    category: "OPTIONAL",
    channel: "PUSH",
    language: "hi",
    title: "Aapka payment complete nahi hua",
    body: "Booking {{bookingNumber}} ka payment poora nahi hua. Aap ise app mein kabhi bhi complete kar sakte hain.",
    variables: { bookingNumber: "string" },
  });

  /**
   * The same nudge by email, because push alone could not reach the people it is for.
   *
   * The first real observation skipped with NO_CHANNEL_TARGET: the customer had no registered
   * device, and someone who abandons a payment in a web checkout is exactly the person least likely
   * to have the app installed. Push-only made the automation unable to reach its own audience.
   *
   * Still OPTIONAL, and still second in the order — a customer with a live device gets the push and
   * nothing else. Category is unchanged on purpose: it is what keeps the daily cap, the workflow
   * cooldown, quiet hours and the recipient's own opt-out applying to these messages.
   *
   * The body carries a booking number and nothing else. No amount, no card detail, no payment link,
   * no contact detail — an email is forwardable and screenshotted, and none of that belongs in one.
   */
  registerTemplate({
    templateId: "payment.recovery_nudge.email.en",
    version: 1,
    notificationType: "payment.recovery_nudge",
    category: "OPTIONAL",
    channel: "EMAIL",
    language: "en",
    title: "Your payment didn't go through",
    body: "Payment for booking {{bookingNumber}} wasn't completed.\n\nYou can finish it in the HOMEEIGO app whenever you're ready — your booking is still waiting.\n\nIf you've already paid, please ignore this message.",
    variables: { bookingNumber: "string" },
  });

  registerTemplate({
    templateId: "payment.recovery_nudge.email.hi",
    version: 1,
    notificationType: "payment.recovery_nudge",
    category: "OPTIONAL",
    channel: "EMAIL",
    language: "hi",
    title: "Aapka payment complete nahi hua",
    body: "Booking {{bookingNumber}} ka payment poora nahi hua.\n\nAap ise HOMEEIGO app mein kabhi bhi complete kar sakte hain — aapki booking abhi bhi wait kar rahi hai.\n\nAgar aapne payment kar diya hai, to is message ko ignore karein.",
    variables: { bookingNumber: "string" },
  });

  /**
   * Abandoned checkout.
   *
   * ── Category, following precedent rather than inventing one ────────────────
   *
   * OPTIONAL, exactly as `payment.recovery_nudge` is, and for the same reason. This is a nudge the
   * customer may decline: they started a checkout and did not finish, which is their right. OPTIONAL
   * is what keeps the daily cap, the workflow cooldown, quiet hours and their own preference
   * applying. TRANSACTIONAL would exempt it from all four and let it arrive at 23:00 — and nothing
   * about an unfinished checkout is urgent enough to earn that.
   *
   * ── No link, same as payment recovery ──────────────────────────────────────
   *
   * There is still no payment-link capability in the platform, so the message names the booking and
   * lets the customer finish where they started. Inventing a `checkoutLink` variable would mean
   * inventing the endpoint behind it.
   *
   * One variable. A checkout reminder quotes a booking number; it has no business carrying an
   * amount, a card detail or a contact detail.
   */
  registerTemplate({
    templateId: "checkout.recovery_nudge.push.en",
    version: 1,
    notificationType: "checkout.recovery_nudge",
    category: "OPTIONAL",
    channel: "PUSH",
    language: "en",
    title: "You left something unfinished",
    body: "Your booking {{bookingNumber}} is still waiting — you can complete checkout in the app whenever you're ready.",
    variables: { bookingNumber: "string" },
  });

  registerTemplate({
    templateId: "checkout.recovery_nudge.push.hi",
    version: 1,
    notificationType: "checkout.recovery_nudge",
    category: "OPTIONAL",
    channel: "PUSH",
    language: "hi",
    title: "Aapka checkout adhoora reh gaya",
    body: "Booking {{bookingNumber}} abhi bhi wait kar rahi hai — aap ise app mein kabhi bhi complete kar sakte hain.",
    variables: { bookingNumber: "string" },
  });

  registerTemplate({
    templateId: "checkout.recovery_nudge.email.en",
    version: 1,
    notificationType: "checkout.recovery_nudge",
    category: "OPTIONAL",
    channel: "EMAIL",
    language: "en",
    title: "You left something unfinished",
    body: "Your booking {{bookingNumber}} is still waiting.\n\nYou can complete checkout in the HOMEEIGO app whenever you're ready.\n\nIf you've already completed it, please ignore this message.",
    variables: { bookingNumber: "string" },
  });

  registerTemplate({
    templateId: "checkout.recovery_nudge.email.hi",
    version: 1,
    notificationType: "checkout.recovery_nudge",
    category: "OPTIONAL",
    channel: "EMAIL",
    language: "hi",
    title: "Aapka checkout adhoora reh gaya",
    body: "Booking {{bookingNumber}} abhi bhi wait kar rahi hai.\n\nAap ise HOMEEIGO app mein kabhi bhi complete kar sakte hain.\n\nAgar aap pehle hi complete kar chuke hain, to is message ko ignore karein.",
    variables: { bookingNumber: "string" },
  });

  // ── Partner acquisition & onboarding (Section 01) ───────────────────────────
  const partnerTemplates: Array<{
    id: string;
    type: string;
    channel: "PUSH" | "IN_APP" | "EMAIL";
    lang: "en" | "hi";
    title: string;
    body: string;
    /**
     * Placeholders this template uses beyond `partnerName`.
     *
     * Not decoration. `registerTemplate` refuses any template whose body names an undeclared
     * variable, and the loop below used to declare `partnerName` for every entry — so the Item 6 and
     * Item 7 templates, which legitimately need a zone and a window, made `registerAllTemplates()`
     * throw. That throw escaped `bootstrapTemplates()` into `bootstrapWorkflows()`, whose catch in
     * `maintenance.ts` returns before `startOutboxProcessor()` and `startScheduledJobProcessor()`.
     * The result was silent and total: no scheduled job and no outbox event ran for three days.
     *
     * Declaring variables per template is what makes that a startup-time impossibility rather than a
     * convention someone has to remember.
     */
    extraVars?: string[];
  }> = [
    {
      id: "partner.welcome.in_app.en",
      type: "partner.welcome",
      channel: "IN_APP",
      lang: "en",
      title: "Welcome to HOMEEIGO Partner",
      body: "Hi {{partnerName}}, you're activated! Open the app to go online and start accepting jobs.",
    },
    {
      id: "partner.welcome.push.en",
      type: "partner.welcome",
      channel: "PUSH",
      lang: "en",
      title: "You're live on HOMEEIGO",
      body: "Welcome {{partnerName}}! Your partner account is active — tap to go online.",
    },
    {
      id: "partner.application_approved.in_app.en",
      type: "partner.application_approved",
      channel: "IN_APP",
      lang: "en",
      title: "Application approved",
      body: "Great news {{partnerName}} — your partner application has been approved.",
    },
    {
      id: "partner.onboarding_resume.in_app.en",
      type: "partner.onboarding_resume",
      channel: "IN_APP",
      lang: "en",
      title: "Continue your application",
      body: "Hi {{partnerName}}, your partner application is saved. Pick up where you left off.",
    },
    {
      id: "partner.onboarding_resume.push.en",
      type: "partner.onboarding_resume",
      channel: "PUSH",
      lang: "en",
      title: "Finish your application",
      body: "{{partnerName}}, you're almost there — continue your HOMEEIGO partner onboarding.",
    },
    {
      id: "partner.kyc_reminder.in_app.en",
      type: "partner.kyc_reminder",
      channel: "IN_APP",
      lang: "en",
      title: "Complete your KYC",
      body: "Hi {{partnerName}}, submit your identity documents to move forward with activation.",
    },
    {
      id: "partner.training_reminder.in_app.en",
      type: "partner.training_reminder",
      channel: "IN_APP",
      lang: "en",
      title: "Complete required training",
      body: "Hi {{partnerName}}, finish your Academy modules to become eligible for activation.",
    },
    /**
     * Morning Intelligence (Item 6) — the minimum template the architecture requires.
     *
     * ── Why a new type rather than an existing one ─────────────────────────────
     *
     * None of the templates above is a fit. They are onboarding messages: one-off, milestone-driven,
     * and about the partner's application rather than their working day. Reusing one would put a
     * daily brief under a notification type whose cadence, cooldown and preference all mean
     * something else, and a partner who muted "KYC reminders" would silently lose their brief.
     *
     * ── Every variable is a fact the brief already computed ────────────────────
     *
     * `topZoneName`, `windowLabel` and `nudgeCount` are lifted from the assembled `MorningBrief` —
     * a ranked zone, an evidenced time window, a count of nudges that passed their significance
     * gate. The template renders them; it does not decide them. There is deliberately no free-text
     * variable: an LLM summary is presentation only and must never arrive here, because a body
     * string is the one place a generated sentence would become indistinguishable from a measured
     * fact.
     *
     * Wording avoids any promise of income. "Where demand looks strongest" is a statement about the
     * ranking; "you could earn X today" would be a forecast the platform has not earned the right
     * to make.
     */
    {
      id: "partner.morning_intelligence.push.en",
      // `nudgeCount` is declared (the workflow step supplies it for the IN_APP body) but not
      // rendered on PUSH; validation rejects undeclared variables, so it must be listed here too.
      extraVars: ["topZoneName", "windowLabel", "nudgeCount"],
      type: "partner.morning_intelligence",
      channel: "PUSH",
      lang: "en",
      title: "Your day ahead",
      body: "{{partnerName}}, {{topZoneName}} looks strongest today. Best window: {{windowLabel}}.",
    },
    /**
     * Surge alerts (Item 7) — pressure, never pay.
     *
     * The wording is constrained by a discovery finding, not by taste. Three things in this platform
     * are called surge and only `weatherService.surgeMultiplier()` reaches a payment; the zone
     * `predictedSurge` this alert is built on reaches nothing. A partner who read "surge is 3x" and
     * inferred triple pay would be wrong, and the platform would have told them so.
     *
     * So there is no multiplier variable, no rate, no rupee figure and no "earn more". `{{zoneName}}`
     * is a label rendered beside an alert whose identity is `zoneId`, and `{{demandEvidence}}` is the
     * measured supply/active-jobs pair the decision was made from — evidence a partner can check,
     * not a claim they must trust.
     */
    {
      id: "partner.surge_alert.push.en",
      // `observedAt` is supplied by the surge workflow step for the IN_APP body; declared here so
      // the PUSH variant does not reject the same variable set (see morning_intelligence).
      extraVars: ["zoneName", "demandEvidence", "observedAt"],
      type: "partner.surge_alert",
      channel: "PUSH",
      lang: "en",
      title: "High demand nearby",
      body: "{{zoneName}} has more jobs than partners right now ({{demandEvidence}}).",
    },
    {
      id: "partner.surge_alert.in_app.en",
      extraVars: ["zoneName", "demandEvidence", "observedAt"],
      type: "partner.surge_alert",
      channel: "IN_APP",
      lang: "en",
      title: "Demand pressure in {{zoneName}}",
      body:
        "{{zoneName}} is currently under demand pressure — {{demandEvidence}}. " +
        "Measured {{observedAt}}. This reflects job availability, not a change to your pay rate.",
    },
    {
      id: "partner.morning_intelligence.in_app.en",
      extraVars: ["topZoneName", "windowLabel", "nudgeCount"],
      type: "partner.morning_intelligence",
      channel: "IN_APP",
      lang: "en",
      title: "Your morning brief",
      body:
        "Hi {{partnerName}} — {{topZoneName}} is ranked highest for today, and your strongest " +
        "window is {{windowLabel}}. {{nudgeCount}} performance insight(s) are waiting in the app.",
    },
    {
      id: "partner.kyc_expiring_d30.in_app.en",
      type: "partner.kyc_expiring_d30",
      channel: "IN_APP",
      lang: "en",
      title: "Document expiring soon",
      body: "Hi {{partnerName}}, your {{documentType}} expires within 30 days. Update it in the app to stay active.",
      extraVars: ["documentType"],
    },
    {
      id: "partner.kyc_expiring_d7.push.en",
      type: "partner.kyc_expiring_d7",
      channel: "PUSH",
      lang: "en",
      title: "Urgent: document expiring",
      body: "{{partnerName}}, your {{documentType}} expires within 7 days. Update now to avoid restrictions.",
      extraVars: ["documentType"],
    },
    {
      id: "partner.kyc_expired.in_app.en",
      type: "partner.kyc_expired",
      channel: "IN_APP",
      lang: "en",
      title: "Account restricted",
      body: "Hi {{partnerName}}, your {{documentType}} has expired. Update documents to restore full access.",
      extraVars: ["documentType"],
    },
    {
      id: "partner.payout_failed.in_app.en",
      type: "partner.payout_failed",
      channel: "IN_APP",
      lang: "en",
      title: "Payout could not be processed",
      body: "Hi {{partnerName}}, payout {{withdrawalNumber}} failed. Check your bank details or contact support.",
      extraVars: ["withdrawalNumber"],
    },
    {
      id: "partner.sos_acknowledged.in_app.en",
      type: "partner.sos_acknowledged",
      channel: "IN_APP",
      lang: "en",
      title: "SOS received",
      body: "Hi {{partnerName}}, we received your SOS. Our safety team has been alerted and will respond immediately.",
    },
    {
      id: "partner.rating_coaching.in_app.en",
      type: "partner.rating_coaching",
      channel: "IN_APP",
      lang: "en",
      title: "Tips to improve your rating",
      body: "Hi {{partnerName}}, your recent ratings suggest room to improve. Open Academy for coaching tips.",
    },
    {
      id: "partner.reengagement.push.en",
      type: "partner.reengagement",
      channel: "PUSH",
      lang: "en",
      title: "We miss you on HOMEEIGO",
      body: "Hi {{partnerName}}, you have been offline for a while. Go online to see jobs near you.",
    },
    {
      id: "partner.dispatch_stall.push.en",
      type: "partner.dispatch_stall",
      channel: "PUSH",
      lang: "en",
      title: "Customer is waiting",
      body: "Booking {{bookingNumber}} is assigned to you. Tap to start your trip.",
      extraVars: ["bookingNumber"],
    },
  ];

  for (const t of partnerTemplates) {
    const variables: Record<string, VariableType> = { partnerName: "string" };
    for (const name of t.extraVars ?? []) variables[name] = "string";
    registerTemplate({
      templateId: t.id,
      version: 1,
      notificationType: t.type,
      category: "OPTIONAL",
      channel: t.channel,
      language: t.lang,
      title: t.title,
      body: t.body,
      variables,
    });
  }

  /**
   * Scheduled executive reports (Phase 9, Capability 11) — an announcement, never the report.
   *
   * ── No free-text variable, deliberately ────────────────────────────────────
   *
   * Same rule the morning brief follows, and for a stronger reason here: this message is about
   * finance, fraud and forecast internals. A body string is the one place a generated sentence
   * becomes indistinguishable from a measured fact, so the report's prose — deterministic or
   * model-written — never reaches a template. What travels is counts and a state.
   *
   * ── No figures either ──────────────────────────────────────────────────────
   *
   * There is no GMV, no revenue and no margin variable. A push notification is not an authenticated
   * surface: it renders on a lock screen, and it is delivered to a device rather than to a session.
   * The numbers stay behind the console's RBAC, and the message says only that a report exists,
   * how complete it is, and how much of it needs review.
   *
   * `reportState` carries GENERATED / STALE / INCOMPLETE verbatim, so an administrator is told the
   * report is degraded in the same breath as being told it exists.
   */
  const reportVars: Record<string, VariableType> = {
    periodLabel: "string",
    reportState: "string",
    factCount: "string",
    warningCount: "string",
    recommendationCount: "string",
  };

  registerTemplate({
    templateId: "admin.executive_report.in_app.en",
    version: 1,
    notificationType: "admin.executive_report",
    category: "TRANSACTIONAL",
    channel: "IN_APP",
    language: "en",
    title: "{{periodLabel}} executive brief is ready",
    body:
      "Your {{periodLabel}} executive brief is available in the admin console ({{reportState}}). " +
      "{{factCount}} measured figure(s), {{warningCount}} warning(s), {{recommendationCount}} " +
      "item(s) flagged for review. Open the console to read it.",
    variables: reportVars,
  });

  registerTemplate({
    templateId: "admin.executive_report.email.en",
    version: 1,
    notificationType: "admin.executive_report",
    category: "TRANSACTIONAL",
    channel: "EMAIL",
    language: "en",
    title: "HOMEEIGO {{periodLabel}} executive brief",
    body:
      "The {{periodLabel}} executive brief has been generated ({{reportState}}). " +
      "It contains {{factCount}} measured figure(s), {{warningCount}} warning(s) and " +
      "{{recommendationCount}} item(s) flagged for review. " +
      "Figures are not included in this message; open the admin console to read the report.",
    variables: reportVars,
  });

  // Phase 10 §10 — completion confirmation (defined below; rendered directly by booking-completion.service).
  for (const def of BOOKING_COMPLETION_TEMPLATES) registerTemplate(def);
}

/**
 * Phase 10 §10 — the customer-confirmation axis of completion, in the app's own inbox.
 *
 * `confirm_request` replaces the body of the existing "Service Completed" inbox message when a
 * completion row was written (one message per completion, never two). `auto_confirmed` is the one
 * message the auto-confirm sweep sends. Both carry the booking number and the window length only —
 * no amounts, names or links. Every placeholder is declared.
 */
const completionVars: Record<string, VariableType> = { bookingNumber: "string", windowHours: "string" };
export const BOOKING_COMPLETION_TEMPLATES = [
  {
    templateId: "booking.completion_confirm_request.in_app.en", version: 1, notificationType: "booking.completion_confirm_request",
    category: "TRANSACTIONAL", channel: "IN_APP", language: "en",
    title: "Your service is complete",
    body: "Booking {{bookingNumber}} is marked complete. Please confirm it or report an issue within {{windowHours}} hours — after that it is confirmed automatically.",
    variables: completionVars,
  },
  {
    templateId: "booking.completion_confirm_request.in_app.hi", version: 1, notificationType: "booking.completion_confirm_request",
    category: "TRANSACTIONAL", channel: "IN_APP", language: "hi",
    title: "Aapki service poori ho gayi",
    body: "Booking {{bookingNumber}} poori mark ho gayi hai. {{windowHours}} ghante ke andar confirm kijiye ya koi samasya report kijiye — uske baad yeh apne aap confirm ho jayegi.",
    variables: completionVars,
  },
  {
    templateId: "booking.completion_auto_confirmed.in_app.en", version: 1, notificationType: "booking.completion_auto_confirmed",
    category: "TRANSACTIONAL", channel: "IN_APP", language: "en",
    title: "Service confirmed",
    body: "Booking {{bookingNumber}} was confirmed automatically because the {{windowHours}}-hour confirmation window closed. You can still contact support about this booking.",
    variables: completionVars,
  },
  {
    templateId: "booking.completion_auto_confirmed.in_app.hi", version: 1, notificationType: "booking.completion_auto_confirmed",
    category: "TRANSACTIONAL", channel: "IN_APP", language: "hi",
    title: "Service confirm ho gayi",
    body: "Booking {{bookingNumber}} apne aap confirm ho gayi kyunki {{windowHours}} ghante ki confirmation window band ho gayi. Is booking ke baare mein aap ab bhi support se sampark kar sakte hain.",
    variables: completionVars,
  },
] as const satisfies ReadonlyArray<Parameters<typeof registerTemplate>[0]>;

export async function bootstrapTemplates(): Promise<void> {
  registerAllTemplates();
  await syncTemplates();
  // Activated deliberately: these are the only messages this phase is cleared to send.
  await activateTemplate("booking.review_request.push.en", 1);
  await activateTemplate("booking.review_request.push.hi", 1);
}
