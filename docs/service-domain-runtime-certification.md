# Service domain runtime certification

Evidence is a traced consumer, not a stored JSON field.

| FIELD | CONFIGURED | ADMIN | DB | RUNTIME CONSUMER | CUSTOMER | MOBILE | PARTNER | DISPATCH | EXECUTION | PAYMENT | ANALYTICS | TEST | STATUS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| identity | yes | yes | services | catalog.service | yes | yes | yes | yes | snapshot | — | booking_count | service-domain.test | LIVE |
| variants | yes | yes | JSON + service_variants | resolveSelection | BookPageClient | book.tsx variantId | — | — | snapshot.variantId | quote | — | service-domain / booking-quote.test | LIVE |
| audience | yes | yes | JSON | resolveSelection | yes | yes | — | — | snapshot | quote | — | service-domain.test | LIVE |
| quantity | yes | yes | JSON | resolveSelection | yes | stepper | — | — | snapshot | quote | — | service-catalog-config.test | LIVE |
| payment.walletAllowed | yes | yes | JSON | wallet-checkout | capabilities | capabilities | — | — | snapshot | reject WALLET_NOT_ALLOWED | metric | service-runtime-policy.test | LIVE |
| payment.couponAllowed | yes | yes | JSON | booking-pricing | couponError | couponError | — | — | — | COUPON_NOT_ALLOWED | metric | service-runtime-policy.test | LIVE |
| payment.membershipAllowed | yes | yes | JSON | booking-pricing | discount skip | discount skip | — | — | — | skip membership | metric | service-runtime-policy.test | LIVE |
| payment.splitPaymentAllowed | yes | yes | JSON | wallet-checkout.initiateSplit | capabilities | — | — | — | snapshot | SPLIT_NOT_ALLOWED | metric | service-runtime-policy.test | LIVE |
| matching weights | optional | yes | JSON | matching.service applyMatchingWeights | — | — | — | score | matchingConfigVersion | — | persist scores | service-runtime-policy.test | LIVE |
| matching.skillWeight | optional | stored | JSON | not a score term | — | — | — | requiredSkills filter | — | — | — | audit script | CONFIG_ONLY_BY_DESIGN |
| requiredSkills | yes | yes | JSON | matching + booking-validation | — | — | partnerEligible | hasEvery | — | — | ineligible metric | matching loadCandidates | LIVE |
| quality proof/checklist | optional | yes | JSON | booking.complete before money | — | — | execution.quality | — | QUALITY_* | — | block metric | service-runtime-policy.test | LIVE |
| quality.customerConfirmation | optional | stored | JSON | Rating after complete | Rating | Rating | — | — | not gated | — | — | documented | CONFIG_ONLY_BY_DESIGN |
| warrantyDays | optional | yes | snapshot | snapshot record | summary | — | snapshot | — | no revisit engine | — | — | — | PARTIAL |
| availability rules | optional | yes | JSON | booking-validation | errors | errors | — | — | — | — | metric | booking-validation | LIVE |
| coverage | yes | yes | columns+JSON | coverageAllowsAddress | yes | serviceability | — | — | — | — | metric | service-catalog-config.test | LIVE |
| duration vs slot | yes | yes | JSON + trigger | estimatedDuration on booking; slot trigger ±30m | display | display | durationMinutes | protected trigger | display ≠ reserved slot unless owner changes trigger | — | — | service-domain.test slot note | CONFIG_ONLY_BY_DESIGN (slot) / LIVE (booking duration field) |
| materials/equipment | yes | yes | JSON | customer/partner copy | yes | — | job copy | — | instructions | — | — | runtime-policy | LIVE |
| onboarding catalog | yes | catalog | services | GET register/service-options | — | ServicesStep | Step2Services | compatibility map | — | — | — | — | LIVE |
| /me/services UI | yes | — | — | catalog.partnerEligible | — | — | work-hq/services | eligibility | checklist | — | — | — | LIVE |
| public matching leak | n/a | n/a | n/a | publicCatalogConfig strips matching | hidden | hidden | hidden | — | — | — | — | service-domain.test | LIVE |

No UNKNOWN rows. PARTIAL = warranty revisit workflow not built (no Warranty model). CONFIG_ONLY_BY_DESIGN rows are explicit.

## Engines (unchanged count)

- One pricing engine: `resolveSelection` + `bookingPricingService.quote`
- One booking engine: `booking.service.create`
- One matching engine: `matching.service` + `service-match.ts` overlay
- One payment engine: wallet-checkout + razorpay + quote discounts
- One availability authority: `booking-validation.service`
