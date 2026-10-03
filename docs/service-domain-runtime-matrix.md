# Service domain runtime matrix

Generated from live code after wiring configuration into the existing engines.
Statuses: LIVE, PARTIAL, CONFIG_ONLY, CONFIGURATION_ONLY_BY_DESIGN, DEAD, DUPLICATED, CONFLICTING.

Owner of money, eligibility, and bookability is always the backend. Clients preview; they do not decide.

| Field | Owner | DB | Admin writer | Public API | Customer | Mobile | Partner | Dispatch | Booking | Payment | Execution | Analytics | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Service identity / slug | Service | services | ServiceConfigEditor | catalog list/detail | web/mobile | mapper | partnerEligible | service-match | booking.create | — | snapshot | booking_count | LIVE |
| catalogConfig JSON | Service | services.catalog_config | 25-section editor | publicCatalogConfig (matching stripped) | catalogConfig | catalogConfig | execution copy | hydrated catalog | snapshot | payment flags | quality snapshot | — | LIVE |
| Relational variants/addons | ServiceVariant / ServiceAddon | service_variants / service_addons | editor dual-write | hydrated into catalogConfig | BookPageClient variantId | book.tsx variantId | — | — | resolveSelection | quote | snapshot.variantId | — | LIVE |
| capabilityProfile | Service | services.capability_profile | editor | bookingFlow | booking steps | booking steps | — | — | validateForActivation | — | — | — | LIVE |
| quantity rules | catalogConfig.quantity | JSON | editor | catalogConfig.quantity | quantity UI | quantity stepper | — | — | resolveSelection | quote | snapshot.quantity | — | LIVE |
| audiences | catalogConfig.audiences | JSON | editor | catalogConfig | audience picker | audience picker | — | — | resolveSelection | quote | snapshot | — | LIVE |
| payment.walletAllowed | catalogConfig.payment | JSON | editor (Payment engine) | paymentCapabilities | wallet UI | wallet UI | — | — | snapshot.payment | wallet-checkout | — | service_payment_policy_rejected_total | LIVE |
| payment.couponAllowed | catalogConfig.payment | JSON | editor (Quote engine) | paymentCapabilities.couponAvailable | coupon field | coupon field | — | — | quote | quote | — | same | LIVE |
| payment.membershipAllowed | catalogConfig.payment | JSON | editor | paymentCapabilities | membership discount | membership discount | — | — | quote | quote | — | same | LIVE |
| payment.splitPaymentAllowed | catalogConfig.payment | JSON | editor | paymentCapabilities | split checkout | split checkout | — | — | snapshot | wallet-checkout.initiateSplit | — | same | LIVE |
| payment.paymentTiming | catalogConfig.payment | JSON | stored | stripped/not advertised as runtime | — | — | — | paymentRequiredBeforeDispatch on bookingRules | — | — | — | CONFIGURATION_ONLY_BY_DESIGN |
| payment.invoiceRequired | catalogConfig.payment | JSON | stored | — | — | — | — | — | — | no invoice-required path | — | — | CONFIGURATION_ONLY_BY_DESIGN |
| matching.rating/distance/availability/response/completion weights | catalogConfig.matching | JSON | editor (Matching engine) | stripped from public | — | — | — | matching.service applyMatchingWeights | matchingConfigVersion on match | — | — | — | LIVE |
| matching.skillWeight numeric | catalogConfig.matching | JSON | stored | stripped | — | — | — | skill is a hard filter via requiredSkills | — | — | — | CONFIGURATION_ONLY_BY_DESIGN |
| providerRequirements.requiredSkills | catalogConfig | JSON | editor | stripped (verifiedProfessional only) | — | — | partnerEligible | loadCandidates hasEvery | booking-validation | — | — | service_provider_ineligible_total | LIVE |
| quality.checklist / proofRequired / beforeAfterPhotos | catalogConfig.quality | JSON | editor (Completion gate) | qualitySummary counts only | — | — | execution.quality + checklist | — | snapshot.quality | — | booking.complete gate | service_quality_completion_block_total | LIVE |
| quality.customerConfirmation | catalogConfig.quality | JSON | stored | — | post-job Rating | Rating | — | — | — | — | not a complete OTP | — | CONFIGURATION_ONLY_BY_DESIGN |
| quality.warrantyDays | catalogConfig.quality | JSON | editor | qualitySummary.warrantyDays | — | — | snapshot | — | snapshot `warranty.{days,until}` at complete | — | — | PARTIAL (window recorded; no revisit engine) |
| availability.lead/sameDay/blackout | catalogConfig.availability | JSON | editor | — | slot errors | slot errors | — | — | booking-validation | — | — | service_availability_failures_total | LIVE |
| coverage cities/pins | Service.availableCities + catalogConfig.coverage | columns + JSON | editor | availableCities | Book coverage | serviceability | — | — | coverageAllowsAddress | — | — | same | LIVE |
| duration.totalSlotMin / estimatedDuration | catalogConfig.duration + Service.estimatedDuration | JSON + column | editor | estimatedDuration | display | display | execution.durationMinutes | slot trigger ±30m (protected) | booking.estimatedDuration = selection.durationMinutes | — | display | — | PARTIAL / CONFIGURATION_ONLY_BY_DESIGN for reserved slot |
| materials / equipment policy | catalogConfig | JSON | editor | customer copy | materialsResponsibility | — | partner copy | — | snapshot | — | job instructions | — | LIVE |
| partner onboarding service list | catalog + PARTNER_SLUG_TO_CATEGORIES fallback | services / map | — | GET /api/partner/register/service-options | — | — | Step2Services + ServicesStep | compatibility map still in matching | — | — | — | — | LIVE |
| GET /api/providers/me/services | catalog.partnerEligible | — | — | partner API | — | — | work-hq/services | eligibility | — | — | instructions | — | LIVE |

## Explicit non-runtime (by design)

- Provider reserved slot remains the existing PostgreSQL trigger `[scheduled-30m, scheduled+30m)`. Changing it requires an owner decision and a protected-object migration. UI duration is stored on the booking; it does not silently rewrite the slot window.
- `quality.customerConfirmation` is not a second completion OTP. Customers confirm via Rating after the job.
- `payment.invoiceRequired` and `payment.paymentTiming` are stored. Dispatch already uses `bookingRules.paymentRequiredBeforeDispatch`.
- `matching.skillWeight` is not a score coefficient. Skill is a hard filter (`requiredSkills`).
