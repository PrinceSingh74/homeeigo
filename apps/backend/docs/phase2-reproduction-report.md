# Phase 2 Payment Reproduction Report

- **Run:** p2-mq8gfvvt
- **Started:** 2026-06-10T19:21:35.274Z
- **Finished:** 2026-06-10T19:21:37.987Z
- **Result:** ALL PASS

## Evidence

### PASS Unverified POST /api/subscriptions/order
**curl equivalent:**
```bash
curl -X POST http://localhost/api/subscriptions/order -H "Authorization: Bearer <unverified>" -d '{"planId":"..."}'
```
- HTTP status (primary): **403**
- Notes: subscriptions in DB: 0
```json
{
  "success": false,
  "error": "Verify your email to continue",
  "code": "EMAIL_NOT_VERIFIED",
  "timestamp": "2026-06-10T19:21:35.524Z",
  "requestId": "req_f8bea418c06802d6"
}
```
### PASS Unverified POST /api/subscriptions/verify
**curl equivalent:**
```bash
curl -X POST http://localhost/api/subscriptions/verify -H "Authorization: Bearer <unverified>" ...
```
- HTTP status (primary): **403**
```json
{
  "success": false,
  "error": "Verify your email to continue",
  "code": "EMAIL_NOT_VERIFIED",
  "timestamp": "2026-06-10T19:21:35.544Z",
  "requestId": "req_9c591be41fa2d29e"
}
```
### PASS Replay subscription order (verified user, 2x)
**curl equivalent:**
```bash
curl .../order (x2 same user)
```
- HTTP status (primary): **200**
- Notes: PENDING subs: 2 (orders are payment intents, not active membership)
```json
{
  "first": 200,
  "second": {
    "success": true,
    "data": {
      "razorpayOrderId": "order_dev_1ac1fb259e7a3eb2",
      "amount": 99900,
      "currency": "INR",
      "key": "",
      "planName": "P2 Plan p2-mq8gfvvt"
    }
  }
}
```
### PASS Unverified POST /api/wallet/add-money
**curl equivalent:**
```bash
curl -X POST http://localhost/api/wallet/add-money ...
```
- HTTP status (primary): **403**
- Notes: pending wallet txns: 0
```json
{
  "success": false,
  "error": "Verify your email to continue",
  "code": "EMAIL_NOT_VERIFIED",
  "timestamp": "2026-06-10T19:21:35.615Z",
  "requestId": "req_a7e7fdcffe02d326"
}
```
### PASS Unverified POST /api/giftcards/redeem
**curl equivalent:**
```bash
curl -X POST http://localhost/api/giftcards/redeem ...
```
- HTTP status (primary): **403**
```json
{
  "success": false,
  "error": "Verify your email to continue",
  "code": "EMAIL_NOT_VERIFIED",
  "timestamp": "2026-06-10T19:21:35.633Z",
  "requestId": "req_471b0fd75cdab2ce"
}
```
### PASS No Authorization header
**curl equivalent:**
```bash
curl -X POST http://localhost/api/giftcards/redeem (no Bearer)
```
- HTTP status (primary): **401**
```json
{
  "success": false,
  "error": "Invalid or expired token",
  "code": "UNAUTHORIZED",
  "timestamp": "2026-06-10T19:21:35.634Z",
  "suggestion": "Please sign in again to continue.",
  "requestId": "req_a958bf9a30e81006"
}
```
### PASS Garbage JWT
**curl equivalent:**
```bash
curl -H "Authorization: Bearer not.a.valid.jwt" ...
```
- HTTP status (primary): **401**
```json
{
  "success": false,
  "error": "Invalid or expired token",
  "code": "UNAUTHORIZED",
  "timestamp": "2026-06-10T19:21:35.635Z",
  "suggestion": "Please sign in again to continue.",
  "requestId": "req_4b10eb07b508e361"
}
```
### PASS JWT signed with wrong secret
**curl equivalent:**
```bash
curl -H 'Authorization: Bearer <forged-wrong-secret>' ...
```
- HTTP status (primary): **401**
```json
{
  "success": false,
  "error": "Invalid or expired token",
  "code": "UNAUTHORIZED",
  "timestamp": "2026-06-10T19:21:35.638Z",
  "suggestion": "Please sign in again to continue.",
  "requestId": "req_f17397cd373d78c5"
}
```
### PASS Expired JWT (valid signature)
**curl equivalent:**
```bash
curl -H 'Authorization: Bearer <expired>' ...
```
- HTTP status (primary): **401**
```json
{
  "success": false,
  "error": "Invalid or expired token",
  "code": "UNAUTHORIZED",
  "timestamp": "2026-06-10T19:21:35.642Z",
  "suggestion": "Please sign in again to continue.",
  "requestId": "req_2d2eba3168cc3310"
}
```
### PASS Refresh token used as access token
**curl equivalent:**
```bash
curl -H 'Authorization: Bearer <refresh-token>' ...
```
- HTTP status (primary): **401**
```json
{
  "success": false,
  "error": "Invalid or expired token",
  "code": "UNAUTHORIZED",
  "timestamp": "2026-06-10T19:21:35.646Z",
  "suggestion": "Please sign in again to continue.",
  "requestId": "req_5124a73df4b17983"
}
```
### PASS Valid JWT but DB isEmailVerified=false (no JWT claim bypass)
**curl equivalent:**
```bash
curl with legitimate unverified-user token
```
- HTTP status (primary): **403**
- Notes: Auth reads isEmailVerified from DB, not JWT payload
```json
{
  "success": false,
  "error": "Verify your email to continue",
  "code": "EMAIL_NOT_VERIFIED",
  "timestamp": "2026-06-10T19:21:35.688Z",
  "requestId": "req_4ed6b752ba1dc1f3"
}
```
### PASS IDOR void — User A voids User B gift card
**curl equivalent:**
```bash
curl -X POST http://localhost/api/giftcards/cmq8gfw7d000ztz8gbtix1gg8/void -H "Bearer <attacker>"
```
- HTTP status (primary): **404**
```json
{
  "success": false,
  "error": "NOT_FOUND",
  "code": "NOT_FOUND"
}
```
### PASS 50 concurrent HTTP POST /api/giftcards/redeem (different users, same code)
**curl equivalent:**
```bash
for i in {1..50}; do curl -X POST http://localhost/api/giftcards/redeem -H "Bearer <user$i>" -d '{"code":"HG-FVVT-RACE50"}' & done; wait
```
- HTTP status (primary): **1**
- Notes: single debit confirmed
```json
{
  "http200": 1,
  "httpNon200": 49,
  "statusBreakdown": {
    "200": 1,
    "400": 49
  },
  "cardBalance": 0,
  "cardStatus": "REDEEMED",
  "redeemTxns": 1,
  "walletCredits": 1,
  "totalCredited": 1000,
  "durationMs": 462
}
```
### PASS 20 concurrent wallet add-money (cap=10)
**curl equivalent:**
```bash
for i in {1..20}; do curl -X POST http://localhost/api/wallet/add-money ... & done
```
- HTTP status (primary): **4**
- Notes: activePending=4, max=10
```json
{
  "http200": 4,
  "http429": 0,
  "activePending": 4
}
```
## SQL verification queries

```sql
SELECT COUNT(*) FROM user_subscriptions WHERE user_id = 'cmq8gfvzy0002tz8g82n6mxq1';
SELECT COUNT(*) FROM gift_card_transactions WHERE gift_card_id = 'cmq8gfw8e0016tz8gzyor9lih';
```