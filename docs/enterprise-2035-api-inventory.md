# HOMEEIGO — Enterprise 2035 API Inventory

Generated 2026-09-20T22:58Z by static extraction from `apps/backend/src/routes/*.ts`.

## Method

- Parsed every `.get|.post|.put|.patch|.delete|.ws(` call in the 49 route modules.
- Prefix resolved from `new Elysia({ prefix })`; five admin sub-routers resolved through their `/api/admin` mount in `admin.ts`; `geo.ts` mounts `coverage.ts` at its own absolute prefix.
- Frontend consumption matched against `/api/...` string literals in all five client apps (template placeholders normalised to `*`).

## Totals

| Metric | Count |
|---|---|
| Route modules | 49 |
| Handler call-sites parsed | 794 |
| Distinct normalised paths | 662 |
| Consumed by >=1 frontend | 568 |
| No frontend consumer | 94 |

## Per-module handler counts

| Module | Handlers |
|---|---|
| admin-automation.ts | 5 |
| admin-governance.ts | 9 |
| admin-intelligence.ts | 3 |
| admin-ml.ts | 12 |
| admin-partner-acquisition.ts | 25 |
| admin-partner-referral.ts | 4 |
| admin-trust-safety.ts | 11 |
| admin.ts | 257 |
| agents.routes.ts | 10 |
| ai-brain.routes.ts | 29 |
| ai-gateway.routes.ts | 7 |
| ai-tools.routes.ts | 18 |
| ai.ts | 5 |
| analytics.ts | 27 |
| auth.ts | 43 |
| bookings.ts | 26 |
| compliance.ts | 11 |
| coverage.ts | 11 |
| customer-intelligence.ts | 8 |
| digital-twin.ts | 6 |
| geo-intelligence.ts | 8 |
| geo.ts | 15 |
| gift-cards.ts | 10 |
| hcoins.ts | 3 |
| knowledge.ts | 3 |
| legal.ts | 5 |
| mlops.ts | 4 |
| notifications.ts | 7 |
| observability.ts | 2 |
| partner-nav.ts | 1 |
| partner-register.ts | 31 |
| payments.ts | 10 |
| pricing.ts | 3 |
| providers.ts | 74 |
| ratings.ts | 5 |
| referrals.ts | 4 |
| services.ts | 5 |
| stats.ts | 1 |
| subscriptions.ts | 11 |
| support.ts | 4 |
| tracking.ts | 2 |
| uploads.ts | 4 |
| users.ts | 17 |
| ux-signals.ts | 1 |
| vision.routes.ts | 6 |
| vitals.ts | 1 |
| wallet.ts | 18 |
| weather.ts | 5 |
| webhooks.ts | 7 |

## Full route surface

Format: `METHOD path :line`. Paths are as written in the module; prepend the module prefix shown in the heading.


### admin-automation.ts  prefix=[/automation]  count=5
  GET /overview :14
  GET /instances :19
  GET /dead-letters :34
  GET /outbox :43
  POST /dead-letters/:id/replay :61

### admin-governance.ts  prefix=[/api/admin/governance]  count=9
  GET /ai-budgets :30
  PUT /ai-budgets :54
  GET /workflows/stuck :112
  POST /workflows/:instanceId/recover :121
  GET /workflow-drafts :145
  POST /workflow-drafts :161
  POST /workflow-drafts/:id/review :187
  GET /models/cancellation-risk/evaluation :210
  GET /models/provider-acceptance/evaluation :222

### admin-intelligence.ts  prefix=[]  count=3
  GET /intelligence/executive-brief :56
  GET /intelligence/report-schedule :79
  GET /intelligence/report-recipients :128

### admin-ml.ts  prefix=[/api/admin/ml]  count=12
  GET /health :29
  GET /readiness :32
  GET /models :35
  GET /models/:name/versions :38
  GET /demand/evaluation :48
  GET /demand/forecast :54
  GET /shadow/:versionId :60
  POST /models/:name/versions :77
  POST /versions/:id/transition :111
  POST /versions/:id/approve :129
  POST /versions/:id/promote :137
  POST /models/:name/rollback :145

### admin-partner-acquisition.ts  prefix=[/partner-acquisition]  count=25
  GET /dashboard :82
  GET /sources :91
  GET /leads :102
  POST /leads/check-duplicates :157
  POST /leads :169
  GET /leads/:id :199
  GET /leads/:id/transitions :207
  PATCH /leads/:id/status :216
  PATCH /leads/:id/assign :231
  PATCH /leads/:id/follow-up :244
  PATCH /leads/:id/notes :266
  POST /leads/:id/activity :279
  POST /leads/:id/start-application :303
  GET /applications/:providerId/checklist :315
  POST /applications/:providerId/background-check/verify :323
  GET /leads/:id/merge-preview :340
  POST /leads/:id/mark-duplicate :353
  POST /leads/:id/merge :366
  GET /applications :400
  GET /verification :420
  GET /approvals :439
  GET /spend :458
  POST /spend :474
  PATCH /spend/:id :499
  DELETE /spend/:id :521

### admin-partner-referral.ts  prefix=[/partner-referrals]  count=4
  GET /overview :27
  GET /queue :31
  GET /:id :46
  POST /:id/action :54

### admin-trust-safety.ts  prefix=[]  count=11
  GET /trust-safety/overview :10
  GET /trust-safety/compliance :34
  POST /trust-safety/compliance/:providerId/unrestrict :42
  GET /trust-safety/risk :50
  GET /trust-safety/risk/:providerId :59
  POST /trust-safety/risk/:providerId/review :67
  GET /trust-safety/incidents :89
  GET /trust-safety/incidents/:id :100
  POST /trust-safety/incidents/:id/assign :108
  POST /trust-safety/incidents/:id/acknowledge :116
  POST /trust-safety/incidents/:id/resolve :121

### admin.ts  prefix=[/api/admin]  count=257
  GET /dashboard :152
  GET /command-center/overview :156
  GET /audit :160
  GET /users :180
  GET /providers :184
  GET /providers/:id :190
  GET /providers/:id/score :198
  GET /providers/:id/score/history :207
  GET /providers/:id/career :212
  GET /providers/:id/career/history :221
  GET /providers/:id/lifecycle :226
  POST /providers/:id/lifecycle :238
  GET /heatmap :272
  GET /ops-map :287
  GET /integrity/booking-consistency :293
  GET /ops-alerts/acks :298
  POST /ops-alerts/acks :302
  GET /partner-availability :316
  GET /bookings :337
  GET /bookings/:id :341
  GET x-forwarded-for :343
  GET x-real-ip :343
  POST /bookings/:id/cancel :351
  GET x-forwarded-for :354
  GET x-real-ip :354
  POST /bookings/:id/reschedule :375
  GET x-forwarded-for :378
  GET x-real-ip :378
  POST /bookings/:id/reassign :392
  GET x-forwarded-for :395
  GET x-real-ip :395
  POST /bookings/:id/dispatch :434
  GET x-forwarded-for :436
  GET x-real-ip :436
  POST /bookings/:id/complete :440
  GET x-forwarded-for :443
  GET x-real-ip :443
  POST /bookings/:id/repair :451
  GET x-forwarded-for :454
  GET x-real-ip :454
  POST /bookings/:id/refund :462
  GET x-forwarded-for :465
  GET x-real-ip :465
  POST /bookings/:id/refund/retry :479
  GET x-forwarded-for :482
  GET x-real-ip :482
  PUT /providers/:id/verify :490
  PUT /users/:id/ban :557
  GET /analytics :589
  GET /reviews :597
  PATCH /reviews/:id :601
  DELETE /reviews/:id :613
  POST /withdrawals/:id/approve :621
  POST /withdrawals/:id/reject :626
  POST /withdrawals/:id/process :635
  GET /settlements :646
  GET /chargebacks :653
  GET /finance/dashboard :657
  GET /finance/liabilities :665
  POST /finance/liabilities/snapshot :669
  GET /finance/audit-export/:kind :675
  GET /finance/adjustments :691
  POST /finance/adjustments :696
  POST /finance/adjustments/:id/approve :740
  POST /finance/adjustments/:id/reject :754
  POST /finance/adjustments/:id/execute :768
  POST /finance/backfill/run :779
  GET /finance/backfill/history :793
  GET /finance/backfill/issues :797
  GET /hcoins/expiry/report :803
  PUT /hcoins/expiry/config :807
  POST /hcoins/expiry/run :815
  GET /finance/reconciliation :829
  GET /finance/reconciliation/issues :836
  POST /finance/reconciliation/run :843
  POST /finance/reconciliation/gateway/run :848
  GET /finance/reconciliation/gateway :853
  GET /finance/reconciliation/gateway/issues :857
  GET /finance/settlements :864
  GET /finance/settlements/:id :868
  GET /finance/settlements/:id/export :873
  GET /finance/payouts :879
  POST /finance/payouts/batch :901
  GET x-forwarded-for :903
  GET x-real-ip :903
  POST /finance/payouts/batch/:id/submit :917
  POST /finance/payouts/batch/:id/approve :922
  GET x-forwarded-for :925
  GET x-real-ip :925
  POST /finance/payouts/batch/:id/reject :933
  GET x-forwarded-for :936
  GET x-real-ip :936
  POST /finance/payouts/batch/:id/process :944
  GET x-forwarded-for :947
  GET x-real-ip :947
  GET /finance/payouts/batch/:id :955
  POST /finance/payouts/:id/retry :963
  GET /finance/fraud-cases :973
  GET /finance/migrations :977
  POST /finance/migrations/verify :984
  GET /finance/chargebacks :989
  GET /finance/chargebacks/:id :996
  POST /finance/chargebacks/:id/assign :1001
  POST /finance/chargebacks/:id/respond :1006
  POST /finance/chargebacks/:id/close :1011
  POST /finance/chargebacks/:id/request-evidence :1016
  POST /finance/chargebacks/:id/resolve :1021
  GET /finance/chargebacks/:id/evidence-certificate :1031
  GET /finance/chargebacks/:id/evidence-package :1047
  POST /finance/chargebacks/sla-check :1056
  POST /finance/chargebacks/:id/evidence :1061
  POST /finance/chargebacks/evidence/:evidenceId/download-token :1079
  GET /finance/chargebacks/evidence/download/:token :1084
  GET /finance/chargebacks/:id/export :1102
  GET /finance/settlement-sync :1108
  POST /finance/settlement-sync/run :1116
  POST /finance/settlement-sync/discrepancies/:id/resolve :1121
  POST /finance/settlement-sync/discrepancies/:id/assign :1131
  POST /finance/settlement-sync/discrepancies/:id/investigate :1136
  POST /finance/settlement-sync/discrepancies/:id/escalate :1141
  POST /finance/settlement-sync/discrepancies/:id/notes :1151
  GET /finance/settlement-sync/health :1156
  GET /finance/reports :1160
  GET /finance/reports/export :1169
  GET /finance/integrity :1189
  POST /finance/integrity/run :1198
  GET /finance/integrity/validate :1203
  GET /finance/refunds :1207
  POST /finance/refunds/request :1214
  POST /finance/refunds/:id/approve :1229
  POST /finance/refunds/:id/reject :1239
  GET /finance/risk :1248
  POST /finance/risk/cases/:id/escalate :1252
  POST /finance/risk/holds/:userId/lift :1257
  GET /finance/analytics/unit-economics :1262
  GET /finance/gmv :1268
  GET /finance/intelligence :1274
  GET /finance/config :1279
  GET /finance/config/history :1283
  PATCH /finance/config :1289
  GET x-forwarded-for :1306
  GET x-real-ip :1306
  GET user-agent :1307
  POST /finance/validation/run :1317
  GET /cx/intelligence :1323
  GET /growth/intelligence :1328
  GET /risk/intelligence :1333
  GET /platform/intelligence :1338
  PATCH /platform/flags :1342
  GET /recovery/status :1376
  POST /recovery/simulate :1380
  GET /account-deletions :1386
  GET /services :1392
  GET /services/:id :1398
  POST /services :1406
  PUT /services/:id :1431
  PATCH /services/:id/status :1460
  DELETE /services/:id :1485
  GET /subscriptions/plans :1502
  POST /subscriptions/plans :1506
  PUT /subscriptions/plans/:id :1524
  GET /subscriptions/subscribers :1545
  GET /subscriptions/revenue :1551
  GET /membership/analytics :1555
  GET /membership/analytics/trends :1560
  GET /membership/analytics/export :1565
  GET /membership/insights :1578
  GET /membership/cashback/dashboard :1583
  GET /membership/cashback/liability :1587
  GET /membership/cashback/reports :1591
  GET /membership/queue/analytics :1595
  GET /membership/assignment/metrics :1604
  GET /membership/matching/analytics :1608
  GET /campaigns :1620
  POST /campaigns :1624
  PUT /campaigns/:id :1664
  GET /campaigns/analytics :1701
  GET /membership/coupons :1705
  POST /membership/coupons :1709
  PUT /membership/coupons/:id :1740
  POST /membership/coupons/bulk :1765
  GET /membership/coupons/analytics :1787
  GET /membership/coupons/export :1791
  GET /support/tickets :1797
  GET /support/tickets/:id :1801
  GET /support/tickets/:id/intelligence :1819
  GET /support/tickets/:id/recommendations :1840
  POST /support/tickets/:id/recommendation/verdict :1860
  GET /knowledge/documents :1892
  POST /knowledge/documents :1922
  POST /knowledge/documents/:id/submit-review :1974
  GET /knowledge/documents/:id :1982
  POST /knowledge/documents/:id/approve :2006
  POST /knowledge/documents/:id/withdraw :2013
  POST /knowledge/documents/:id/reindex :2020
  POST /knowledge/seed :2026
  GET /knowledge/analytics :2033
  GET /knowledge/evaluation :2052
  GET /knowledge/authority :2066
  POST /knowledge/authority :2071
  DELETE /knowledge/authority/:type :2097
  POST /knowledge/retrieve :2111
  POST /knowledge/ask :2130
  GET /support/intelligence/analytics :2153
  GET /support/analytics :2158
  POST /support/tickets/:id/respond :2162
  POST /support/tickets/:id/escalate :2200
  POST /support/tickets/:id/merge :2227
  POST /support/tickets/:id/resolve :2244
  GET /referrals/analytics :2258
  GET /fraud/overview :2263
  GET /fraud/high-risk-users :2267
  GET /fraud/review-queue :2271
  GET /fraud/alerts :2275
  GET /fraud/analytics/monthly :2279
  GET /fraud/decisions :2283
  POST /fraud/commissions/:id/approve :2287
  POST /fraud/commissions/:id/reject :2296
  POST /fraud/commissions/:id/freeze :2309
  POST /fraud/commissions/:id/unfreeze :2318
  POST /fraud/users/:id/blacklist :2326
  GET /hcoins/analytics :2340
  GET /hcoins/rules :2344
  PUT /hcoins/rules/:id :2348
  POST /hcoins/grant :2360
  GET /transfers :2373
  GET /giftcards :2378
  GET /invoices :2383
  GET /invoices/export.csv :2387
  GET /revenue-report :2393
  GET /observability/health :2398
  GET /observability/email-health :2402
  GET /observability/alerts :2406
  POST /observability/alerts/:source/:id/resolve :2414
  POST /observability/alerts/evaluate :2422
  GET /observability/logs :2426
  GET /observability/logs/export.json :2430
  GET /observability/logs/export.csv :2434
  GET /observability/archival/strategy :2440
  POST /observability/validation/run :2444
  GET /rbac/me :2449
  GET /rbac/roles :2462
  GET /rbac/admins :2466
  POST /rbac/grant-role :2470
  POST /users/:id/force-logout :2485
  GET x-forwarded-for :2496
  GET user-agent :2497
  POST /rbac/revoke-role :2509
  GET /workforce/analytics :2524
  GET /providers/:id/intelligence :2537
  GET /documents/pending :2549
  PUT /providers/:id/documents/:docId/verify :2561
  PUT /providers/:id/documents/:docId/reject :2582
  GET /academy/modules :2598
  POST /academy/modules :2609
  PATCH /academy/modules/:id :2632
  GET /incentives/rules :2659

### agents.routes.ts  prefix=[/api/agents]  count=10
  GET x-forwarded-for :32
  GET x-real-ip :33
  GET traceparent :40
  GET x-request-id :41
  GET /health :60
  GET / :72
  POST /:agentId/run :108
  GET /runs :171
  GET /runs/:runId :230
  GET /recovery/orphans :270

### ai-brain.routes.ts  prefix=[/api/ai]  count=29
  POST /context :110
  POST /context/rebuild :138
  GET /context/history :160
  GET /context/search :169
  POST /context/cache/purge :183
  GET /context/cache :192
  GET /memory :205
  GET /memory/:key :226
  POST /memory :244
  PATCH /memory/:id :280
  DELETE /memory/:id :299
  GET /memory/stats :308
  POST /memory/:id/compress :317
  GET /prompts :333
  GET /prompts/:promptId :350
  POST /prompts :363
  GET /prompt-versions/:promptId :384
  POST /prompt-versions :393
  POST /prompt-versions/approve :411
  POST /prompt-versions/rollback :422
  POST /prompt-versions/reject :433
  POST /prompt-versions/deprecate :444
  GET /prompt-versions/:promptId/diff/:version :455
  GET /timeline :469
  POST /brain/conversations/:id/summarize :491
  POST /brain/conversations/:id/pin :500
  GET /brain/conversations/recall :511
  GET /brain/conversations :520
  GET /brain/conversations/:id :552

### ai-gateway.routes.ts  prefix=[/api/ai]  count=7
  POST /gateway/chat :103
  POST /customer :111
  POST /partner :119
  POST /admin :137
  GET /usage :155
  GET /cost :166
  GET /health :181

### ai-tools.routes.ts  prefix=[/api/ai/tools]  count=18
  GET x-forwarded-for :30
  GET x-real-ip :31
  GET traceparent :36
  GET x-request-id :37
  GET /health :59
  GET / :70
  GET /registry :87
  GET /:id :96
  POST /execute :108
  GET /history :157
  GET /approvals :177
  POST /approvals/:approvalId/decide :194
  POST /approvals/:approvalId/cancel :217
  GET /approvals/:approvalId :232
  GET /policies :244
  GET /denied :265
  GET /high-risk :275
  GET /metrics :285

### ai.ts  prefix=[/api/ai]  count=5
  POST /chat :150
  GET /conversations :264
  GET /conversations/latest :269
  GET /conversations/:id :274
  DELETE /conversations/:id :283

### analytics.ts  prefix=[/api/analytics]  count=27
  GET /etl/jobs :46
  POST /etl/run :50
  GET /etl/executions/:jobId :74
  GET /etl/watermarks :78
  GET /quality :84
  GET /quality/history/:dataset :88
  GET /freshness :94
  GET /freshness/sla-violations :98
  GET /features/:group :104
  GET /features/metadata :108
  POST /features/export :112
  GET /versions/:type :118
  GET /versions/:type/active :122
  POST /versions/rollback :126
  GET /forecast/models :133
  GET /forecast/model-metrics :137
  GET /forecast/:scope/:granularity :141
  GET /forecast/surge-planning :164
  GET /forecast/capacity :168
  GET /mlops/registry :174
  GET /mlops/metrics :178
  GET /health :182
  GET /eta :203
  GET /eta/quality :208
  GET /eta/readiness :213
  GET /eta/trips :218
  GET /eta/google :224

### auth.ts  prefix=[/api/auth]  count=43
  GET authorization :151
  POST /register :226
  GET user-agent :324
  GET user-agent :347
  GET user-agent :397
  POST /login :436
  GET user-agent :454
  GET user-agent :476
  GET user-agent :502
  GET user-agent :516
  POST /logout :556
  GET authorization :559
  GET user-agent :590
  GET user-agent :603
  GET user-agent :625
  POST /refresh :643
  GET user-agent :667
  POST /send-otp :706
  POST /verify-otp :751
  GET x-forwarded-for :820
  GET x-real-ip :821
  GET x-forwarded-for :854
  GET x-real-ip :855
  GET user-agent :865
  POST /google/authorize :916
  GET /google/mobile-callback :949
  POST /google/callback :966
  GET user-agent :981
  POST /apple/authorize :1017
  POST /apple/callback :1024
  GET user-agent :1037
  POST /forgot-password :1073
  GET user-agent :1112
  POST /reset-password :1121
  POST /verify-email :1166
  POST /send-verification-email :1197
  GET /sessions :1237
  DELETE /sessions :1250
  DELETE /sessions/others :1258
  PATCH /sessions/:id/activity :1266
  DELETE /sessions/:id :1278
  POST /change-password :1296
  GET user-agent :1347

### bookings.ts  prefix=[/api/bookings]  count=26
  GET /upcoming :44
  POST /price-quote :49
  GET /cancellation-policy :105
  GET /:id/cancellation-quote :116
  POST / :143
  GET /:id/start-pin :230
  GET /:id :248
  PUT /:id :261
  POST /:id/accept :307
  POST /:id/reject :357
  POST /:id/en-route :372
  POST /:id/arrived :406
  POST /:id/start-otp :451
  POST /:id/start :496
  POST /:id/complete :578
  GET /:id/actions :642
  GET /:id/evidence :670
  POST /:id/evidence :686
  GET /:id/chat :745
  POST /:id/chat :764
  POST /:id/chat/read :803
  GET /:id/contact :815
  POST /:id/call :827
  GET /:id/partner-contact :851
  POST /:id/partner-call :863
  POST /:id/cancel :883

### compliance.ts  prefix=[/api/compliance]  count=11
  GET user-agent :13
  POST /export :40
  POST /delete :64
  POST /consent/withdraw :89
  GET /request/:id :106
  GET /export/:id :133
  GET /requests :159
  GET /admin/requests :165
  POST /admin/requests/:id/approve :178
  POST /admin/requests/:id/reject :192
  GET /admin/retention/report :214

### coverage.ts  prefix=[/api/coverage]  count=11
  GET x-forwarded-for :16
  GET x-real-ip :17
  GET /cities :44
  GET /cities/:slug :50
  GET /search :60
  POST /requests :73
  GET /requests :117
  PATCH /requests/:id :128
  GET /intelligence :148
  GET /admin/cities :155
  PATCH /cities/:slug :162

### customer-intelligence.ts  prefix=[/api/customer-intel]  count=8
  GET /me :35
  GET /match :40
  GET /recommendations :58
  GET /maintenance :99
  GET /rebooking :132
  GET /satisfaction/:bookingId :160
  POST /recommendation-click :193
  GET /:userId :201

### digital-twin.ts  prefix=[/api/digital-twin]  count=6
  GET /cities :13
  GET /:city :18
  GET /:city/insights :23
  POST /:city/simulate :28
  POST /:city/scenario :49
  POST /:city/what-if :63

### geo-intelligence.ts  prefix=[/api/geo-intel]  count=8
  GET /demand-forecast :20
  GET /surge :26
  GET /eta :32
  GET /zone-scoring :43
  GET /provider-density :48
  GET /revenue-forecast :54
  GET /fraud :59
  GET /exec-kpis :64

### geo.ts  prefix=[/api/geo]  count=15
  GET /config :17
  GET /reverse :22
  GET /autocomplete :39
  GET /place/:placeId :63
  GET /eta :78
  GET /route :104
  GET /serviceable :139
  POST /checkin :152
  POST /nearby-providers :173
  GET /geofences :205
  GET /geofences/analytics :214
  POST /geofences :230
  PATCH /geofences/:id :250
  DELETE /geofences/:id :259
  GET /geofence-events :264

### gift-cards.ts  prefix=[/api/giftcards]  count=10
  GET x-forwarded-for :6
  GET x-real-ip :7
  GET /denominations :12
  GET /me :15
  POST /order :20
  POST /verify :44
  POST /redeem :63
  GET user-agent :69
  GET x-device-id :70
  POST /:id/void :97

### hcoins.ts  prefix=[/api/hcoins]  count=3
  GET /me :7
  GET /history :12
  POST /redeem :17

### knowledge.ts  prefix=[/api/knowledge]  count=3
  POST /ask :58
  POST /retrieve :102
  GET /scope :121

### legal.ts  prefix=[/api/legal]  count=5
  GET /policies :9
  POST /consent/cookies :13
  GET user-agent :20
  POST /consent :28
  GET user-agent :37

### mlops.ts  prefix=[/api/mlops]  count=4
  GET /registry :11
  GET /data-quality :12
  GET /health :13
  GET /metrics :14

### notifications.ts  prefix=[/api/notifications]  count=7
  GET /preferences :23
  PUT /preferences :73
  GET /preferences/defaults :112
  GET / :121
  PUT /read-all :134
  PUT /:id/read :139
  DELETE /:id :144

### observability.ts  prefix=[]  count=2
  GET /ready :84
  GET /metrics :120

### partner-nav.ts  prefix=[/api/partner/nav]  count=1
  POST /telemetry :20

### partner-register.ts  prefix=[/api/partner]  count=31
  GET /register/service-options :79
  POST /register/step1 :88
  POST /register/verify-otp :129
  GET /register/invite :158
  GET /register/referral-code :173
  POST /register/resume :187
  POST /register/services :206
  POST /register/kyc-details :238
  POST /register/submit :266
  GET /registration-status :290
  POST /documents/upload :305
  GET /documents :355
  DELETE /documents/:documentId :366
  GET /onboarding/progress :377
  POST /onboarding/profile :391
  POST /onboarding/skills :415
  POST /onboarding/location :443
  POST /onboarding/availability :473
  POST /onboarding/documents :499
  GET /onboarding/assessment :521
  POST /onboarding/assessment :541
  GET /onboarding/training :570
  POST /onboarding/training/:moduleId/complete :581
  POST /onboarding/training/acknowledge :596
  GET /onboarding/review :607
  POST /onboarding/review/acknowledge :618
  GET /onboarding/geo/config :629
  GET /onboarding/geo/reverse :639
  GET /onboarding/geo/autocomplete :675
  GET /onboarding/geo/place/:placeId :695
  GET /onboarding/geo/search :706

### payments.ts  prefix=[/api/payments]  count=10
  POST /:id/refund :26
  POST /webhook :58
  GET x-razorpay-signature :61
  GET x-razorpay-event-id :96
  POST /e2e/mock-signature :143
  GET /history :164
  POST /create-order :169
  POST /verify :195
  GET /:id :231
  GET /:id/invoice :240

### pricing.ts  prefix=[/api/pricing]  count=3
  GET /quote :16
  GET /surge-forecast :27
  GET /experiment :37

### providers.ts  prefix=[/api/providers]  count=74
  GET /me :30
  GET /me/services :39
  GET /me/route/optimize :50
  PUT /me/online :73
  POST /me/pause :83
  POST /me/resume :93
  GET /me/operations :98
  GET /me/presence :103
  GET /me/dispatch-eligibility :112
  POST /me/presence/heartbeat :132
  GET x-request-id :137
  GET x-correlation-id :138
  GET x-forwarded-for :145
  GET x-real-ip :146
  GET user-agent :148
  POST /me/location/ping :179
  GET x-request-id :188
  GET x-correlation-id :189
  GET x-forwarded-for :190
  GET x-real-ip :191
  GET user-agent :193
  PUT /me/service-area :213
  GET /me/service-area/zones :231
  PUT /me/settings :250
  GET /me/bookings :271
  GET /me/dashboard :281
  GET /me/earnings :290
  GET /me/withdrawals :296
  GET /me/payouts :302
  GET /me/invoices :308
  GET /me/tax-summary :313
  GET /me/earnings/:id/invoice :318
  GET /me/reviews :328
  GET /me/attendance :333
  POST /me/attendance/check-in :339
  POST /me/attendance/check-out :345
  GET /me/incentives :352
  GET /me/forecast :358
  GET /me/intel/nudges :403
  GET /me/intel/shift-plan :415
  GET /me/intel/earnings-coach :434
  GET /me/intel/zones :453
  GET /me/intelligence :468
  GET /me/rankings :475
  GET /me/score :481
  GET /me/score/history :491
  GET /me/career :497
  GET /me/career/history :507
  GET /me/lifecycle :513
  GET /me/lifecycle/history :523
  GET /me/network :529
  POST /me/network/invite :535
  POST /me/lifecycle/pause :569
  POST /me/lifecycle/resume :586
  GET /me/academy :603
  POST /me/academy/:moduleId/complete :609
  GET /me/compliance :616
  GET /me/wellbeing :622
  PATCH /me/safety/emergency-contact :628
  POST /me/safety/sos :643
  POST /me/safety/report :678
  GET /me/safety/incidents :709
  GET /me/rewards :715
  GET /me/service-history :721
  GET /me/documents :727
  PATCH /me/documents/:documentId :734
  POST /me/documents :767
  POST /search :807
  POST /match :827
  GET /nearby :854
  GET /:id/reviews :864
  GET /:id/availability :870
  GET /:id :884
  POST /:id/book :892

### ratings.ts  prefix=[/api/ratings]  count=5
  GET /recent :18
  POST / :22
  GET /:bookingId :80
  PUT /:id :89
  POST /:id/respond :114

### referrals.ts  prefix=[/api/referrals]  count=4
  GET /me :8
  GET /history :13
  GET /leaderboard :18
  POST /withdraw :22

### services.ts  prefix=[/api/services]  count=5
  GET / :18
  GET /featured :35
  GET /category/:category :39
  POST /search :43
  GET /:id :65

### stats.ts  prefix=[/api/stats]  count=1
  GET /overview :4

### subscriptions.ts  prefix=[/api/subscriptions]  count=11
  GET /plans :11
  GET /me :16
  GET /invoices :21
  GET /entitlements :28
  GET /benefit-usage :33
  GET /cashback/history :54
  GET /insights :59
  POST /order :76
  POST /verify :97
  GET /coupons :124
  POST /cancel :129

### support.ts  prefix=[/api/support]  count=4
  POST /tickets :7
  GET /tickets :57
  GET /tickets/:id :66
  POST /tickets/:id/reply :75

### tracking.ts  prefix=[/api/tracking]  count=2
  POST /location :9
  GET /:bookingId :32

### uploads.ts  prefix=[]  count=4
  GET host :29
  GET x-forwarded-proto :30
  GET /uploads/ratings/:name :44
  POST /api/uploads/ratings :57

### users.ts  prefix=[/api/users]  count=17
  GET /me :58
  GET /me/export :65
  DELETE /me :86
  PUT /me :103
  GET /addresses :142
  POST /addresses :147
  PUT /addresses/:id :175
  DELETE /addresses/:id :198
  POST /addresses/:id/set-default :215
  GET /bookings :224
  GET /bookings/:id :229
  GET /ratings :238
  PUT /preferences :243
  PUT /me/devices/push-token :290
  GET /me/devices :329
  DELETE /me/devices/:deviceId :346
  GET /me :356

### ux-signals.ts  prefix=[]  count=1
  POST /api/ux-signals :42

### vision.routes.ts  prefix=[/api/vision]  count=6
  POST /images/submit :16
  POST /images/:imageId/analyze :73
  GET /images/:imageId :102
  GET /images/:imageId/analysis :132
  GET /status :180
  POST /admin/purge :225

### vitals.ts  prefix=[]  count=1
  POST /api/vitals :36

### wallet.ts  prefix=[/api/wallet]  count=18
  GET /balance :13
  GET /transactions :18
  GET /offers :23
  POST /checkout/quote :27
  POST /checkout/pay :40
  POST /checkout/split/initiate :60
  POST /checkout/split/verify :74
  POST /checkout/multi-source/quote :94
  POST /checkout/multi-source/pay :108
  POST /add-money :129
  POST /withdraw :163
  GET /transfers :211
  POST /transfer/initiate :216
  POST /transfer/confirm :235
  GET /payment-methods :249
  POST /payment-methods :254
  DELETE /payment-methods/:id :284
  POST /payment-methods/:id/set-default :293

### weather.ts  prefix=[/api/weather]  count=5
  GET /config :31
  GET /current :32
  GET /forecast :45
  GET /alerts :57
  GET /admin/overview :78

### webhooks.ts  prefix=[/api/webhooks]  count=7
  POST /resend :68
  GET content-length :69
  GET svix-id :85
  GET svix-timestamp :86
  GET svix-signature :87
  GET svix-id :108
  GET svix-id :110

## Backend routes with no frontend consumer (94)

These are reachable HTTP endpoints that no customer-web, partner-web, admin-panel, customer-mobile or partner-mobile source file references. Some are legitimately backend-only (marked); the rest are **built but unwired** — see `enterprise-2035-unwired-features.md`.



-- admin-governance.ts
   [GET,PUT] /api/admin/governance/ai-budgets
   [GET] /api/admin/governance/models/cancellation-risk/evaluation
   [GET] /api/admin/governance/models/provider-acceptance/evaluation
   [GET,POST] /api/admin/governance/workflow-drafts
   [POST] /api/admin/governance/workflow-drafts/*/review
   [POST] /api/admin/governance/workflows/*/recover
   [GET] /api/admin/governance/workflows/stuck

-- admin-intelligence.ts
   [GET] /api/admin/intelligence/report-recipients

-- admin-ml.ts
   [GET] /api/admin/ml/demand/forecast
   [GET] /api/admin/ml/shadow/*
   [POST] /api/admin/ml/versions/*/transition

-- admin.ts
   [GET] /api/admin/finance/audit-export/*
   [GET] /api/admin/finance/fraud-cases
   [POST] /api/admin/finance/liabilities/snapshot
   [POST] /api/admin/finance/settlement-sync/discrepancies/*/investigate
   [POST] /api/admin/finance/settlement-sync/discrepancies/*/notes
   [GET] /api/admin/finance/settlements/*
   [GET] /api/admin/finance/settlements/*/export
   [POST] /api/admin/fraud/commissions/*/unfreeze
   [GET] /api/admin/fraud/decisions
   [GET] /api/admin/integrity/booking-consistency
   [GET] /api/admin/membership/assignment/metrics
   [GET] /api/admin/observability/logs/export.json
   [GET] /api/admin/providers/*/career/history
   [GET] /api/admin/providers/*/score/history
   [GET] /api/admin/support/intelligence/analytics

-- ai-brain.routes.ts
   [GET] /api/ai/brain/conversations
   [GET] /api/ai/brain/conversations/*
   [POST] /api/ai/brain/conversations/*/pin
   [POST] /api/ai/brain/conversations/*/summarize
   [GET] /api/ai/brain/conversations/recall
   [GET] /api/ai/context/cache
   [POST] /api/ai/context/cache/purge
   [POST] /api/ai/context/rebuild
   [GET] /api/ai/context/search
   [POST] /api/ai/memory/*/compress
   [GET] /api/ai/prompt-versions/*/diff/*
   [GET] /api/ai/prompts/*

-- ai-gateway.routes.ts
   [POST] /api/ai/admin
   [GET] /api/ai/cost
   [POST] /api/ai/customer
   [POST] /api/ai/gateway/chat

-- ai-tools.routes.ts
   [POST] /api/ai/tools/approvals/*/cancel

-- analytics.ts
   [GET] /api/analytics/etl/executions/*
   [POST] /api/analytics/etl/run
   [GET] /api/analytics/features/*
   [POST] /api/analytics/features/export
   [GET] /api/analytics/features/metadata
   [GET] /api/analytics/freshness
   [GET] /api/analytics/freshness/sla-violations
   [GET] /api/analytics/mlops/metrics
   [GET] /api/analytics/mlops/registry
   [GET] /api/analytics/quality
   [GET] /api/analytics/quality/history/*
   [GET] /api/analytics/versions/*
   [GET] /api/analytics/versions/*/active
   [POST] /api/analytics/versions/rollback

-- auth.ts
   [GET] /api/auth/google/mobile-callback
   [PATCH] /api/auth/sessions/*/activity

-- compliance.ts
   [POST] /api/compliance/consent/withdraw
   [GET] /api/compliance/request/*

-- customer-intelligence.ts
   [GET] /api/customer-intel/satisfaction/*

-- digital-twin.ts
   [POST] /api/digital-twin/*/scenario
   [POST] /api/digital-twin/*/what-if

-- geo.ts
   [POST] /api/geo/checkin

-- knowledge.ts
   [POST] /api/knowledge/ask
   [POST] /api/knowledge/retrieve
   [GET] /api/knowledge/scope

-- legal.ts
   [GET] /api/legal/policies

-- mlops.ts
   [GET] /api/mlops/metrics

-- notifications.ts
   [GET] /api/notifications/preferences/defaults

-- observability.ts
   [GET] /metrics
   [GET] /ready

-- partner-register.ts
   [GET] /api/partner/register/referral-code

-- payments.ts
   [POST] /api/payments/e2e/mock-signature

-- pricing.ts
   [GET] /api/pricing/experiment
   [GET] /api/pricing/quote
   [GET] /api/pricing/surge-forecast

-- providers.ts
   [GET] /api/providers/me/intel/earnings-coach
   [GET] /api/providers/me/intel/nudges
   [GET] /api/providers/me/intel/shift-plan
   [GET] /api/providers/me/intel/zones
   [GET] /api/providers/me/lifecycle/history
   [POST] /api/providers/me/lifecycle/pause
   [POST] /api/providers/me/lifecycle/resume
   [GET] /api/providers/me/withdrawals

-- uploads.ts
   [GET] /uploads/ratings/*

-- users.ts
   [GET] /api/users/bookings/*

-- vision.routes.ts
   [GET] /api/vision/images/*/analysis

-- wallet.ts
   [POST] /api/wallet/checkout/multi-source/pay
   [POST] /api/wallet/checkout/multi-source/quote

-- weather.ts
   [GET] /api/weather/config
   [GET] /api/weather/forecast

-- webhooks.ts
   [POST] /api/webhooks/resend
