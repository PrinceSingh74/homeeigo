# HOMIGO — Mobile Razorpay Runtime Certification (GATE 3)

**Date:** 2026-06-25 · **Verdict: PARTIAL — Create Order PROVEN (real Razorpay order); checkout→refund BLOCKED on a device build.**

## ✅ Create Order — PASS (real runtime evidence)
Server-side create-order uses a **real Razorpay key** (`rzp_test_SxWTIW0Ry4miJJ`) and produced a genuine order:
```
POST /api/payments/create-order → razorpayOrderId: order_T6e8zPiuk7Yp0s  (order_ = real Razorpay order)
amount: 55000 paise (₹550) · idempotencyKey: booking_order:cmqw7xiah0g5vtzh445fojk7i
DB: payments row status=INITIATED, razorpay_order_id=order_T6e8zPiuk7Yp0s
```
The order exists at Razorpay (test mode) and is persisted. **The remaining steps below still need a device.**

---

**(Original verdict for the on-device steps:) BLOCKED — checkout/success/webhook/refund require an Android native build on a device.**

## Why BLOCKED (runtime evidence)
| Capability | Probe result |
|---|---|
| `react-native-razorpay` | present (native SDK — only runs in a **native build**, not Metro/export) |
| eas-cli / native build | **NOT installed** → no APK to run on a device |
| `adb` / emulator / device | **NOT available** |
| Razorpay key in mobile env | none (server-held) |

The native Razorpay checkout sheet (`RazorpayCheckout.open`) only executes inside a real Android/iOS binary
on a device. It cannot run here, so success/failure/retry/refund **cannot be exercised**.

## Server-side payment integrity (already PASS — independent of the device)
- `POST /api/payments/create-order` exists (400 = exists, auth+body required).
- DB: **0 duplicate `razorpay_payment_id`**, **0 double-capture**, **0 orphan payments**, ledger `debit==credit` (see `homigo-end-to-end-business-certification.md`). So the back half (order → webhook → settlement → ledger) is proven; only the on-device checkout is unverified.

## Known risk to confirm on-device
`react-native-razorpay` is flagged **"Unsupported on New Architecture"** (expo-doctor) while `newArchEnabled:true`.
Must be validated on a real New-Arch build; if it misbehaves, switch to a New-Arch-safe checkout (`expo-web-browser`).

## Exact steps to clear
1. `eas build -p android` (GATE 3) with **Razorpay TEST key**. 2. On a device: create order → checkout → success.
3. Verify exactly **one** `payments` row (SUCCESS), webhook captured, ledger balanced. 4. Repeat for failure, retry
   (assert no duplicate), and refund (assert refund row + ledger reversal). Capture the Razorpay dashboard txn IDs.

> **BLOCKED — device build + Razorpay keys.** Server-side payment integrity is proven (0 duplicates); the
> on-device checkout cannot be run here.
